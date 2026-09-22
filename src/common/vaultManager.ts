// Works out which folder is the vault and fires an event when it changes
import * as path from 'node:path';

import * as vscode from 'vscode';

import { ScopeManager } from './scopeManager';
import { ensureDir } from './utils/fs';
import { projectStorageDir, resolveTypedPath } from './utils/paths';

const STATE_KEY = 'vaultPath';
const HAS_VAULT_CONTEXT = 'promptStudio.hasVault';
const SETTING_SECTION = 'promptStudio';
const GLOBAL_VAULT_SETTING_KEY = 'globalVaultLocation';
const GLOBAL_VAULT_FOLDER = 'global-vault';

export class VaultManager implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<string | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private current: string | undefined;

  readonly onDidChangeVault: vscode.Event<string | undefined> = this.emitter.event;

  constructor(
    private readonly globalStorageDir: string,
    private readonly workspaceState: vscode.Memento,
    private readonly scopeManager: ScopeManager
  ) {
    this.current = this.resolveVaultRoot();
    this.publishContext();

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.recompute()),
      scopeManager.onDidChangeScope(() => this.recompute()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SETTING_SECTION}.${GLOBAL_VAULT_SETTING_KEY}`)) {
          this.recompute();
        }
      })
    );
  }

  getVaultRoot(): string | undefined {
    return this.current;
  }

  // Find the folder this workspace's own vault sits in
  projectVaultRoot(): string | undefined {
    const configured = this.configuredPath();
    if (configured) {
      return configured;
    }

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      return undefined;
    }
    return projectStorageDir(this.globalStorageDir, workspace.uri.fsPath);
  }

  // Find the global vault folder the setting names, falling back to one under extension storage
  globalVaultRoot(): string {
    return this.configuredGlobalPath() ?? path.join(this.globalStorageDir, GLOBAL_VAULT_FOLDER);
  }

  // Say whether the project vault is still the folder kept for this workspace
  isDefaultProjectLocation(): boolean {
    return !this.configuredPath();
  }

  // Say whether the global vault is still the folder kept under extension storage
  isDefaultGlobalLocation(): boolean {
    return this.configuredGlobalPath() === undefined;
  }

  // Save the chosen project vault folder, an empty string goes back to the default one
  async setProjectVaultPath(folderPath: string): Promise<void> {
    await this.workspaceState.update(STATE_KEY, folderPath);
    this.recompute();
  }

  // Save the global vault folder for every window, an empty string goes back to the default one
  async setGlobalVaultPath(folderPath: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(SETTING_SECTION)
      .update(GLOBAL_VAULT_SETTING_KEY, folderPath, vscode.ConfigurationTarget.Global);
  }

  dispose(): void {
    this.emitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // Work out the root again, fire only when it changed
  private recompute(): void {
    const next = this.resolveVaultRoot();
    if (next === this.current) {
      return;
    }
    this.current = next;
    this.publishContext();
    this.emitter.fire(next);
  }

  // Set promptStudio.hasVault so the title-bar buttons and palette commands need a vault
  private publishContext(): void {
    void vscode.commands.executeCommand('setContext', HAS_VAULT_CONTEXT, this.current !== undefined);
  }

  // Read the folder the user chose, empty when they never chose one
  private configuredPath(): string | undefined {
    return this.workspaceState.get<string>(STATE_KEY)?.trim();
  }

  // Read the folder typed into the global vault setting, undefined unless it names an absolute path
  private configuredGlobalPath(): string | undefined {
    const typed = vscode.workspace.getConfiguration(SETTING_SECTION).get<unknown>(GLOBAL_VAULT_SETTING_KEY);
    return typeof typed === 'string' ? resolveTypedPath(typed) : undefined;
  }

  // Take the root the current scope points at and make sure it is on disk
  private resolveVaultRoot(): string | undefined {
    const root = this.scopeManager.isGlobal() ? this.globalVaultRoot() : this.projectVaultRoot();
    if (!root) {
      return undefined;
    }

    // Carry on without a vault when a saved or typed folder cannot be made
    try {
      return ensureDir(root);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Prompt Studio: could not open the vault folder ${root} - ${(err as Error).message}`
      );
      return undefined;
    }
  }
}
