import * as vscode from 'vscode';

import { VaultViewProvider } from './vault/vaultView';

export function activate(context: vscode.ExtensionContext): void {
  const vaultView = new VaultViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VaultViewProvider.viewType, vaultView)
  );
}
