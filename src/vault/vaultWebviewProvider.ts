import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { fillTemplate, randomNonce } from '../common/utils/webview';
import { VaultConfig } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { moveVaultEntry } from './moveEntry';
import { readTree, TreeState } from './vaultTree';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'openNote'; path: string }
  | { type: 'move'; source: string; destDir: string }
  | { type: 'command'; command: string; node?: VaultNode };

const REFRESH_DEBOUNCE_MS = 100;
const ALLOWED_COMMANDS = new Set([
  'promptStudio.newNote',
  'promptStudio.newFolder',
  'promptStudio.configureVault',
  'promptStudio.rename',
  'promptStudio.copyContents',
  'promptStudio.copyPath',
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

  constructor(
    private readonly vaultManager: VaultManager,
    private readonly config: VaultConfig,
    private readonly extensionUri: vscode.Uri
  ) {
    this.rebuildWatcher();
    this.disposables.push(
      vaultManager.onDidChangeVault(() => {
        this.rebuildWatcher();
        void this.postState();
      }),
      config.onDidChange(() => this.scheduleRefresh())
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    view.webview.html = this.renderHtml(view.webview);
    view.onDidDispose(() => {
      this.view = undefined;
    });
    this.disposables.push(view.webview.onDidReceiveMessage((msg) => this.handle(msg)));
  }

  expandAll(): void {
    void this.view?.webview.postMessage({ type: 'expandAll' });
  }

  collapseAll(): void {
    void this.view?.webview.postMessage({ type: 'collapseAll' });
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

  // tear down any previous watcher, attach a new one to the current vault root
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

  // coalesce bursts of fs events into a single debounced state push
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

  private async handle(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.postState();
        return;
      case 'openNote':
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
        return;
      case 'move': {
        const root = this.vaultManager.getVaultRoot();
        if (!root) return;
        const destination = await moveVaultEntry(root, msg.source, msg.destDir);
        if (destination) {
          this.config.relocate(msg.source, destination);
        }
        return;
      }
      case 'command':
        if (!ALLOWED_COMMANDS.has(msg.command)) {
          return;
        }
        await vscode.commands.executeCommand(msg.command, msg.node);
        return;
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = randomNonce();
    const codiconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/codicons/codicon.css')
    );
    const paletteCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/common/palette.css')
    );
    const treeCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/vault/tree.css')
    );
    const treeJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/vault/tree.js')
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    const template = fs.readFileSync(
      path.join(this.extensionUri.fsPath, 'media/vault/tree.html'),
      'utf8'
    );
    return fillTemplate(template, {
      csp,
      nonce,
      codiconCss: codiconCss.toString(),
      paletteCss: paletteCss.toString(),
      treeCss: treeCss.toString(),
      treeJs: treeJs.toString()
    });
  }
}

export function registerVaultViewCommands(provider: VaultWebviewProvider): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('promptStudio.expandAll', () => provider.expandAll()),
    vscode.commands.registerCommand('promptStudio.collapseAll', () => provider.collapseAll())
  );
}
