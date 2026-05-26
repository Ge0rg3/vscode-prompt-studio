import * as path from 'node:path';

import * as vscode from 'vscode';

// --- helpers ---

// true when descendant equals or sits beneath ancestor, inputs must already be resolved
function pathContains(ancestor: string, descendant: string): boolean {
  return descendant === ancestor || descendant.startsWith(ancestor + path.sep);
}

// stat the uri, return true only when it resolves
async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// --- exports ---

// move sourcePath into targetDir, no-op when already there, surface a UI error on conflict
export async function moveVaultEntry(
  vaultRoot: string,
  sourcePath: string,
  targetDir: string
): Promise<boolean> {
  const resolvedRoot = path.resolve(vaultRoot);
  const resolvedSource = path.resolve(sourcePath);
  const resolvedTarget = path.resolve(targetDir);

  if (!pathContains(resolvedRoot, resolvedSource) || resolvedSource === resolvedRoot) {
    return false;
  }
  if (!pathContains(resolvedRoot, resolvedTarget)) {
    return false;
  }
  if (pathContains(resolvedSource, resolvedTarget)) {
    void vscode.window.showErrorMessage('Cannot move a folder into itself.');
    return false;
  }
  if (path.dirname(resolvedSource) === resolvedTarget) {
    return false;
  }

  const destination = path.join(resolvedTarget, path.basename(resolvedSource));
  if (await pathExists(vscode.Uri.file(destination))) {
    void vscode.window.showErrorMessage(
      `"${path.basename(resolvedSource)}" already exists in the destination folder.`
    );
    return false;
  }

  await vscode.workspace.fs.rename(vscode.Uri.file(resolvedSource), vscode.Uri.file(destination));
  return true;
}
