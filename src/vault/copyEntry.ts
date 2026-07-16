import * as path from 'node:path';

import * as vscode from 'vscode';

import { isWithin } from '../common/utils/paths';
import { VaultNode } from '../common/vaultNode';

// --- helpers ---

// the directory a paste lands in, dropping to a sibling when it would nest a folder inside itself
function resolvePasteDir(sourcePath: string, contextNode: VaultNode | undefined, vaultRoot: string): string {
  let preferred = vaultRoot;
  if (contextNode) {
    const contextDir = contextNode.kind === 'folder' ? contextNode.absPath : path.dirname(contextNode.absPath);
    preferred = path.resolve(contextDir);
  }

  return isWithin(preferred, sourcePath) ? path.dirname(sourcePath) : preferred;
}

// a name free in targetDir, appending " (Copy)" then " (Copy N)" on a clash
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

// copy sourcePath into the paste directory under a unique name, or bail on a missing source
export async function pasteVaultEntry(
  vaultRoot: string,
  sourcePath: string,
  contextNode: VaultNode | undefined
): Promise<string | undefined> {
  const resolvedRoot = path.resolve(vaultRoot);
  const resolvedSource = path.resolve(sourcePath);

  if (!isWithin(resolvedSource, resolvedRoot) || resolvedSource === resolvedRoot) {
    return undefined;
  }

  let sourceStat: vscode.FileStat;
  try {
    sourceStat = await vscode.workspace.fs.stat(vscode.Uri.file(resolvedSource));
  } catch {
    return undefined;
  }

  const targetDir = resolvePasteDir(resolvedSource, contextNode, resolvedRoot);
  if (!isWithin(targetDir, resolvedRoot)) {
    return undefined;
  }

  const kind = sourceStat.type === vscode.FileType.Directory ? 'folder' : 'note';
  const name = await uniqueCopyName(targetDir, path.basename(resolvedSource), kind);
  const destination = vscode.Uri.file(path.join(targetDir, name));

  await vscode.workspace.fs.copy(vscode.Uri.file(resolvedSource), destination, { overwrite: false });
  return destination.fsPath;
}
