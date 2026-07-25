import { mkdirSync } from 'node:fs';

import * as vscode from 'vscode';

// stat the uri, return true only when it resolves
export async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// a symlinked folder reports as both a symlink and a directory
export function isDirectory(type: vscode.FileType): boolean {
  return (type & vscode.FileType.Directory) !== 0;
}

// read a file as utf-8 text
export async function readTextFile(absPath: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
  return new TextDecoder('utf-8').decode(bytes);
}

// create the directory if missing
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
