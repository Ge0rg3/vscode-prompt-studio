import * as path from 'node:path';

import * as vscode from 'vscode';

import { pathExists } from '../common/utils/fs';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { ensureNoteExt, validateEntryName } from './entryName';

// --- helpers ---

// pick the directory new entries should land in, context node wins over vault root
function resolveParentDir(
  vaultManager: VaultManager,
  contextNode: VaultNode | undefined
): string | undefined {
  const root = vaultManager.getVaultRoot();
  if (!root) {
    return undefined;
  }
  if (!contextNode) {
    return root;
  }
  return contextNode.kind === 'folder' ? contextNode.absPath : path.dirname(contextNode.absPath);
}

// surface a warning and bail when no vault is configured
function ensureVault(parentDir: string | undefined): parentDir is string {
  if (parentDir) {
    return true;
  }
  void vscode.window.showWarningMessage('Prompt Studio: configure a vault first.');
  return false;
}

// --- exports ---

export function registerCreateNote(vaultManager: VaultManager): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.newNote',
    async (contextNode?: VaultNode) => {
      const parentDir = resolveParentDir(vaultManager, contextNode);
      if (!ensureVault(parentDir)) {
        return;
      }

      const input = await vscode.window.showInputBox({
        title: 'New note',
        prompt: 'Filename',
        value: 'Untitled.md',
        valueSelection: [0, 'Untitled'.length],
        validateInput: validateEntryName
      });
      if (!input) {
        return;
      }

      const filename = ensureNoteExt(input.trim());
      const target = vscode.Uri.file(path.join(parentDir, filename));

      if (await pathExists(target)) {
        void vscode.window.showErrorMessage(`A file named "${filename}" already exists.`);
        return;
      }

      await vscode.workspace.fs.writeFile(target, new Uint8Array());
      await vscode.commands.executeCommand('vscode.open', target);
    }
  );
}

export function registerCreateFolder(vaultManager: VaultManager): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.newFolder',
    async (contextNode?: VaultNode) => {
      const parentDir = resolveParentDir(vaultManager, contextNode);
      if (!ensureVault(parentDir)) {
        return;
      }

      const input = await vscode.window.showInputBox({
        title: 'New folder',
        prompt: 'Folder name',
        validateInput: validateEntryName
      });
      if (!input) {
        return;
      }

      const folderName = input.trim();
      const target = vscode.Uri.file(path.join(parentDir, folderName));

      if (await pathExists(target)) {
        void vscode.window.showErrorMessage(`A folder named "${folderName}" already exists.`);
        return;
      }

      await vscode.workspace.fs.createDirectory(target);
    }
  );
}
