// Registers the commands that open a card canvas and reattaches panels after a reload
import * as path from 'node:path';

import * as vscode from 'vscode';

import { ColorPreview } from '../common/cardColors';
import { CardLayoutStore } from '../common/cardLayoutStore';
import { pathExists } from '../common/utils/fs';
import { isWithin } from '../common/utils/paths';
import { readBooleanField, readStringField } from '../common/utils/webview';
import { VaultConfig } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { CanvasContext, VisualPanel } from './visualPanel';

export class VisualCommands {
  constructor(
    private readonly vaultManager: VaultManager,
    private readonly config: VaultConfig,
    private readonly extensionUri: vscode.Uri,
    private readonly activeFolderEmitter: vscode.EventEmitter<string | undefined>,
    private readonly colorPreviewEmitter: vscode.EventEmitter<ColorPreview>
  ) {}

  // Open the vault canvas at the context node's folder, or the root when nothing is selected
  registerOpenCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('promptStudio.openVisual', (contextNode?: VaultNode) => {
      const root = this.vaultManager.getVaultRoot();
      if (!root) {
        void vscode.window.showWarningMessage('Prompt Studio: set a vault in Settings first.');
        return;
      }

      VisualPanel.show(this.extensionUri, this.vaultContext(root), this.canvasFolder(contextNode, root));
    });
  }

  // Close the vault canvases when the vault changes folder, since their cards belong to the old one
  closeCanvasesOnVaultChange(): vscode.Disposable {
    return this.vaultManager.onDidChangeVault(() => VisualPanel.closeVaultCanvases());
  }

  // Reattach canvas panels VSCode restored after a window reload
  registerSerializer(resolveSkillStore: (root: string) => CardLayoutStore | undefined): vscode.Disposable {
    return vscode.window.registerWebviewPanelSerializer(VisualPanel.viewType, {
      deserializeWebviewPanel: async (panel: vscode.WebviewPanel, state: unknown): Promise<void> => {
        const root = readStringField(state, 'root');

        // Restore a read-only skill canvas, dropping the panel when its folder is gone
        if (readBooleanField(state, 'allowCrud') === false) {
          if (!root || !(await pathExists(vscode.Uri.file(root)))) {
            panel.dispose();
            return;
          }

          const store = resolveSkillStore(root);
          if (!store) {
            panel.dispose();
            return;
          }

          VisualPanel.restore(panel, this.extensionUri, this.skillContext(store, root), await this.restoreFolder(state, root));
          return;
        }

        // Restore the vault canvas, dropping a panel whose saved root is no longer the vault
        const vaultRoot = this.vaultManager.getVaultRoot();
        if (!vaultRoot || (root && root !== vaultRoot)) {
          panel.dispose();
          return;
        }
        VisualPanel.restore(panel, this.extensionUri, this.vaultContext(vaultRoot), await this.restoreFolder(state, vaultRoot));
      }
    });
  }

  // Build the editable context for the vault canvas
  private vaultContext(root: string): CanvasContext {
    return {
      store: this.config,
      root,
      allowCrud: true,
      activeFolderEmitter: this.activeFolderEmitter,
      colorPreviewEmitter: this.colorPreviewEmitter
    };
  }

  // Pick the folder to open as a canvas, using the parent folder for a note
  private canvasFolder(contextNode: VaultNode | undefined, vaultRoot: string): string {
    if (contextNode?.kind === 'folder') {
      return contextNode.absPath;
    }
    if (contextNode?.kind === 'note') {
      return path.dirname(contextNode.absPath);
    }
    return vaultRoot;
  }

  // Build a read-only context over a skill folder
  private skillContext(store: CardLayoutStore, root: string): CanvasContext {
    return { store, root, allowCrud: false, colorPreviewEmitter: this.colorPreviewEmitter };
  }

  // Restore the saved folder when it still exists inside the root, else the root itself
  private async restoreFolder(state: unknown, root: string): Promise<string> {
    const folder = readStringField(state, 'folder');
    if (folder && isWithin(folder, root) && (await pathExists(vscode.Uri.file(folder)))) {
      return folder;
    }
    return root;
  }
}
