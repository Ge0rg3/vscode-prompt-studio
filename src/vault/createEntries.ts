import * as path from 'node:path';

import * as vscode from 'vscode';

import { NotePosition } from '../common/cardLayoutStore';
import { pathExists } from '../common/utils/fs';
import { VaultConfig } from '../common/vaultConfig';
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

// create a note or folder, bail on a name conflict
async function createVaultEntry(
  parentDir: string,
  name: string,
  kind: 'note' | 'folder'
): Promise<string | undefined> {
  const target = vscode.Uri.file(path.join(parentDir, name));
  if (await pathExists(target)) {
    const label = kind === 'folder' ? 'folder' : 'file';
    void vscode.window.showErrorMessage(`A ${label} named "${name}" already exists.`);
    return undefined;
  }

  if (kind === 'folder') {
    await vscode.workspace.fs.createDirectory(target);
  } else {
    await vscode.workspace.fs.writeFile(target, new Uint8Array());
  }
  return target.fsPath;
}

// --- exports ---

export function registerCreateNote(
  vaultManager: VaultManager,
  config: VaultConfig
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.newNote',
    async (contextNode?: VaultNode, position?: NotePosition) => {
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
      const created = await createVaultEntry(parentDir, filename, 'note');
      if (!created) {
        return;
      }

      if (position) {
        config.setPosition(created, position);
      }
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(created));
    }
  );
}

export function registerCreateFolder(
  vaultManager: VaultManager,
  config: VaultConfig
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.newFolder',
    async (contextNode?: VaultNode, position?: NotePosition) => {
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
      const created = await createVaultEntry(parentDir, folderName, 'folder');
      if (!created) {
        return;
      }

      if (position) {
        config.setPosition(created, position);
      }
    }
  );
}
