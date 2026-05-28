import * as vscode from 'vscode';

import { VaultConfig } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { VisualPanel } from './visualPanel';

export function registerOpenVisual(
  vaultManager: VaultManager,
  config: VaultConfig,
  extensionUri: vscode.Uri
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.openVisual',
    (contextNode?: VaultNode) => {
      const root = vaultManager.getVaultRoot();
      if (!root) {
        void vscode.window.showWarningMessage('Prompt Studio: configure a vault first.');
        return;
      }

      const folder = contextNode?.kind === 'folder' ? contextNode.absPath : root;
      VisualPanel.show(extensionUri, config, root, folder);
    }
  );
}
