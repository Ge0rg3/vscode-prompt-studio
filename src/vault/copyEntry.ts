// Pastes a copied note or folder into the vault under a free name
import * as path from 'node:path';

import * as vscode from 'vscode';

import { isWithin } from '../common/utils/paths';
import { VaultNode } from '../common/vaultNode';

// --- helpers ---

// Pick the folder a paste lands in, a folder pasted into itself goes beside it instead
function resolvePasteDir(sourcePath: string, contextNode: VaultNode | undefined, vaultRoot: string): string {
  let preferred = vaultRoot;
  if (contextNode) {
    const contextDir = contextNode.kind === 'folder' ? contextNode.absPath : path.dirname(contextNode.absPath);
    preferred = path.resolve(contextDir);
  }

  return isWithin(preferred, sourcePath) ? path.dirname(sourcePath) : preferred;
}

// Find a free name in the target folder, adding " (Copy)" then " (Copy N)" on a clash
async function uniqueCopyName(targetDir: string, name: string, kind: 'note' | 'folder'): Promise<string> {
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(targetDir));
  const taken = new Set<string>();
  for (const [existing] of entries) {
    taken.add(existing.toLowerCase());
  }
  const isFree = (candidate: string): boolean => !taken.has(candidate.toLowerCase());

  if (isFree(name)) {
    return name;
  }

  // Split off the extension and drop any copy suffix already there so copies never stack
  const dotIndex = kind === 'note' ? name.toLowerCase().lastIndexOf('.md') : -1;
  const ext = dotIndex >= 0 ? name.slice(dotIndex) : '';
  const stem = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
  const core = stem.replace(/ \(Copy(?: \d+)?\)$/, '');

  const firstCopy = `${core} (Copy)${ext}`;
  if (isFree(firstCopy)) {
    return firstCopy;
  }

  for (let n = 2; ; n++) {
    const candidate = `${core} (Copy ${n})${ext}`;
    if (isFree(candidate)) {
      return candidate;
    }
  }
}

// --- exports ---

// Copy an entry into the folder a paste lands in, undefined when the source is gone or the paste is refused
export async function pasteVaultEntry(
  vaultRoot: string,
  sourcePath: string,
  contextNode: VaultNode | undefined
): Promise<string | undefined> {
  const resolvedRoot = path.resolve(vaultRoot);
  const resolvedSource = path.resolve(sourcePath);

  // Copy only from inside the vault, never the root itself
  if (!isWithin(resolvedSource, resolvedRoot) || resolvedSource === resolvedRoot) {
    return undefined;
  }

  let sourceStat: vscode.FileStat;
  try {
    sourceStat = await vscode.workspace.fs.stat(vscode.Uri.file(resolvedSource));
  } catch {
    return undefined;
  }

  // Work out where the copy lands
  const targetDir = resolvePasteDir(resolvedSource, contextNode, resolvedRoot);
  if (!isWithin(targetDir, resolvedRoot)) {
    return undefined;
  }

  // Work out a free name for the copy
  const kind = sourceStat.type === vscode.FileType.Directory ? 'folder' : 'note';
  const name = await uniqueCopyName(targetDir, path.basename(resolvedSource), kind);
  const destination = vscode.Uri.file(path.join(targetDir, name));

  await vscode.workspace.fs.copy(vscode.Uri.file(resolvedSource), destination, { overwrite: false });
  return destination.fsPath;
}
