import * as path from 'node:path';

import * as vscode from 'vscode';

import { CardLayoutStore } from '../common/cardLayoutStore';
import { pathExists } from '../common/utils/fs';
import { isWithin } from '../common/utils/paths';
import { readBooleanField, readStringField } from '../common/utils/webview';
import { VaultConfig } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { CanvasContext, VisualPanel } from './visualPanel';

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

// the editable vault canvas, navigation tracks the sidebar selection
function vaultContext(
  store: VaultConfig,
  root: string,
  activeFolderEmitter: vscode.EventEmitter<string | undefined>
): CanvasContext {
  return { store, root, allowCrud: true, activeFolderEmitter };
}

// a read-only canvas over a skill folder, layout kept in .claude/skills/config.yml
function skillContext(store: CardLayoutStore, root: string): CanvasContext {
  return { store, root, allowCrud: false };
}

// the folder to restore the canvas to, falling back to the root when the saved one is gone
async function restoreFolder(state: unknown, root: string): Promise<string> {
  const folder = readStringField(state, 'folder');
  if (folder && isWithin(folder, root) && (await pathExists(vscode.Uri.file(folder)))) {
    return folder;
  }
  return root;
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

      const context = vaultContext(config, root, activeFolderEmitter);
      VisualPanel.show(extensionUri, context, canvasFolder(contextNode, root));
    }
  );
}

export function registerVisualSerializer(
  vaultManager: VaultManager,
  config: VaultConfig,
  skillStore: CardLayoutStore,
  extensionUri: vscode.Uri,
  activeFolderEmitter: vscode.EventEmitter<string | undefined>
): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(VisualPanel.viewType, {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
      const root = readStringField(state, 'root');

      // a skill canvas, marked read-only in its saved state, restored if its folder still exists
      if (readBooleanField(state, 'allowCrud') === false && root && (await pathExists(vscode.Uri.file(root)))) {
        VisualPanel.restore(panel, extensionUri, skillContext(skillStore, root), await restoreFolder(state, root));
        return;
      }

      // the vault canvas, also the fallback for any state not marked read-only
      const vaultRoot = vaultManager.getVaultRoot();
      if (!vaultRoot) {
        panel.dispose();
        return;
      }
      const context = vaultContext(config, vaultRoot, activeFolderEmitter);
      VisualPanel.restore(panel, extensionUri, context, await restoreFolder(state, vaultRoot));
    }
  });
}
