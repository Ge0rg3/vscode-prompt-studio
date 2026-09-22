// Hosts the settings page webview and applies the choices made on it
import * as vscode from 'vscode';

import { defaultNoteView, NOTE_VIEWS, NoteView, onDidChangeNoteView, setDefaultNoteView } from '../common/noteView';
import { assetUri, renderWebviewHtml } from '../common/utils/webview';
import { VaultManager } from '../common/vaultManager';
import {
  applyGlobalVaultMode,
  applyProjectVaultMode,
  currentGlobalVaultMode,
  currentProjectVaultMode,
  GLOBAL_VAULT_MODES,
  GlobalVaultMode,
  PROJECT_VAULT_MODES,
  ProjectVaultMode
} from '../vault/vaultLocation';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'setNoteView'; view: NoteView }
  | { type: 'setProjectVaultMode'; mode: ProjectVaultMode }
  | { type: 'setGlobalVaultMode'; mode: GlobalVaultMode };

const PANEL_TITLE = 'Prompt Studio Settings';

export class SettingsPanel {
  static readonly viewType = 'promptStudio.settings';

  private static openPanel: SettingsPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly vaultManager: VaultManager
  ) {
    this.panel.title = PANEL_TITLE;
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => this.handle(msg)),
      this.panel.onDidDispose(() => this.dispose()),
      onDidChangeNoteView(() => this.postState()),
      vaultManager.onDidChangeVault(() => this.postState()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.postState()),

      // Catch up on anything another window changed while the tab was away
      this.panel.onDidChangeViewState(() => this.postState())
    );
  }

  private dispose(): void {
    SettingsPanel.openPanel = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // Act on one message from the settings webview
  private async handle(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postState();
        return;
      case 'setNoteView':
        if (!NOTE_VIEWS.includes(msg.view)) {
          return;
        }

        await setDefaultNoteView(msg.view);

        // Show what the setting reads back as, since a workspace entry can outrank the write
        this.postState();
        return;
      case 'setProjectVaultMode':
        if (!PROJECT_VAULT_MODES.includes(msg.mode)) {
          return;
        }

        await applyProjectVaultMode(msg.mode, this.vaultManager);

        // Put the page back on the saved choice, since a cancelled dialog moves nothing
        this.postState();
        return;
      case 'setGlobalVaultMode':
        if (!GLOBAL_VAULT_MODES.includes(msg.mode)) {
          return;
        }

        await applyGlobalVaultMode(msg.mode, this.vaultManager);
        this.postState();
        return;
    }
  }

  private postState(): void {
    void this.panel.webview.postMessage({
      type: 'state',
      noteView: defaultNoteView(),
      projectVaultRoot: this.vaultManager.projectVaultRoot() ?? null,
      projectVaultMode: currentProjectVaultMode(this.vaultManager),
      globalVaultRoot: this.vaultManager.globalVaultRoot(),
      globalVaultMode: currentGlobalVaultMode(this.vaultManager),
      hasWorkspace: (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    });
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    return renderWebviewHtml(webview, this.extensionUri, 'media/settings/settings.html', {
      codiconCss: assetUri(webview, this.extensionUri, 'media/codicons/codicon.css'),
      settingsCss: assetUri(webview, this.extensionUri, 'media/settings/settings.css'),
      settingsJs: assetUri(webview, this.extensionUri, 'media/settings/settings.js')
    });
  }

  // Allow scripts and limit asset loads to the bundled media folder
  private static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    };
  }

  // Reveal the settings page, creating it on first use
  static show(extensionUri: vscode.Uri, vaultManager: VaultManager): void {
    if (SettingsPanel.openPanel) {
      SettingsPanel.openPanel.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      PANEL_TITLE,
      vscode.ViewColumn.Active,
      SettingsPanel.webviewOptions(extensionUri)
    );
    SettingsPanel.openPanel = new SettingsPanel(panel, extensionUri, vaultManager);
  }

  // Reattach the settings page VSCode restored after a window reload
  static restore(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, vaultManager: VaultManager): void {
    if (SettingsPanel.openPanel) {
      panel.dispose();
      return;
    }

    panel.webview.options = SettingsPanel.webviewOptions(extensionUri);
    SettingsPanel.openPanel = new SettingsPanel(panel, extensionUri, vaultManager);
  }
}
