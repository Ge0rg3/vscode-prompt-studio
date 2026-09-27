// Hosts the vault sidebar webview, its watchers, and its messages
import * as vscode from 'vscode';

import { applyColorMessage, CARD_COLORS, ColorPreview, postColorPreview } from '../common/cardColors';
import { carryNoteAttachments } from '../common/noteAttachments';
import { defaultNoteView, onDidChangeNoteView, openNoteInView } from '../common/noteView';
import { ScopeManager } from '../common/scopeManager';
import { isWithin } from '../common/utils/paths';
import { assetUri, renderWebviewHtml } from '../common/utils/webview';
import { VaultConfig } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { pasteVaultEntry } from './copyEntry';
import { renameEntry } from './entryActions';
import { validateEntryName } from './entryName';
import { moveVaultEntry } from './moveEntry';
import { readTree, TreeState } from './vaultTree';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'openNote'; node: VaultNode; preserveFocus?: boolean }
  | { type: 'openFile'; path: string }
  | { type: 'move'; source: string; destDir: string }
  | { type: 'paste'; source: string; contextNode?: VaultNode }
  | { type: 'rename'; node: VaultNode; newName: string }
  | { type: 'setColor'; path: string; color: string | null }
  | { type: 'previewColor'; path: string; color: string | null }
  | { type: 'command'; command: string; node?: VaultNode };

const REFRESH_DEBOUNCE_MS = 100;
const ALLOWED_COMMANDS = new Set([
  'promptStudio.newNote',
  'promptStudio.newFolder',
  'promptStudio.openSettings',
  'promptStudio.delete',
  'promptStudio.copyContents',
  'promptStudio.openTemplate',
  'promptStudio.sendToClaude',
  'promptStudio.showHistory',
  'promptStudio.copyPathStatic',
  'promptStudio.copyPathRelative',
  'promptStudio.revealInOS',
  'promptStudio.openVisual'
]);

