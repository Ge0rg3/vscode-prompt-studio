import * as path from 'node:path';

import * as vscode from 'vscode';

import { pathExists } from '../common/utils/fs';
import { isWithin } from '../common/utils/paths';

// move sourcePath into targetDir, no-op when already there, surface a UI error on conflict
export async function moveVaultEntry(
  vaultRoot: string,
  sourcePath: string,
  targetDir: string
): Promise<boolean> {
  const resolvedRoot = path.resolve(vaultRoot);
  const resolvedSource = path.resolve(sourcePath);
  const resolvedTarget = path.resolve(targetDir);

  if (!isWithin(resolvedSource, resolvedRoot) || resolvedSource === resolvedRoot) {
    return false;
  }
  if (!isWithin(resolvedTarget, resolvedRoot)) {
    return false;
  }
  if (isWithin(resolvedTarget, resolvedSource)) {
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
