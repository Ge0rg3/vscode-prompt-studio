import * as path from 'node:path';

import * as vscode from 'vscode';

import { VaultManager } from './vaultManager';
import { VaultNode } from './vaultTreeDataProvider';

const NOTE_EXT = '.md';
const INVALID_NAME = /[\\/:*?"<>|]/;

// --- helpers ---

// reject empties, path separators, and OS-reserved characters
function validateEntryName(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return 'A name is required';
  }
  if (INVALID_NAME.test(trimmed)) {
    return 'Name must not contain / \\ : * ? " < > |';
  }
  return undefined;
}

// append .md if the user did not type the extension
function ensureNoteExt(name: string): string {
  return name.toLowerCase().endsWith(NOTE_EXT) ? name : `${name}${NOTE_EXT}`;
}

// pick the directory new entries should land in, context-menu arg wins over current selection
function resolveParentDir(
  vaultManager: VaultManager,
  treeView: vscode.TreeView<VaultNode>,
  contextNode: VaultNode | undefined
): string | undefined {
  const root = vaultManager.getVaultRoot();
  if (!root) {
    return undefined;
  }

  const target = contextNode ?? treeView.selection[0];
  if (!target) {
    return root;
  }

  return target.kind === 'folder' ? target.absPath : path.dirname(target.absPath);
}

// stat the uri, return true only when it resolves
async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
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

export function registerCreateNote(
  vaultManager: VaultManager,
  treeView: vscode.TreeView<VaultNode>
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.newNote',
    async (contextNode?: VaultNode) => {
      const parentDir = resolveParentDir(vaultManager, treeView, contextNode);
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

export function registerCreateFolder(
  vaultManager: VaultManager,
  treeView: vscode.TreeView<VaultNode>
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.newFolder',
    async (contextNode?: VaultNode) => {
      const parentDir = resolveParentDir(vaultManager, treeView, contextNode);
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
