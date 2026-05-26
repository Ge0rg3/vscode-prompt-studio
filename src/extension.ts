import * as vscode from 'vscode';

import { registerConfigureVault } from './vault/configureVault';
import { VaultManager } from './vault/vaultManager';
import { VaultViewProvider } from './vault/vaultView';

export function activate(context: vscode.ExtensionContext): void {
  const vaultManager = new VaultManager(context.globalStorageUri.fsPath);
  context.subscriptions.push(vaultManager);

  const vaultView = new VaultViewProvider(context.extensionUri, vaultManager);
  context.subscriptions.push(vaultView);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VaultViewProvider.viewType, vaultView),
    registerConfigureVault(vaultManager, context.globalStorageUri.fsPath)
  );
}
