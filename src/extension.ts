import * as vscode from 'vscode';

import { VaultConfig } from './common/vaultConfig';
import { VaultManager } from './common/vaultManager';
import { SkillCommands } from './skills/skillCommands';
import { skillsRoot } from './skills/skillScanner';
import { SkillsWebviewProvider } from './skills/skillsWebviewProvider';
import { registerConfigureVault } from './vault/configureVault';
import { registerCreateFolder, registerCreateNote } from './vault/createEntries';
import {
  registerCopyContents,
  registerCopyPathRelative,
  registerCopyPathStatic,
  registerDeleteEntry,
  registerRenameEntry,
  registerRevealInOS
} from './vault/entryActions';
import { registerOpenTemplate, registerTemplateSerializer } from './vault/openTemplate';
import { registerSendToClaude } from './vault/sendToClaude';
import { registerVaultViewCommands, VaultWebviewProvider } from './vault/vaultWebviewProvider';
import { VisualCommands } from './visual/openVisual';

export function activate(context: vscode.ExtensionContext): void {
  const vaultManager = new VaultManager(context.globalStorageUri.fsPath);
  context.subscriptions.push(vaultManager);

  const config = new VaultConfig(() => vaultManager.getVaultRoot(), vaultManager.onDidChangeVault);
  context.subscriptions.push(config);

  const activeFolderEmitter = new vscode.EventEmitter<string | undefined>();
  context.subscriptions.push(activeFolderEmitter);

  const provider = new VaultWebviewProvider(vaultManager, config, context.extensionUri);
  context.subscriptions.push(provider);

  const skillsProvider = new SkillsWebviewProvider(context.extensionUri);
  context.subscriptions.push(skillsProvider);

  const skillsConfig = new VaultConfig(() => skillsRoot(), vscode.workspace.onDidChangeWorkspaceFolders);
  context.subscriptions.push(skillsConfig);

  const skillCommands = new SkillCommands(skillsProvider, context.extensionUri, skillsConfig);
  const visualCommands = new VisualCommands(vaultManager, config, context.extensionUri, activeFolderEmitter);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VaultWebviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerWebviewViewProvider(SkillsWebviewProvider.viewType, skillsProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    skillCommands.register(),
    skillCommands.registerViewCommands(),
    activeFolderEmitter.event((folder) => provider.setActiveVisualFolder(folder)),
    registerConfigureVault(vaultManager, context.globalStorageUri.fsPath),
    registerVaultViewCommands(provider),
    visualCommands.registerOpenCommand(),
    visualCommands.registerSerializer(skillsConfig),
    registerCreateNote(vaultManager, config),
    registerCreateFolder(vaultManager, config),
    registerRenameEntry(config),
    registerDeleteEntry(config),
    registerCopyContents(),
    registerOpenTemplate(context.extensionUri),
    registerTemplateSerializer(context.extensionUri),
    registerSendToClaude(),
    registerCopyPathStatic(),
    registerCopyPathRelative(vaultManager),
    registerRevealInOS()
  );
}
