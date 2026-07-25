// Checks, reads, and creates files and folders on disk
import { mkdirSync } from 'node:fs';

import * as vscode from 'vscode';

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
