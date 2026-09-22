// Registers the command that opens the settings page and reattaches it after a reload
import * as vscode from 'vscode';

import { VaultManager } from '../common/vaultManager';
import { SettingsPanel } from './settingsPanel';

// Open the settings page from the gear or the palette
export function registerOpenSettings(extensionUri: vscode.Uri, vaultManager: VaultManager): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.openSettings', () => {
    SettingsPanel.show(extensionUri, vaultManager);
  });
}

// Reattach the settings page VSCode restored after a window reload
export function registerSettingsSerializer(extensionUri: vscode.Uri, vaultManager: VaultManager): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(SettingsPanel.viewType, {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
      SettingsPanel.restore(panel, extensionUri, vaultManager);
    }
  });
}
