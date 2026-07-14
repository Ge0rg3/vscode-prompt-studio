import * as vscode from 'vscode';

import { MentionEntry } from './mentionIndex';

// --- helpers ---

// a symlinked folder reports as both a symlink and a directory
function isFolder(type: vscode.FileType): boolean {
  return (type & vscode.FileType.Directory) !== 0;
}

// --- exports ---

// what an absolute directory holds, empty when it cannot be read
export async function listDirectory(dirPath: string): Promise<MentionEntry[]> {
  if (!dirPath.startsWith('/')) {
    return [];
  }

  let children: [string, vscode.FileType][];
  try {
    children = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
  } catch {
    return [];
  }

  const root = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  const entries: MentionEntry[] = [];
  for (const [name, type] of children) {
    // a mention stops at whitespace, so a name holding any could never be written
    if (!/[\s@]/.test(name)) {
      entries.push({ path: `${root}${name}`, isFolder: isFolder(type) });
    }
  }

  return entries;
}

// the absolute paths that exist on disk
export async function existingPaths(paths: readonly string[]): Promise<MentionEntry[]> {
  const found: MentionEntry[] = [];
  for (const target of paths) {
    if (!target.startsWith('/')) {
      continue;
    }

    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(target));
      found.push({ path: target, isFolder: isFolder(stat.type) });
    } catch {
      continue;
    }
  }

  return found;
}
