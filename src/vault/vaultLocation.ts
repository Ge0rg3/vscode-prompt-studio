// The three places a vault can live, and moving it to one of them
import * as vscode from 'vscode';

import { isWithin, projectStorageDir } from '../common/utils/paths';
import { VaultManager } from '../common/vaultManager';

export const VAULT_LOCATION_MODES = ['default', 'custom', 'in-workspace'] as const;

export type VaultLocationMode = (typeof VAULT_LOCATION_MODES)[number];

// Show the folder picker and return the path the user chose
async function pickFolder(defaultUri?: vscode.Uri): Promise<string | undefined> {
  const pickedFolders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri,
    openLabel: 'Select Vault Folder'
  });
  return pickedFolders?.[0]?.fsPath;
}

// Name where the vault sits now
export function currentVaultMode(vaultManager: VaultManager): VaultLocationMode {
  if (vaultManager.isDefaultLocation()) {
    return 'default';
  }

  const workspace = vscode.workspace.workspaceFolders?.[0];
  const root = vaultManager.getVaultRoot();
  if (workspace && root && isWithin(root, workspace.uri.fsPath)) {
    return 'in-workspace';
  }

  return 'custom';
}

// Move the vault, asking for a folder when the mode needs one
export async function applyVaultMode(
  mode: VaultLocationMode,
  vaultManager: VaultManager,
  globalStorageDir: string
): Promise<void> {
  // Take the per-workspace default, stored as an empty path
  if (mode === 'default') {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      void vscode.window.showWarningMessage(
        'Per-workspace default needs an open workspace folder. Pick a custom folder instead.'
      );
      return;
    }

    await vaultManager.setVaultPath('');
    const root = projectStorageDir(globalStorageDir, workspace.uri.fsPath);
    void vscode.window.showInformationMessage(`Vault set to per-workspace default: ${root}`);
    return;
  }

  // Pick a folder off disk, starting inside the workspace when that was the choice
  const startFolder = mode === 'in-workspace' ? vscode.workspace.workspaceFolders?.[0]?.uri : undefined;
  const pickedFolder = await pickFolder(startFolder);
  if (!pickedFolder) {
    return;
  }

  await vaultManager.setVaultPath(pickedFolder);
  void vscode.window.showInformationMessage(`Vault set to ${pickedFolder}`);
}
