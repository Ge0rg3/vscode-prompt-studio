import * as path from 'node:path';

import * as vscode from 'vscode';

import { copyPathToClipboard } from '../common/utils/clipboard';
import { pathExists } from '../common/utils/fs';
import { relativeToRoot } from '../common/utils/paths';
import { VaultConfig } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { ensureNoteExt, validateEntryName } from './entryName';

// --- helpers ---

// the name shown in the tree, notes drop the .md extension
function displayName(node: VaultNode): string {
  return node.kind === 'folder' ? node.name : node.name.replace(/\.md$/i, '');
}

// pre-fill the rename box with the tree name, selecting all of it
function renamePrefill(node: VaultNode): { value: string; selectionEnd: number } {
  const value = displayName(node);
  return { value, selectionEnd: value.length };
}

// --- exports ---

export function registerRevealInOS(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.revealInOS',
    async (target?: { absPath: string }) => {
      if (!target) {
        return;
      }

      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target.absPath));
    }
  );
}

export function registerCopyContents(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.copyContents',
    async (target?: VaultNode) => {
      if (!target || target.kind !== 'note') {
        return;
      }

      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target.absPath));
      const text = new TextDecoder('utf-8').decode(bytes);
      await vscode.env.clipboard.writeText(text);
      void vscode.window.setStatusBarMessage(`Copied "${target.name}" to clipboard.`, 2000);
    }
  );
}

export function registerCopyPathStatic(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.copyPathStatic',
    async (target?: VaultNode) => {
      if (!target) {
        return;
      }

      await copyPathToClipboard(target.absPath, target.name);
    }
  );
}

export function registerCopyPathRelative(vaultManager: VaultManager): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.copyPathRelative',
    async (target?: VaultNode) => {
      const vaultRoot = vaultManager.getVaultRoot();
      if (!target || !vaultRoot) {
        return;
      }

      await copyPathToClipboard(relativeToRoot(vaultRoot, target.absPath), target.name);
    }
  );
}

export function registerRenameEntry(config: VaultConfig): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.rename', async (target?: VaultNode) => {
    if (!target) {
      return;
    }

    const { value, selectionEnd } = renamePrefill(target);
    const input = await vscode.window.showInputBox({
      title: target.kind === 'folder' ? 'Rename folder' : 'Rename note',
      value,
      valueSelection: [0, selectionEnd],
      validateInput: validateEntryName
    });
    if (!input) {
      return;
    }

    const trimmed = input.trim();
    const nextName = target.kind === 'note' ? ensureNoteExt(trimmed) : trimmed;
    if (nextName === target.name) {
      return;
    }

    const destination = vscode.Uri.file(path.join(path.dirname(target.absPath), nextName));
    if (await pathExists(destination)) {
      const label = target.kind === 'folder' ? 'folder' : 'file';
      void vscode.window.showErrorMessage(`A ${label} named "${nextName}" already exists.`);
      return;
    }

    await vscode.workspace.fs.rename(vscode.Uri.file(target.absPath), destination);
    config.relocate(target.absPath, destination.fsPath);
  });
}

export function registerDeleteEntry(config: VaultConfig): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.delete', async (target?: VaultNode) => {
    if (!target) {
      return;
    }

    const label = target.kind === 'folder' ? 'folder' : 'note';
    const detail =
      target.kind === 'folder' ? 'The folder and everything inside it will be deleted.' : undefined;
    const choice = await vscode.window.showWarningMessage(
      `Delete ${label} "${displayName(target)}"?`,
      { modal: true, detail },
      'Delete'
    );
    if (choice !== 'Delete') {
      return;
    }

    await vscode.workspace.fs.delete(vscode.Uri.file(target.absPath), { recursive: true });
    config.remove(target.absPath);
  });
}