export class VaultWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'promptStudio.vault';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcherSubs: vscode.Disposable[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshScheduled = false;
  private activeVisualFolder: string | undefined;

  constructor(
    private readonly vaultManager: VaultManager,
    private readonly config: VaultConfig,
    private readonly extensionUri: vscode.Uri,
    private readonly colorPreviewEmitter: vscode.EventEmitter<ColorPreview>,
    private readonly scopeManager: ScopeManager
  ) {
    this.rebuildWatcher();
    this.disposables.push(
      vaultManager.onDidChangeVault(() => {
        this.rebuildWatcher();
        void this.postState();
      }),
      scopeManager.onDidChangeScope(() => scopeManager.labelView(this.view)),
      config.onDidChange(() => this.scheduleRefresh()),
      onDidChangeNoteView(() => this.postNoteView()),
      vscode.window.onDidChangeActiveTextEditor(() => this.syncSelection()),
      colorPreviewEmitter.event((preview) => postColorPreview(this.view?.webview, preview))
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    view.webview.html = this.renderHtml(view.webview);
    this.scopeManager.labelView(view);

    // Dispose the message handler with the view, since VSCode resolves a new view whenever the section reappears
    const messageSubscription = view.webview.onDidReceiveMessage((msg) => this.handle(msg));
    view.onDidDispose(() => {
      this.view = undefined;
      messageSubscription.dispose();
    });
  }

  expandAll(): void {
    void this.view?.webview.postMessage({ type: 'expandAll' });
  }

  collapseAll(): void {
    void this.view?.webview.postMessage({ type: 'collapseAll' });
  }

  // Track the folder the active canvas shows, cleared when it loses focus or closes
  setActiveVisualFolder(folder: string | undefined): void {
    this.activeVisualFolder = folder;
    this.syncSelection();
  }

  dispose(): void {
    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcher?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // Point the watcher at the current vault root
  private rebuildWatcher(): void {
    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcherSubs.length = 0;
    this.watcher?.dispose();
    this.watcher = undefined;

    const root = this.vaultManager.getVaultRoot();
    if (!root) {
      return;
    }
    const pattern = new vscode.RelativePattern(root, '**');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcherSubs.push(
      this.watcher.onDidCreate(() => this.scheduleRefresh()),
      this.watcher.onDidDelete(() => this.scheduleRefresh())
    );
  }

  // Collapse a burst of file events into one refresh
  private scheduleRefresh(): void {
    if (this.refreshScheduled) {
      return;
    }
    this.refreshScheduled = true;
    setTimeout(() => {
      this.refreshScheduled = false;
      void this.postState();
    }, REFRESH_DEBOUNCE_MS);
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }
    const root = this.vaultManager.getVaultRoot();
    if (!root) {
      await this.view.webview.postMessage({ type: 'state', state: null });
      return;
    }
    const state: TreeState = { root, children: await readTree(this.config, root) };
    await this.view.webview.postMessage({ type: 'state', state });
  }

  // Push the view a note click opens
  private postNoteView(): void {
    void this.view?.webview.postMessage({ type: 'noteView', view: defaultNoteView() });
  }

  // Highlight the folder the active canvas shows, falling back to the note in the active editor
  private syncSelection(): void {
    if (this.activeVisualFolder) {
      void this.view?.webview.postMessage({ type: 'select', path: this.activeVisualFolder });
      return;
    }

    const root = this.vaultManager.getVaultRoot();
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    const notePath = active && root && isWithin(active, root) ? active : null;
    void this.view?.webview.postMessage({ type: 'select', path: notePath });
  }

  // Check a path from the webview really sits in the vault, a message can say anything
  private insideVault(absPath: string): boolean {
    const root = this.vaultManager.getVaultRoot();
    return root !== undefined && isWithin(absPath, root);
  }

  private async handle(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postNoteView();
        await this.postState();
        this.syncSelection();
        return;
      case 'openNote':
        if (!this.insideVault(msg.node.absPath)) {
          return;
        }

        await openNoteInView(defaultNoteView(), msg.node, msg.preserveFocus === true);
        return;
      case 'openFile':
        if (!this.insideVault(msg.path)) {
          return;
        }

        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
        return;
      case 'move': {
        const root = this.vaultManager.getVaultRoot();
        if (!root) return;
        const destination = await moveVaultEntry(root, msg.source, msg.destDir);
        if (destination) {
          this.config.relocate(msg.source, destination);
          await carryNoteAttachments(msg.source, destination);
        }
        return;
      }
      case 'paste': {
        const root = this.vaultManager.getVaultRoot();
        if (!root) return;
        const destination = await pasteVaultEntry(root, msg.source, msg.contextNode);
        if (!destination) return;

        this.config.duplicate(msg.source, destination);
        await carryNoteAttachments(msg.source, destination);
        await this.postState();
        await this.view?.webview.postMessage({ type: 'reveal', path: destination });
        return;
      }
      case 'rename': {
        if (!this.insideVault(msg.node.absPath) || validateEntryName(msg.newName)) {
          return;
        }

        const renamed = await renameEntry(this.config, msg.node, msg.newName);
        if (!renamed) {
          await this.postState();
        }
        return;
      }
      case 'setColor':
        applyColorMessage(this.config, msg);
        return;
      case 'previewColor':
        this.colorPreviewEmitter.fire({ path: msg.path, color: msg.color });
        return;
      case 'command':
        if (!ALLOWED_COMMANDS.has(msg.command) || (msg.node && !this.insideVault(msg.node.absPath))) {
          return;
        }
        await vscode.commands.executeCommand(msg.command, msg.node);
        return;
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    return renderWebviewHtml(webview, this.extensionUri, 'media/vault/tree.html', {
      codiconCss: assetUri(webview, this.extensionUri, 'media/codicons/codicon.css'),
      paletteCss: assetUri(webview, this.extensionUri, 'media/common/palette.css'),
      contextMenuCss: assetUri(webview, this.extensionUri, 'media/common/contextMenu.css'),
      contextMenuJs: assetUri(webview, this.extensionUri, 'media/common/contextMenu.js'),
      noteOpenJs: assetUri(webview, this.extensionUri, 'media/common/noteOpen.js'),
      paletteJs: assetUri(webview, this.extensionUri, 'media/common/palette.js'),
      treeCss: assetUri(webview, this.extensionUri, 'media/common/tree.css'),
      treeJs: assetUri(webview, this.extensionUri, 'media/vault/tree.js'),
      cardColors: JSON.stringify(CARD_COLORS)
    });
  }
}

// Register the expand and collapse commands for the view title bar
export function registerVaultViewCommands(provider: VaultWebviewProvider): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('promptStudio.expandAll', () => provider.expandAll()),
    vscode.commands.registerCommand('promptStudio.collapseAll', () => provider.collapseAll())
  );
}
