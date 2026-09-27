// Wires up every service, provider, and command when the extension activates
import * as vscode from 'vscode';

import { ColorPreview } from './common/cardColors';
import { ScopeManager } from './common/scopeManager';
import { VaultConfig } from './common/vaultConfig';
import { VaultManager } from './common/vaultManager';
import { HistoryCommands } from './history/historyCommands';
import { NoteHistory } from './history/noteHistory';
import { registerScopeCommands } from './scope/scopeCommands';
import { registerOpenSettings, registerSettingsSerializer } from './settings/openSettings';
import { SkillCommands } from './skills/skillCommands';
import { SkillsConfigs } from './skills/skillsConfigs';
import { SkillsWebviewProvider } from './skills/skillsWebviewProvider';
import { MentionIndex } from './template/mentionIndex';
import { TemplateCommands } from './template/openTemplate';
import { registerCreateFolder, registerCreateNote } from './vault/createEntries';
import {
  registerCopyContents,
  registerCopyPathRelative,
  registerCopyPathStatic,
  registerDeleteEntry,
  registerRenameEntry,
  registerRevealInOS
} from './vault/entryActions';
import { registerSendToClaude } from './vault/sendToClaude';
import { registerVaultViewCommands, VaultWebviewProvider } from './vault/vaultWebviewProvider';
import { VisualCommands } from './visual/openVisual';

// Keep the history at module level so deactivate can reach it
let noteHistory: NoteHistory | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Pick the project or global vault and read the metadata saved inside it
  const scopeManager = new ScopeManager(context.workspaceState);
  context.subscriptions.push(scopeManager);

  const vaultManager = new VaultManager(context.globalStorageUri.fsPath, context.workspaceState, scopeManager);
  context.subscriptions.push(vaultManager);

  const config = new VaultConfig(() => vaultManager.getVaultRoot(), vaultManager.onDidChangeVault);
  context.subscriptions.push(config);

  // Keep past versions of the vault's notes outside the vault
  noteHistory = new NoteHistory(context.globalStorageUri.fsPath, vaultManager);
  context.subscriptions.push(noteHistory);

  // Build the shared emitters, the views, and the command services
  const activeFolderEmitter = new vscode.EventEmitter<string | undefined>();
  context.subscriptions.push(activeFolderEmitter);

  const colorPreviewEmitter = new vscode.EventEmitter<ColorPreview>();
  context.subscriptions.push(colorPreviewEmitter);

  const provider = new VaultWebviewProvider(vaultManager, config, context.extensionUri, colorPreviewEmitter, scopeManager);
  context.subscriptions.push(provider);

  const skillsConfigs = new SkillsConfigs();
  context.subscriptions.push(skillsConfigs);

  const skillsProvider = new SkillsWebviewProvider(context.extensionUri, skillsConfigs, colorPreviewEmitter, scopeManager);
  context.subscriptions.push(skillsProvider);

  const mentionIndex = new MentionIndex();
  context.subscriptions.push(mentionIndex);

  const skillCommands = new SkillCommands(skillsProvider, context.extensionUri, skillsConfigs, colorPreviewEmitter, mentionIndex, scopeManager, noteHistory);
  const visualCommands = new VisualCommands(vaultManager, config, context.extensionUri, activeFolderEmitter, colorPreviewEmitter);
  const templateCommands = new TemplateCommands(context.extensionUri, mentionIndex, noteHistory);
  const historyCommands = new HistoryCommands(noteHistory);

  // Register every view, command, and listener
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
    registerOpenSettings(context.extensionUri, vaultManager),
    registerSettingsSerializer(context.extensionUri, vaultManager),
    registerVaultViewCommands(provider),
    registerScopeCommands(scopeManager),
    visualCommands.registerOpenCommand(),
    visualCommands.closeCanvasesOnVaultChange(),
    visualCommands.registerSerializer((root) => skillsConfigs.configFor(root)),
    registerCreateNote(vaultManager, config),
    registerCreateFolder(vaultManager, config),
    registerRenameEntry(config),
    registerDeleteEntry(config),
    registerCopyContents(),
    templateCommands.registerOpenCommand(),
    templateCommands.registerSerializer(),
    registerSendToClaude(),
    registerCopyPathStatic(),
    registerCopyPathRelative(vaultManager),
    registerRevealInOS(),
    historyCommands.register()
  );
}

// Snapshot the changes still waiting, or they get stamped with the next launch's time
export function deactivate(): Promise<void> | undefined {
  return noteHistory?.flushPending();
}
