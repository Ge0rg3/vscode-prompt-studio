import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { isWithin } from '../common/utils/paths';
import { fillTemplate, randomNonce } from '../common/utils/webview';
import { CONFIG_FILENAME, VaultConfig } from '../common/vaultConfig';
import { VaultNode } from '../common/vaultNode';
import { CARD_COLORS, isCardColor } from './cardColors';
import { readFolder } from './folderContents';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'openNote'; path: string }
  | { type: 'navigate'; folder: string }
  | { type: 'moveCard'; path: string; x: number; y: number; z: number }
  | { type: 'resizeCard'; path: string; width: number; height: number }
  | { type: 'setColor'; path: string; color: string | null }
  | { type: 'command'; command: string; node: VaultNode };

const REFRESH_DEBOUNCE_MS = 100;
const ALLOWED_COMMANDS = new Set([
  'promptStudio.rename',
  'promptStudio.copyContents',
  'promptStudio.copyPath',
  'promptStudio.revealInOS',
  'promptStudio.newNote',
  'promptStudio.newFolder'
]);

// --- helpers ---

// panel tab label for a folder
function titleFor(folder: string): string {
  return `Visual: ${path.basename(folder) || folder}`;
}

// --- exports ---

export class VisualPanel {
  static readonly viewType = 'promptStudio.visual';

  private static current: VisualPanel | undefined;

  // reveal the single canvas panel, creating it on first use, then point it at folder
  static show(
    extensionUri: vscode.Uri,
    config: VaultConfig,
    vaultRoot: string,
    folder: string
  ): void {
    if (VisualPanel.current) {
      VisualPanel.current.panel.reveal(vscode.ViewColumn.Active);
      VisualPanel.current.navigate(folder);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VisualPanel.viewType,
      titleFor(folder),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );
    VisualPanel.current = new VisualPanel(panel, extensionUri, config, vaultRoot, folder);
  }

  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcherSubs: vscode.Disposable[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshScheduled = false;
  private folder: string;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly config: VaultConfig,
    private readonly vaultRoot: string,
    initialFolder: string
  ) {
    this.folder = initialFolder;
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => this.handle(msg)),
      this.panel.onDidDispose(() => this.dispose()),
      this.config.onDidChange(() => this.scheduleRefresh())
    );
    this.rebuildWatcher();
  }

  private dispose(): void {
    VisualPanel.current = undefined;

    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcher?.dispose();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // point the panel at a different folder inside the vault
  private navigate(folder: string): void {
    if (folder === this.folder || !isWithin(folder, this.vaultRoot)) {
      return;
    }

    this.folder = folder;
    this.panel.title = titleFor(folder);
    this.rebuildWatcher();
    void this.postState();
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

  // refresh on note add/delete/change, the config store owns config.yml events
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
        this.config.setPosition(msg.path, { x: msg.x, y: msg.y });
        this.config.setZ(msg.path, msg.z);
        return;
      case 'resizeCard':
        this.config.setSize(msg.path, { width: msg.width, height: msg.height });
        return;
      case 'setColor':
        if (msg.color === null) {
          this.config.setColor(msg.path, undefined);
        } else if (isCardColor(msg.color)) {
          this.config.setColor(msg.path, msg.color);
        }
        return;
      case 'command':
        if (ALLOWED_COMMANDS.has(msg.command)) {
          await vscode.commands.executeCommand(msg.command, msg.node);
        }
        return;
    }
  }

  private async postState(): Promise<void> {
    const state = await readFolder(this.config, this.vaultRoot, this.folder);
    await this.panel.webview.postMessage({ type: 'state', state });
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const nonce = randomNonce();
    const codiconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/codicons/codicon.css')
    );
    const paletteCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/common/palette.css')
    );
    const canvasCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/visual/canvas.css')
    );
    const canvasJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/visual/canvas.js')
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    const template = fs.readFileSync(
      path.join(this.extensionUri.fsPath, 'media/visual/canvas.html'),
      'utf8'
    );
    return fillTemplate(template, {
      csp,
      nonce,
      codiconCss: codiconCss.toString(),
      paletteCss: paletteCss.toString(),
      canvasCss: canvasCss.toString(),
      canvasJs: canvasJs.toString(),
      cardColors: JSON.stringify(CARD_COLORS)
    });
  }
}
