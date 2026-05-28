import * as path from 'node:path';

import * as vscode from 'vscode';

import { pathExists } from '../common/utils/fs';
import { isWithin } from '../common/utils/paths';

// move sourcePath into targetDir, return the new path, or undefined on a no-op or conflict
export async function moveVaultEntry(
  vaultRoot: string,
  sourcePath: string,
  targetDir: string
): Promise<string | undefined> {
  const resolvedRoot = path.resolve(vaultRoot);
  const resolvedSource = path.resolve(sourcePath);
  const resolvedTarget = path.resolve(targetDir);

  if (!isWithin(resolvedSource, resolvedRoot) || resolvedSource === resolvedRoot) {
    return undefined;
  }
  if (!isWithin(resolvedTarget, resolvedRoot)) {
    return undefined;
  }
  if (isWithin(resolvedTarget, resolvedSource)) {
    void vscode.window.showErrorMessage('Cannot move a folder into itself.');
    return undefined;
  }
  if (path.dirname(resolvedSource) === resolvedTarget) {
    return undefined;
  }

  const destination = path.join(resolvedTarget, path.basename(resolvedSource));
  if (await pathExists(vscode.Uri.file(destination))) {
    void vscode.window.showErrorMessage(
      `"${path.basename(resolvedSource)}" already exists in the destination folder.`
    );
    return undefined;
  }

  await vscode.workspace.fs.rename(vscode.Uri.file(resolvedSource), vscode.Uri.file(destination));
  return destination;
}
