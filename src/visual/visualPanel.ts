import * as path from 'node:path';

import * as vscode from 'vscode';

import { CardLayoutStore, NotePosition } from '../common/cardLayoutStore';
import { copyPathToClipboard } from '../common/utils/clipboard';
import { isWithin, relativeToRoot } from '../common/utils/paths';
import { assetUri, renderWebviewHtml } from '../common/utils/webview';
import { CONFIG_FILENAME } from '../common/vaultConfig';
import { VaultNode } from '../common/vaultNode';
import { CARD_COLORS, isCardColor } from './cardColors';
import { readFolder } from './folderContents';

// what one canvas is bound to
export interface CanvasContext {
  store: CardLayoutStore;
  root: string;
  allowCrud: boolean;
  activeFolderEmitter?: vscode.EventEmitter<string | undefined>;
}

type InboundMessage =
  | { type: 'ready' }
  | { type: 'openNote'; path: string }
  | { type: 'navigate'; folder: string }
  | { type: 'moveCard'; path: string; x: number; y: number; z: number }
  | { type: 'resizeCard'; path: string; width: number; height: number }
  | { type: 'setColor'; path: string; color: string | null }
  | { type: 'newEntry'; kind: 'note' | 'folder'; x: number; y: number }
  | { type: 'command'; command: string; node: VaultNode };

const REFRESH_DEBOUNCE_MS = 100;
const ALLOWED_COMMANDS = new Set([
  'promptStudio.rename',
  'promptStudio.delete',
  'promptStudio.copyContents',
  'promptStudio.openTemplate',
  'promptStudio.sendToClaude',
  'promptStudio.copyPathStatic',
  'promptStudio.copyPathRelative',
  'promptStudio.revealInOS'
]);

// the commands that change the folder's structure, suppressed on a read-only canvas
const CRUD_COMMANDS = new Set(['promptStudio.rename', 'promptStudio.delete']);

export class VisualPanel {
  static readonly viewType = 'promptStudio.visual';

  private static readonly panels = new Map<string, VisualPanel>();

