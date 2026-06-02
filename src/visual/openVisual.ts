import * as path from 'node:path';

import * as vscode from 'vscode';

import { VaultConfig } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { VisualPanel } from './visualPanel';

// the folder to open as a canvas, a note uses its parent folder
function canvasFolder(contextNode: VaultNode | undefined, vaultRoot: string): string {
  if (contextNode?.kind === 'folder') {
    return contextNode.absPath;
  }
  if (contextNode?.kind === 'note') {
    return path.dirname(contextNode.absPath);
  }
  return vaultRoot;
}

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

      VisualPanel.show(extensionUri, config, root, canvasFolder(contextNode, root));
    }
  );
}
