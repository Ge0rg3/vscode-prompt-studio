import * as vscode from 'vscode';

import { registerConfigureVault } from './vault/configureVault';
import { registerCreateFolder, registerCreateNote } from './vault/createEntries';
import { VaultManager } from './vault/vaultManager';
import { VaultTreeDataProvider } from './vault/vaultTreeDataProvider';

const VAULT_VIEW_ID = 'promptStudio.vault';

export function activate(context: vscode.ExtensionContext): void {
  const vaultManager = new VaultManager(context.globalStorageUri.fsPath);
  context.subscriptions.push(vaultManager);

  const treeDataProvider = new VaultTreeDataProvider(vaultManager);
  context.subscriptions.push(treeDataProvider);

  const treeView = vscode.window.createTreeView(VAULT_VIEW_ID, {
    treeDataProvider,
    dragAndDropController: treeDataProvider,
    showCollapseAll: true,
    canSelectMany: false
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    treeView.onDidExpandElement(({ element }) => treeDataProvider.setExpanded(element, true)),
    treeView.onDidCollapseElement(({ element }) => treeDataProvider.setExpanded(element, false)),
    registerConfigureVault(vaultManager, context.globalStorageUri.fsPath),
    registerCreateNote(vaultManager, treeView),
    registerCreateFolder(vaultManager, treeView)
  );
}
