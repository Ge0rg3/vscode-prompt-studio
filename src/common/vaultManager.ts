import * as vscode from 'vscode';

import { ensureDir, projectStorageDir } from './vaultPath';

const CONFIG_SECTION = 'promptStudio';
const CONFIG_KEY = 'vaultPath';
const FULL_CONFIG_KEY = `${CONFIG_SECTION}.${CONFIG_KEY}`;
const HAS_VAULT_CONTEXT = 'promptStudio.hasVault';

export class VaultManager implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<string | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private current: string | undefined;

  readonly onDidChangeVault: vscode.Event<string | undefined> = this.emitter.event;

  constructor(private readonly globalStorageDir: string) {
    this.current = this.resolveVaultRoot();
    this.publishContext();

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(FULL_CONFIG_KEY)) {
          this.recompute();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.recompute())
    );
  }

  getVaultRoot(): string | undefined {
    return this.current;
  }

  // write the setting, empty string reverts to the per-workspace default
  async setVaultPath(value: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(CONFIG_KEY, value, vscode.ConfigurationTarget.Global);
  }

  dispose(): void {
    this.emitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // re-resolve the root, fire only when it actually changed
  private recompute(): void {
    const next = this.resolveVaultRoot();
    if (next === this.current) {
      return;
    }
    this.current = next;
    this.publishContext();
    this.emitter.fire(next);
  }

  // drive the when-clause context that shows or hides the view
  private publishContext(): void {
    void vscode.commands.executeCommand('setContext', HAS_VAULT_CONTEXT, this.current !== undefined);
  }

  // read the configured vault path or fall back to a per-workspace storage dir
  private resolveVaultRoot(): string | undefined {
    const configured = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>(CONFIG_KEY)
      ?.trim();
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
