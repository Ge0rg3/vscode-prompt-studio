import * as vscode from 'vscode';

import { VaultConfig } from './common/vaultConfig';
import { VaultManager } from './common/vaultManager';
import { registerConfigureVault } from './vault/configureVault';
import { registerCreateFolder, registerCreateNote } from './vault/createEntries';
import {
  registerCopyContents,
  registerCopyPath,
  registerDeleteEntry,
  registerRenameEntry,
  registerRevealInOS
} from './vault/entryActions';
import { registerSendToClaude } from './vault/sendToClaude';
import { registerVaultViewCommands, VaultWebviewProvider } from './vault/vaultWebviewProvider';
import { registerOpenVisual, registerVisualSerializer } from './visual/openVisual';

export function activate(context: vscode.ExtensionContext): void {
  const vaultManager = new VaultManager(context.globalStorageUri.fsPath);
  context.subscriptions.push(vaultManager);

  const config = new VaultConfig(vaultManager);
  context.subscriptions.push(config);

  const activeFolderEmitter = new vscode.EventEmitter<string | undefined>();
  context.subscriptions.push(activeFolderEmitter);

  const provider = new VaultWebviewProvider(vaultManager, config, context.extensionUri);
  context.subscriptions.push(provider);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VaultWebviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    activeFolderEmitter.event((folder) => provider.setActiveVisualFolder(folder)),
    registerConfigureVault(vaultManager, context.globalStorageUri.fsPath),
    registerVaultViewCommands(provider),
    registerOpenVisual(vaultManager, config, context.extensionUri, activeFolderEmitter),
    registerVisualSerializer(vaultManager, config, context.extensionUri, activeFolderEmitter),
    registerCreateNote(vaultManager, config),
    registerCreateFolder(vaultManager, config),
    registerRenameEntry(config),
    registerDeleteEntry(config),
    registerCopyContents(),
    registerSendToClaude(),
    registerCopyPath(),
    registerRevealInOS()
  );
}
