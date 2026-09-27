// Registers the row commands for revealing, copying, renaming, and deleting an entry
import * as path from 'node:path';

import * as vscode from 'vscode';

import { dropNoteAttachments } from '../common/noteAttachments';
import { copyPathToClipboard } from '../common/utils/clipboard';
import { pathExists } from '../common/utils/fs';
import { relativeToRoot } from '../common/utils/paths';
import { flashStatusMessage } from '../common/utils/statusBar';
import { VaultConfig } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { VaultNode } from '../common/vaultNode';
import { ensureNoteExt, validateEntryName } from './entryName';

// --- helpers ---

// Build the name the tree shows, notes drop the .md
function displayName(node: VaultNode): string {
  return node.kind === 'folder' ? node.name : node.name.replace(/\.md$/i, '');
}

// Pre-fill the rename box with the name the tree shows and select all of it
function renamePrefill(node: VaultNode): { value: string; selectionEnd: number } {
  const value = displayName(node);
  return { value, selectionEnd: value.length };
}

// Rename an entry in place, stopping on an unchanged name or one already taken
async function renameVaultEntry(node: VaultNode, newName: string): Promise<string | undefined> {
  const nextName = node.kind === 'note' ? ensureNoteExt(newName) : newName;
  if (nextName === node.name) {
    return undefined;
  }

  const destination = vscode.Uri.file(path.join(path.dirname(node.absPath), nextName));
  if (await pathExists(destination)) {
    const label = node.kind === 'folder' ? 'folder' : 'file';
    void vscode.window.showErrorMessage(`A ${label} named "${nextName}" already exists.`);
    return undefined;
  }

  await vscode.workspace.fs.rename(vscode.Uri.file(node.absPath), destination);
  return destination.fsPath;
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
      flashStatusMessage(`Copied "${target.name}" to clipboard.`);
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

// Rename an entry and carry its saved color and layout across, false on an unchanged or taken name
export async function renameEntry(
  config: VaultConfig,
  node: VaultNode,
  newName: string
): Promise<boolean> {
  const destination = await renameVaultEntry(node, newName);
  if (!destination) {
    return false;
  }

  config.relocate(node.absPath, destination);
  return true;
}

export function registerRenameEntry(config: VaultConfig): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.rename', async (target?: VaultNode) => {
    if (!target) {
      return;
    }

    // Ask for the new name
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

    await renameEntry(config, target, input.trim());
  });
}

export function registerDeleteEntry(config: VaultConfig): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.delete', async (target?: VaultNode) => {
    if (!target) {
      return;
    }

    // Confirm first, deleting a folder takes everything inside it
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

    // Drop the files only this note named, while it is still there to read
    if (target.kind === 'note') {
      await dropNoteAttachments(target.absPath);
    }

    // Delete it and drop its saved color and layout
    await vscode.workspace.fs.delete(vscode.Uri.file(target.absPath), { recursive: true });
    config.remove(target.absPath);
  });
}
