import * as path from 'node:path';

import * as vscode from 'vscode';

import { pathExists } from '../common/utils/fs';
import { isWithin } from '../common/utils/paths';
import { VaultConfig } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { VisualPanel } from './visualPanel';

// --- helpers ---

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

// the folder path stashed in a restored panel's state
function readStateFolder(state: unknown): string | undefined {
  if (state && typeof state === 'object' && typeof (state as { folder?: unknown }).folder === 'string') {
    return (state as { folder: string }).folder;
  }
  return undefined;
}

// the folder to restore the canvas to, falling back to the vault root when the saved one is gone
async function restoreFolder(state: unknown, vaultRoot: string): Promise<string> {
  const folder = readStateFolder(state);
  if (folder && isWithin(folder, vaultRoot) && (await pathExists(vscode.Uri.file(folder)))) {
    return folder;
  }
  return vaultRoot;
}

// --- exports ---

export function registerOpenVisual(
  vaultManager: VaultManager,
  config: VaultConfig,
  extensionUri: vscode.Uri,
  activeFolderEmitter: vscode.EventEmitter<string | undefined>
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.openVisual',
    (contextNode?: VaultNode) => {
      const root = vaultManager.getVaultRoot();
      if (!root) {
        void vscode.window.showWarningMessage('Prompt Studio: configure a vault first.');
        return;
      }

      VisualPanel.show(extensionUri, config, root, activeFolderEmitter, canvasFolder(contextNode, root));
    }
  );
}

export function registerVisualSerializer(
  vaultManager: VaultManager,
  config: VaultConfig,
  extensionUri: vscode.Uri,
  activeFolderEmitter: vscode.EventEmitter<string | undefined>
): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(VisualPanel.viewType, {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
      const root = vaultManager.getVaultRoot();
      if (!root) {
        panel.dispose();
        return;
      }

      VisualPanel.restore(panel, extensionUri, config, root, activeFolderEmitter, await restoreFolder(state, root));
    }
  });
}
