// Opens what an @ mention names, a file in an editor and a folder in the file manager
import * as path from 'node:path';

import * as vscode from 'vscode';

import { isDirectory } from '../common/utils/fs';

// --- helpers ---

// Work out where the mention points, resolving a relative path against the folder Claude Code runs in
function resolveMention(mentionPath: string): string | undefined {
  const target = mentionPath.replace(/\/+$/, '');
  if (target.length === 0) {
    return undefined;
  }
  if (target.startsWith('/')) {
    return target;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? path.join(folder.uri.fsPath, target) : undefined;
}

// --- exports ---

// Open the file or folder an @ mention names, warning when it has gone from disk
export async function openMention(mentionPath: string): Promise<void> {
  const target = resolveMention(mentionPath);
  if (!target) {
    return;
  }

  const uri = vscode.Uri.file(target);
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    void vscode.window.showWarningMessage(`Cannot open "${mentionPath}", it is not on disk.`);
    return;
  }

  // Go through vscode.open rather than showTextDocument, so an image or a PDF gets its own editor
  await vscode.commands.executeCommand(isDirectory(stat.type) ? 'revealFileInOS' : 'vscode.open', uri);
}
