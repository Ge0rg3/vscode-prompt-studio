// Reads the disk behind an @ mention, listing what a folder holds and checking a path exists
import * as vscode from 'vscode';

import { findTypeWithExactCase, isDirectory, ListingCache, matchCase, readChildren } from '../common/utils/fs';
import { MentionEntry } from './mentionIndex';

// List the files and folders inside an absolute path, empty when it cannot be read
export async function listDirectory(dirPath: string): Promise<MentionEntry[]> {
  if (!dirPath.startsWith('/')) {
    return [];
  }

  let root = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  let children = await readChildren(vscode.Uri.file(dirPath));

  // Retry the read with the typed casing corrected to what is on disk
  if (!children) {
    const resolved = await matchCase(dirPath);
    if (!resolved) {
      return [];
    }
    root = resolved;
    children = await readChildren(vscode.Uri.file(resolved));
    if (!children) {
      return [];
    }
  }

  const entries: MentionEntry[] = [];
  for (const [name, type] of children) {
    // Skip names that cannot appear in a mention, since @ starts one and a space ends it
    if (!/[\s@]/.test(name)) {
      entries.push({ path: `${root}${name}`, isFolder: isDirectory(type) });
    }
  }

  return entries;
}

// Keep the paths that exist on disk as written, reading a relative one from the workspace root
export async function existingPaths(paths: readonly string[]): Promise<MentionEntry[]> {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  const listings: ListingCache = new Map();
  const found: MentionEntry[] = [];

  for (const target of paths) {
    const base = target.startsWith('/') ? vscode.Uri.file('/') : workspace?.uri;
    if (!base) {
      continue;
    }

    // Skip a broken symlink, since it lists as neither a file nor a folder
    const type = await findTypeWithExactCase(base, target, listings);
    if (type !== undefined && (type & (vscode.FileType.File | vscode.FileType.Directory)) !== 0) {
      found.push({ path: target, isFolder: isDirectory(type) });
    }
  }

  return found;
}
