import * as vscode from 'vscode';

import { VaultManager } from './vaultManager';
import { VaultNode, readVaultTree } from './vaultTree';

interface InboundMessage {
  type: 'ready' | 'openNote' | 'configureVault';
  path?: string;
}

type OutboundMessage = { type: 'tree'; tree: VaultNode } | { type: 'noVault' };

const REFRESH_DEBOUNCE_MS = 100;
const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// --- helpers ---

// resolve a media file as a webview-safe uri
function mediaUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  ...segments: string[]
): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...segments));
}

// 32-char random nonce for the script CSP
function randomNonce(): string {
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return out;
}

// --- exports ---

export class VaultViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'promptStudio.vault';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshScheduled = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly vaultManager: VaultManager
  ) {
    this.rebuildWatcher();
    this.disposables.push(
      vaultManager.onDidChangeVault(() => {
        this.rebuildWatcher();
        void this.postState();
      })
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    view.webview.html = this.render(view.webview);

    this.disposables.push(
      view.webview.onDidReceiveMessage((msg: InboundMessage) => this.handle(msg))
    );

    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  dispose(): void {
    this.watcher?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  // tear down any previous watcher, attach a new one to the current vault root
  private rebuildWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;

    const root = this.vaultManager.getVaultRoot();
    if (!root) {
      return;
    }

    const pattern = new vscode.RelativePattern(root, '**');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const refresh = (): void => this.scheduleRefresh();
    this.disposables.push(this.watcher.onDidCreate(refresh), this.watcher.onDidDelete(refresh));
  }

  // coalesce bursts of fs events into a single refresh
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

  // push either the current tree or the empty-state marker
  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }

    const root = this.vaultManager.getVaultRoot();
    const msg: OutboundMessage = root
      ? { type: 'tree', tree: await readVaultTree(root) }
      : { type: 'noVault' };
    await this.view.webview.postMessage(msg);
  }

  private async handle(msg: InboundMessage): Promise<void> {
    if (msg.type === 'ready') {
      await this.postState();
      return;
    }
    if (msg.type === 'openNote' && typeof msg.path === 'string') {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
      return;
    }
    if (msg.type === 'configureVault') {
      await vscode.commands.executeCommand('promptStudio.configureVault');
    }
  }

  private render(webview: vscode.Webview): string {
    const nonce = randomNonce();
    const codiconCss = mediaUri(webview, this.extensionUri, 'media', 'codicons', 'codicon.css');
    const styleUri = mediaUri(webview, this.extensionUri, 'media', 'vault', 'vault.css');
    const scriptUri = mediaUri(webview, this.extensionUri, 'media', 'vault', 'vault.js');

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${codiconCss}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Prompt Studio Vault</title>
</head>
<body>
  <div id="tree-root" role="tree" aria-label="Vault"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
