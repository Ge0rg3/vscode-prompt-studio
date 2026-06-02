import * as path from 'node:path';

import * as vscode from 'vscode';

import { pathExists } from '../common/utils/fs';
import { VaultConfig } from '../common/vaultConfig';
import { VaultNode } from '../common/vaultNode';
import { ensureNoteExt, validateEntryName } from './entryName';

// --- helpers ---

// notes show without .md in the tree, pre-fill the rename box with the same stem
function renamePrefill(node: VaultNode): { value: string; selectionEnd: number } {
  if (node.kind === 'folder') {
    return { value: node.name, selectionEnd: node.name.length };
  }
  const stem = node.name.replace(/\.md$/i, '');
  return { value: stem, selectionEnd: stem.length };
}

// --- exports ---

export function registerRevealInOS(): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.revealInOS', async (target?: VaultNode) => {
    if (!target) {
      return;
    }

    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target.absPath));
  });
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

export function registerCopyPath(): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.copyPath', async (target?: VaultNode) => {
    if (!target) {
      return;
    }

    await vscode.env.clipboard.writeText(target.absPath);
    void vscode.window.setStatusBarMessage(`Copied path of "${target.name}" to clipboard.`, 2000);
  });
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
