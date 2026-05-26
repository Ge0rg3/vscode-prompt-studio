import * as vscode from 'vscode';

import { VaultManager } from './vaultManager';
import { projectStorageDir } from './vaultPath';

type ModeId = 'default' | 'custom' | 'in-workspace';

interface ModePick extends vscode.QuickPickItem {
  id: ModeId;
}

// --- helpers ---

// build the three option rows, hiding "inside workspace" when no workspace is open
function buildPicks(workspace: vscode.WorkspaceFolder | undefined, defaultRoot: string): ModePick[] {
  const picks: ModePick[] = [
    {
      id: 'default',
      label: '$(home) Per-workspace default',
      description: 'recommended',
      detail: workspace
        ? `Auto-creates a vault at ${defaultRoot}`
        : 'Open a workspace folder first, or pick a custom folder below'
    },
    {
      id: 'custom',
      label: '$(folder-opened) Custom folder...',
      detail: 'Use any folder on disk as the vault'
    }
  ];

  if (workspace) {
    picks.push({
      id: 'in-workspace',
      label: '$(file-directory) Folder inside this workspace...',
      detail: `Keep prompts versioned with your code, e.g. ${workspace.uri.fsPath}/prompts`
    });
  }

  return picks;
}

// show the folder picker, unwrap the chosen absolute path
async function pickFolder(defaultUri?: vscode.Uri): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri,
    openLabel: 'Select Vault Folder'
  });
  return picked?.[0]?.fsPath;
}

// --- exports ---

export function registerConfigureVault(
  vaultManager: VaultManager,
  globalStorageDir: string
): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.configureVault', async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    const defaultRoot = workspace
      ? projectStorageDir(globalStorageDir, workspace.uri.fsPath)
      : '';
    const current = vaultManager.getVaultRoot();

    const choice = await vscode.window.showQuickPick(buildPicks(workspace, defaultRoot), {
      title: 'Configure Vault',
      placeHolder: current ? `Current: ${current}` : 'No vault configured',
      ignoreFocusOut: true
    });
    if (!choice) {
      return;
    }

    if (choice.id === 'default') {
      if (!workspace) {
        void vscode.window.showWarningMessage(
          'Per-workspace default needs an open workspace folder. Pick a custom folder instead.'
        );
        return;
      }
      await vaultManager.setVaultPath('');
      void vscode.window.showInformationMessage(`Vault set to per-workspace default: ${defaultRoot}`);
      return;
    }

    const startAt = choice.id === 'in-workspace' ? workspace?.uri : undefined;
    const picked = await pickFolder(startAt);
    if (!picked) {
      return;
    }

    await vaultManager.setVaultPath(picked);
    void vscode.window.showInformationMessage(`Vault set to ${picked}`);
  });
}
