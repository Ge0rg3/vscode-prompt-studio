// Checks, reads, and creates files and folders on disk
import { mkdirSync } from 'node:fs';

import * as vscode from 'vscode';

type DirectoryListing = readonly [string, vscode.FileType][];

// Folder reads shared across one batch of lookups, keyed by folder uri
export type ListingCache = Map<string, Promise<DirectoryListing | undefined>>;

// Treat a failed stat as a missing path
export async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// Treat a symlinked folder as a folder, since it reports as both a symlink and a directory
export function isDirectory(type: vscode.FileType): boolean {
  return (type & vscode.FileType.Directory) !== 0;
}

// Read a directory's children, undefined when it cannot be read
export async function readChildren(dir: vscode.Uri): Promise<DirectoryListing | undefined> {
  try {
    return await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return undefined;
  }
}

// Match each path segment to its casing on disk, preferring the segment as typed
export async function matchCase(dirPath: string): Promise<string | undefined> {
  let resolved = '/';
  for (const segment of dirPath.split('/')) {
    if (segment.length === 0) {
      continue;
    }

    const children = await readChildren(vscode.Uri.file(resolved));
    if (!children) {
      return undefined;
    }

    const lowerSegment = segment.toLowerCase();
    let matched: string | undefined;
    for (const [name, type] of children) {
      if (!isDirectory(type) || name.toLowerCase() !== lowerSegment) {
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

// Walk a path down from a folder, undefined unless every segment is on disk with the same case
export async function findTypeWithExactCase(base: vscode.Uri, targetPath: string, listings: ListingCache): Promise<vscode.FileType | undefined> {
  let dir = base;
  let type = vscode.FileType.Directory;

  for (const segment of targetPath.split('/')) {
    if (segment.length === 0) {
      continue;
    }
    if (!isDirectory(type)) {
      return undefined;
    }

    const key = dir.toString();
    let listing = listings.get(key);
    if (!listing) {
      listing = readChildren(dir);
      listings.set(key, listing);
    }

    // Step only into names the folder lists, so a . or .. segment never matches
    const child = (await listing)?.find(([name]) => name === segment);
    if (!child) {
      return undefined;
    }

    type = child[1];
    dir = vscode.Uri.joinPath(dir, segment);
  }

  return type;
}

// Read a file as utf-8 text
export async function readTextFile(absPath: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
  return new TextDecoder('utf-8').decode(bytes);
}

// Create the directory and any missing parents
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
