import * as vscode from 'vscode';

import { MentionEntry } from './mentionIndex';

// --- helpers ---

// a symlinked folder reports as both a symlink and a directory
function isFolder(type: vscode.FileType): boolean {
  return (type & vscode.FileType.Directory) !== 0;
}

// the directory's children, or undefined when it cannot be read
async function readChildren(dirPath: string): Promise<[string, vscode.FileType][] | undefined> {
  try {
    return await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
  } catch {
    return undefined;
  }
}

// the typed directory with each segment matched to its on-disk casing, exact names first
async function matchCase(dirPath: string): Promise<string | undefined> {
  let resolved = '/';
  for (const segment of dirPath.split('/')) {
    if (segment.length === 0) {
      continue;
    }

    const children = await readChildren(resolved);
    if (!children) {
      return undefined;
    }

    const lowerSegment = segment.toLowerCase();
    let matched: string | undefined;
    for (const [name, type] of children) {
      if (!isFolder(type) || name.toLowerCase() !== lowerSegment) {
        continue;
      }
      if (name === segment) {
        matched = name;
        break;
      }
      matched ??= name;
    }
    if (!matched) {
      return undefined;
    }

    resolved += `${matched}/`;
  }

  return resolved;
}

// --- exports ---

// what an absolute directory holds, the path matched case-insensitively, empty when unreadable
export async function listDirectory(dirPath: string): Promise<MentionEntry[]> {
  if (!dirPath.startsWith('/')) {
    return [];
  }

  let root = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  let children = await readChildren(dirPath);

  // retry the read with the typed casing corrected to what is on disk
  if (!children) {
    const resolved = await matchCase(dirPath);
    if (!resolved) {
      return [];
    }
    root = resolved;
    children = await readChildren(resolved);
    if (!children) {
      return [];
    }
  }

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
