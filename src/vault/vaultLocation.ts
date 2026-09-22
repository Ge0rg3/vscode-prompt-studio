// Where the project vault and the global vault can live, and moving either one there
import * as vscode from 'vscode';

import { isWithin } from '../common/utils/paths';
import { VaultManager } from '../common/vaultManager';

export const PROJECT_VAULT_MODES = ['default', 'custom', 'in-workspace'] as const;
export const GLOBAL_VAULT_MODES = ['default', 'custom'] as const;

export type ProjectVaultMode = (typeof PROJECT_VAULT_MODES)[number];
export type GlobalVaultMode = (typeof GLOBAL_VAULT_MODES)[number];

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

// Name where the project vault sits now
export function currentProjectVaultMode(vaultManager: VaultManager): ProjectVaultMode {
  if (vaultManager.isDefaultProjectLocation()) {
    return 'default';
  }

  const workspace = vscode.workspace.workspaceFolders?.[0];
  const root = vaultManager.projectVaultRoot();
  if (workspace && root && isWithin(root, workspace.uri.fsPath)) {
    return 'in-workspace';
  }

  return 'custom';
}

// Move the project vault, asking for a folder when the mode needs one
export async function applyProjectVaultMode(mode: ProjectVaultMode, vaultManager: VaultManager): Promise<void> {
  // Take the per-workspace default, stored as an empty path
  if (mode === 'default') {
    if (!vscode.workspace.workspaceFolders?.length) {
      void vscode.window.showWarningMessage(
        'Per-workspace default needs an open workspace folder. Pick a custom folder instead.'
      );
      return;
    }

    await vaultManager.setProjectVaultPath('');
    void vscode.window.showInformationMessage(
      `Project vault set to per-workspace default: ${vaultManager.projectVaultRoot()}`
    );
    return;
  }

  // Pick a folder off disk, starting inside the workspace when that was the choice
  const startFolder = mode === 'in-workspace' ? vscode.workspace.workspaceFolders?.[0]?.uri : undefined;
  const pickedFolder = await pickFolder(startFolder);
  if (!pickedFolder) {
    return;
  }

  await vaultManager.setProjectVaultPath(pickedFolder);
  void vscode.window.showInformationMessage(`Project vault set to ${pickedFolder}`);
}

// Name where the global vault sits now
export function currentGlobalVaultMode(vaultManager: VaultManager): GlobalVaultMode {
  return vaultManager.isDefaultGlobalLocation() ? 'default' : 'custom';
}

// Move the global vault, asking for a folder when the mode needs one
export async function applyGlobalVaultMode(mode: GlobalVaultMode, vaultManager: VaultManager): Promise<void> {
  // Go back to the folder under the extension's own storage, stored as an empty path
  if (mode === 'default') {
    await vaultManager.setGlobalVaultPath('');
    void vscode.window.showInformationMessage(`Global vault set to ${vaultManager.globalVaultRoot()}`);
    return;
  }

  // Pick a folder off disk
  const pickedFolder = await pickFolder();
  if (!pickedFolder) {
    return;
  }

  await vaultManager.setGlobalVaultPath(pickedFolder);
  void vscode.window.showInformationMessage(`Global vault set to ${pickedFolder}`);
}
