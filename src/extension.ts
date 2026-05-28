import * as vscode from 'vscode';

import { VaultConfig } from './common/vaultConfig';
import { VaultManager } from './common/vaultManager';
import { registerConfigureVault } from './vault/configureVault';
import { registerCreateFolder, registerCreateNote } from './vault/createEntries';
import {
  registerCopyContents,
  registerRenameEntry,
  registerRevealInOS
} from './vault/entryActions';
import { VaultWebviewProvider } from './vault/vaultWebviewProvider';
import { registerOpenVisual } from './visual/openVisual';

export function activate(context: vscode.ExtensionContext): void {
  const vaultManager = new VaultManager(context.globalStorageUri.fsPath);
  context.subscriptions.push(vaultManager);

  const config = new VaultConfig(vaultManager);
  context.subscriptions.push(config);

  const provider = new VaultWebviewProvider(vaultManager, config, context.extensionUri);
  context.subscriptions.push(provider);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VaultWebviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    registerConfigureVault(vaultManager, context.globalStorageUri.fsPath),
    registerOpenVisual(vaultManager, config, context.extensionUri),
    registerCreateNote(vaultManager),
    registerCreateFolder(vaultManager),
    registerRenameEntry(config),
    registerCopyContents(),
    registerRevealInOS()
  );
}
