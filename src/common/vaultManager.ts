// Works out which folder is the vault and fires an event when it changes
import * as vscode from 'vscode';

import { ensureDir } from './utils/fs';
import { projectStorageDir } from './utils/paths';

const STATE_KEY = 'vaultPath';
const HAS_VAULT_CONTEXT = 'promptStudio.hasVault';

export class VaultManager implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<string | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private current: string | undefined;

  readonly onDidChangeVault: vscode.Event<string | undefined> = this.emitter.event;

  constructor(
    private readonly globalStorageDir: string,
    private readonly workspaceState: vscode.Memento
  ) {
    this.current = this.resolveVaultRoot();
    this.publishContext();

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.recompute())
    );
  }

  getVaultRoot(): string | undefined {
    return this.current;
  }

  // Save the chosen vault folder, an empty string goes back to the default one
  async setVaultPath(value: string): Promise<void> {
    await this.workspaceState.update(STATE_KEY, value);
    this.recompute();
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

  // Read the saved path, falling back to a folder kept for this workspace
  private resolveVaultRoot(): string | undefined {
    const configured = this.workspaceState.get<string>(STATE_KEY)?.trim();
    if (configured) {
      return ensureDir(configured);
    }

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      return undefined;
    }
    return ensureDir(projectStorageDir(this.globalStorageDir, workspace.uri.fsPath));
  }
}
