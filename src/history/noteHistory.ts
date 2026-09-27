// Keeps a git repository per vault outside it, and snapshots the open vault whenever its notes change on disk
import * as path from 'node:path';

import * as vscode from 'vscode';

import { hashedStorageDir, isWithin } from '../common/utils/paths';
import { CONFIG_FILENAME } from '../common/vaultConfig';
import { VaultManager } from '../common/vaultManager';
import { findGit } from './git';
import { ShadowRepo } from './shadowRepo';
import { NoteVersion } from './versionLog';

// The folder under extension storage holding one repository per vault
const HISTORY_FOLDER = 'history';

export class NoteHistory implements vscode.Disposable {
  private readonly repos = new Map<string, ShadowRepo>();
  private readonly gitPath: Promise<string | undefined>;
  private readonly vaultChangeSubscription: vscode.Disposable;
  private watcher: vscode.Disposable | undefined;

  constructor(
    private readonly globalStorageDir: string,
    private readonly vaultManager: VaultManager
  ) {
    this.gitPath = findGit();
    this.vaultChangeSubscription = vaultManager.onDidChangeVault((root) => this.watchVault(root));
    this.watchVault(vaultManager.getVaultRoot());
  }

  // Watch the open vault, and snapshot it once now to catch edits made while it was closed
  private watchVault(root: string | undefined): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (!root) {
      return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**'));
    const onVaultFileEvent = (uri: vscode.Uri): void => {
      if (this.mayChangeNotes(root, uri)) {
        void this.scheduleSnapshot(root);
      }
    };
    this.watcher = vscode.Disposable.from(
      watcher,
      watcher.onDidCreate(onVaultFileEvent),
      watcher.onDidChange(onVaultFileEvent),
      watcher.onDidDelete(onVaultFileEvent)
    );

    void this.scheduleSnapshot(root);
  }

  // Skip config.yml and hidden folders like .git and .attachments, they change often and hold no notes
  private mayChangeNotes(root: string, uri: vscode.Uri): boolean {
    const relativePath = path.relative(root, uri.fsPath);
    if (relativePath === CONFIG_FILENAME) {
      return false;
    }

    for (const segment of relativePath.split(path.sep)) {
      if (segment.startsWith('.')) {
        return false;
      }
    }
    return true;
  }

  private async scheduleSnapshot(root: string): Promise<void> {
    (await this.repoAt(root))?.scheduleSnapshot();
  }

  // Get the repository for a vault, set up on first use, undefined without git
  private async repoAt(root: string): Promise<ShadowRepo | undefined> {
    const gitPath = await this.gitPath;
    if (!gitPath) {
      return undefined;
    }

    let repo = this.repos.get(root);
    if (!repo) {
      const gitDir = hashedStorageDir(path.join(this.globalStorageDir, HISTORY_FOLDER), root);
      repo = new ShadowRepo(gitPath, gitDir, root);
      this.repos.set(root, repo);
    }
    return repo;
  }

  // Find the vault a note sits in, the deeper one when one vault sits inside the other
  private vaultRootOf(notePath: string): string | undefined {
    let deepestRoot: string | undefined;
    for (const root of [this.vaultManager.projectVaultRoot(), this.vaultManager.globalVaultRoot()]) {
      if (!root || notePath === root || !isWithin(notePath, root)) {
        continue;
      }
      if (!deepestRoot || root.length > deepestRoot.length) {
        deepestRoot = root;
      }
    }
    return deepestRoot;
  }

  // Find the repository holding a note's history, undefined without git or for a note outside both vaults
  private async repoFor(notePath: string): Promise<ShadowRepo | undefined> {
    const root = this.vaultRootOf(notePath);
    return root ? this.repoAt(root) : undefined;
  }

  // Test whether a note sits in a vault, the only place history is kept
  keepsHistoryFor(notePath: string): boolean {
    return this.vaultRootOf(notePath) !== undefined;
  }

  // Find a note's history for the user, telling them why when there is none
  async findRepoOrExplain(notePath: string): Promise<ShadowRepo | undefined> {
    if ((await this.gitPath) === undefined) {
      void vscode.window.showErrorMessage(
        'Prompt Studio: note history needs git. Install it or set git.path, then reload the window.'
      );
      return undefined;
    }

    const repo = await this.repoFor(notePath);
    if (!repo) {
      void vscode.window.showInformationMessage('Prompt Studio keeps history for vault notes only.');
    }
    return repo;
  }

  // List a note's past versions for the user, telling them when there are none yet
  async versionsOrExplain(notePath: string): Promise<NoteVersion[]> {
    const repo = await this.findRepoOrExplain(notePath);
    if (!repo) {
      return [];
    }

    const versions = await repo.versionsOf(notePath);
    if (versions.length === 0) {
      void vscode.window.showInformationMessage(`"${path.basename(notePath)}" has no earlier versions yet.`);
    }
    return versions;
  }

  // Read a stored version of a note as text, undefined when it is not stored
  async readVersionText(notePath: string, blobId: string): Promise<string | undefined> {
    const repo = await this.repoFor(notePath);
    const bytes = await repo?.readVersion(blobId);
    return bytes ? new TextDecoder('utf-8').decode(bytes) : undefined;
  }

  // Snapshot the vaults with changes still waiting
  async flushPending(): Promise<void> {
    const snapshots: Promise<void>[] = [];
    for (const repo of this.repos.values()) {
      if (repo.hasPendingSnapshot()) {
        snapshots.push(repo.snapshotNow());
      }
    }
    await Promise.all(snapshots);
  }

  dispose(): void {
    this.vaultChangeSubscription.dispose();
    this.watcher?.dispose();
    for (const repo of this.repos.values()) {
      repo.dispose();
    }
  }
}