  // reveal the canvas for this root, creating it on first use, then point it at folder
  static show(extensionUri: vscode.Uri, context: CanvasContext, folder: string): void {
    const existing = VisualPanel.panels.get(context.root);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      existing.navigate(folder);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VisualPanel.viewType,
      VisualPanel.titleFor(folder),
      vscode.ViewColumn.Active,
      { ...VisualPanel.webviewOptions(extensionUri), retainContextWhenHidden: true }
    );
    VisualPanel.panels.set(context.root, new VisualPanel(panel, extensionUri, context, folder));
  }

  // reattach to a canvas panel VSCode restored after a window reload
  static restore(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: CanvasContext,
    folder: string
  ): void {
    panel.webview.options = VisualPanel.webviewOptions(extensionUri);
    VisualPanel.panels.set(context.root, new VisualPanel(panel, extensionUri, context, folder));
  }

  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcherSubs: vscode.Disposable[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshScheduled = false;
  private folder: string;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly context: CanvasContext,
    initialFolder: string
  ) {
    this.folder = initialFolder;
    this.panel.title = VisualPanel.titleFor(initialFolder);
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => this.handle(msg)),
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.onDidChangeViewState(() => this.emitActiveFolder()),
      this.context.store.onDidChange(() => this.scheduleRefresh())
    );
    this.rebuildWatcher();
    this.emitActiveFolder();
  }

  private dispose(): void {
    VisualPanel.panels.delete(this.context.root);
    this.context.activeFolderEmitter?.fire(undefined);

    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcher?.dispose();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // point the panel at a different folder inside the canvas root
  private navigate(folder: string): void {
    if (folder === this.folder || !isWithin(folder, this.context.root)) {
      return;
    }

    this.folder = folder;
    this.panel.title = VisualPanel.titleFor(folder);
    this.rebuildWatcher();
    void this.postState();
    this.emitActiveFolder();
  }

  // fire this canvas's folder while it is the active panel, undefined otherwise
  private emitActiveFolder(): void {
    this.context.activeFolderEmitter?.fire(this.panel.active ? this.folder : undefined);
  }

  // point the watcher at the current folder's direct children
  private rebuildWatcher(): void {
    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcherSubs.length = 0;
    this.watcher?.dispose();

    const pattern = new vscode.RelativePattern(this.folder, '*');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcherSubs.push(
      this.watcher.onDidCreate((uri) => this.onFolderEvent(uri)),
      this.watcher.onDidDelete((uri) => this.onFolderEvent(uri)),
      this.watcher.onDidChange((uri) => this.onFolderEvent(uri))
    );
  }

  // refresh on note add/delete/change, the layout store owns its own change events
  private onFolderEvent(uri: vscode.Uri): void {
    if (path.basename(uri.fsPath) === CONFIG_FILENAME) {
      return;
    }
    this.scheduleRefresh();
  }

  // collapse a burst of fs events into one delayed state push
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

  private async handle(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.postState();
        return;
      case 'openNote':
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
        return;
      case 'navigate':
        this.navigate(msg.folder);
        return;
      case 'moveCard':
        this.context.store.setPosition(msg.path, { x: msg.x, y: msg.y });
        this.context.store.setZ(msg.path, msg.z);
        return;
      case 'resizeCard':
        this.context.store.setSize(msg.path, { width: msg.width, height: msg.height });
        return;
      case 'setColor':
        if (msg.color === null) {
          this.context.store.setColor(msg.path, undefined);
        } else if (isCardColor(msg.color)) {
          this.context.store.setColor(msg.path, msg.color);
        }
        return;
      case 'newEntry':
        if (this.context.allowCrud) {
          await this.createEntry(msg.kind, { x: msg.x, y: msg.y });
        }
        return;
      case 'command':
        if (!ALLOWED_COMMANDS.has(msg.command) || this.isBlockedCommand(msg.command)) {
          return;
        }
        if (msg.command === 'promptStudio.copyPathRelative') {
          await this.copyRelativePath(msg.node);
          return;
        }
        await vscode.commands.executeCommand(msg.command, msg.node);
        return;
    }
  }

  // block structural edits on a read-only canvas
  private isBlockedCommand(command: string): boolean {
    return !this.context.allowCrud && CRUD_COMMANDS.has(command);
  }

  // copy a card's path relative to this canvas root
  private async copyRelativePath(node: VaultNode): Promise<void> {
    await copyPathToClipboard(relativeToRoot(this.context.root, node.absPath), node.name);
  }

  // create a note or folder in the open folder, pinned at the drop point
  private async createEntry(kind: 'note' | 'folder', position: NotePosition): Promise<void> {
    const node: VaultNode = { kind: 'folder', absPath: this.folder, name: path.basename(this.folder) };
    const command = kind === 'note' ? 'promptStudio.newNote' : 'promptStudio.newFolder';
    await vscode.commands.executeCommand(command, node, position);
  }

  private async postState(): Promise<void> {
    const state = await readFolder(this.context.store, this.context.root, this.folder);
    await this.panel.webview.postMessage({ type: 'state', state });
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    return renderWebviewHtml(webview, this.extensionUri, 'media/visual/canvas.html', {
      codiconCss: assetUri(webview, this.extensionUri, 'media/codicons/codicon.css'),
      paletteCss: assetUri(webview, this.extensionUri, 'media/common/palette.css'),
      contextMenuCss: assetUri(webview, this.extensionUri, 'media/common/contextMenu.css'),
      contextMenuJs: assetUri(webview, this.extensionUri, 'media/common/contextMenu.js'),
      canvasCss: assetUri(webview, this.extensionUri, 'media/visual/canvas.css'),
      canvasJs: assetUri(webview, this.extensionUri, 'media/visual/canvas.js'),
      cardColors: JSON.stringify(CARD_COLORS),
      allowCrud: JSON.stringify(this.context.allowCrud)
    });
  }

  // panel tab label for a folder
  private static titleFor(folder: string): string {
    return `Visual: ${path.basename(folder) || folder}`;
  }

  // scripts on, asset loads limited to the bundled media folder
  private static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    };
  }
}
