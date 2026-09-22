// Registers the title-bar buttons that swap both sidebars between the project and the global collection
import * as vscode from 'vscode';

import { ScopeManager } from '../common/scopeManager';

export function registerScopeCommands(scopeManager: ScopeManager): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('promptStudio.useGlobalScope', () => scopeManager.setScope('global')),
    vscode.commands.registerCommand('promptStudio.useProjectScope', () => scopeManager.setScope('project'))
  );
}
