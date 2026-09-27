// Keeps one vault's past note versions in a git repository stored outside the vault
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { listNamedAttachments } from '../common/noteAttachments';
import { pathExists } from '../common/utils/fs';
import { toForwardSlashes } from '../common/utils/paths';
import { GitResult, runGit } from './git';
import { LOG_FORMAT, NoteVersion, readVersionLog } from './versionLog';

// Snapshot once the notes stop changing for a moment, and at least this often through steady editing
const SNAPSHOT_QUIET_MS = 5000;
const SNAPSHOT_MAX_WAIT_MS = 60_000;

// Every markdown file in the vault, whatever the case of its extension
const NOTES_PATHSPEC = ':(icase)*.md';

// Snapshot each note's attachments folder too, to bring its files back with a restored note
const ATTACHMENTS_PATHSPEC = ':(glob)**/.attachments/*';

// Match the commits that leave a file with content, the ones that add, copy, edit, or move it in
const ADDED_OR_CHANGED_FILTER = '--diff-filter=ACMR';

// Store notes byte for byte, overriding any .gitattributes in the vault that would convert line endings or run a filter
const RAW_ATTRIBUTES = '* -text -filter -ident -working-tree-encoding\n';

const COMMIT_MESSAGE = 'Snapshot';

// A git object id, sha-1 or sha-256
const OBJECT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export class ShadowRepo implements vscode.Disposable {
  // Chain snapshots so they run one at a time
  private snapshotQueue: Promise<void> = Promise.resolve();
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private firstWaitingChangeAt: number | undefined;
  private isCreated = false;
  private hasReportedFailure = false;

  constructor(
    private readonly gitPath: string,
    private readonly gitDir: string,
    private readonly vaultRoot: string
  ) {}

  // Run git on this repository, with the vault as its working folder
  private run(args: readonly string[]): Promise<GitResult> {
    return runGit(this.gitPath, this.gitDir, this.vaultRoot, args);
  }

  // Create the repository on first use, false when git or the disk refuses
  private async ensureCreated(): Promise<boolean> {
    if (this.isCreated) {
      return true;
    }

    try {
      await mkdir(path.dirname(this.gitDir), { recursive: true });

      // Leave out git's template folder, and with it any hooks the user's init.templateDir would copy in
      const init = await runGit(this.gitPath, this.gitDir, undefined, ['init', '--bare', '--quiet', '--template=']);
      if (init.exitCode !== 0) {
        this.reportFailure(this.readFailureLine(init));
        return false;
      }

      await mkdir(path.join(this.gitDir, 'info'), { recursive: true });
      await writeFile(path.join(this.gitDir, 'info', 'attributes'), RAW_ATTRIBUTES);
    } catch (err) {
      this.reportFailure((err as Error).message);
      return false;
    }

    this.isCreated = true;
    return true;
  }

  // Stage every new, edited, moved, or deleted note and attachment, and commit when anything changed
  private async commitChanges(): Promise<void> {
    if (!(await this.ensureCreated())) {
      return;
    }

    // Carry on past any file git cannot read
    const add = await this.run(['add', '--all', '--ignore-errors', '--', NOTES_PATHSPEC, ATTACHMENTS_PATHSPEC]);

    // Report a failed add only when it staged nothing, a partial add still gets committed
    const hasStaged = await this.hasStagedChanges();
    if (hasStaged === false && add.exitCode !== 0) {
      this.reportFailure(this.readFailureLine(add));
    }
    if (!hasStaged) {
      return;
    }

    // Commit, staying quiet when another window sharing the vault committed the same changes first
    const commit = await this.run(['commit', '--quiet', '--no-verify', '--message', COMMIT_MESSAGE]);
    if (commit.exitCode !== 0 && (await this.hasStagedChanges()) !== false) {
      this.reportFailure(this.readFailureLine(commit));
    }
  }

  // Test whether a commit would record anything, undefined when git could not tell
  private async hasStagedChanges(): Promise<boolean | undefined> {
    const diff = await this.run(['diff', '--cached', '--quiet']);

    // Exit code 1 means something is staged
    if (diff.exitCode === 0 || diff.exitCode === 1) {
      return diff.exitCode === 1;
    }
    this.reportFailure(this.readFailureLine(diff));
    return undefined;
  }

  // Hash the note's text as it sits on disk, undefined when the note is gone
  private async hashCurrentText(notePath: string): Promise<string | undefined> {
    const hash = await this.run(['hash-object', '--no-filters', '--', notePath]);
    return hash.exitCode === 0 ? hash.stdout.toString('utf8').trim() : undefined;
  }

  // Test whether the last snapshot holds the note's text as it sits on disk, a note that is gone has nothing to lose
  private async isCurrentTextStored(notePath: string): Promise<boolean> {
    const currentBlobId = await this.hashCurrentText(notePath);
    if (!currentBlobId) {
      return true;
    }

    const committed = await this.run(['rev-parse', '--verify', '--quiet', `HEAD:${this.repoPathOf(notePath)}`]);
    return committed.stdout.toString('utf8').trim() === currentBlobId;
  }

  // Read a stored object's bytes, undefined when git holds no such blob
  private async readBlob(objectName: string): Promise<Uint8Array | undefined> {
    const blob = await this.run(['cat-file', 'blob', objectName]);
    return blob.exitCode === 0 ? blob.stdout : undefined;
  }

  // Read a file the way the last snapshot holding it stored it, undefined when none did
  private async readLastStoredCopy(absPath: string): Promise<Uint8Array | undefined> {
    const repoPath = this.repoPathOf(absPath);
    const log = await this.run(['log', '-1', '--format=%H', ADDED_OR_CHANGED_FILTER, '--', `:(literal)${repoPath}`]);
    const commitId = log.stdout.toString('utf8').trim();
    if (log.exitCode !== 0 || !commitId) {
      return undefined;
    }
    return this.readBlob(`${commitId}:${repoPath}`);
  }

  // Bring back any file the restored note names that has since been deleted, from the last snapshot that held it
  private async bringBackAttachments(notePath: string, text: string): Promise<void> {
    for (const attachmentPath of listNamedAttachments(notePath, text)) {
      const uri = vscode.Uri.file(attachmentPath);
      if (await pathExists(uri)) {
        continue;
      }

      const storedCopy = await this.readLastStoredCopy(attachmentPath);
      if (storedCopy) {
        await vscode.workspace.fs.writeFile(uri, storedCopy);
      }
    }
  }

  // Take the first line git printed about a failure, some commands print it to stdout
  private readFailureLine(result: GitResult): string {
    return (result.stderr || result.stdout.toString('utf8')).trim().split('\n')[0];
  }

  // Warn once that history stopped saving
  private reportFailure(reason: string): void {
    if (this.hasReportedFailure) {
      return;
    }

    this.hasReportedFailure = true;
    void vscode.window.showWarningMessage(
      `Prompt Studio: could not save note history - ${reason || 'git could not start'}`
    );
  }

  // Name a note the way git does, relative to the vault with forward slashes
  private repoPathOf(notePath: string): string {
    return toForwardSlashes(path.relative(this.vaultRoot, notePath));
  }

  // Snapshot once the vault has been quiet for a moment, pushing the wait back with each change up to a limit
  scheduleSnapshot(): void {
    const now = Date.now();
    this.firstWaitingChangeAt ??= now;
    clearTimeout(this.snapshotTimer);

    const waitMs = Math.min(SNAPSHOT_QUIET_MS, this.firstWaitingChangeAt + SNAPSHOT_MAX_WAIT_MS - now);
    this.snapshotTimer = setTimeout(() => void this.snapshotNow(), Math.max(0, waitMs));
  }

  hasPendingSnapshot(): boolean {
    return this.snapshotTimer !== undefined;
  }

  // Snapshot straight away, dropping any wait still counting down
  snapshotNow(): Promise<void> {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = undefined;
    this.firstWaitingChangeAt = undefined;

    const snapshot = this.snapshotQueue.then(() => this.commitChanges());
    this.snapshotQueue = snapshot;
    return snapshot;
  }

  // List a note's past versions, newest first, leaving out any that match its text now
  async versionsOf(notePath: string): Promise<NoteVersion[]> {
    const repoPath = this.repoPathOf(notePath);
    const log = await this.run(['log', '--follow', '--no-abbrev', '--raw', '-z', LOG_FORMAT, '--', `:(literal)${repoPath}`]);

    // Show no versions when the log fails, as it does before the first commit
    if (log.exitCode !== 0) {
      return [];
    }
    return readVersionLog(log.stdout.toString('utf8'), await this.hashCurrentText(notePath), repoPath);
  }

  // Read one stored version back byte for byte, undefined when the id names nothing stored here
  async readVersion(blobId: string): Promise<Uint8Array | undefined> {
    if (!OBJECT_ID.test(blobId)) {
      return undefined;
    }
    return this.readBlob(blobId);
  }

  // Save the note's current text, then write a stored version over it, throwing with the reason when either step fails
  async restore(notePath: string, blobId: string): Promise<void> {
    const restoredBytes = await this.readVersion(blobId);
    if (!restoredBytes) {
      throw new Error('that version is not stored');
    }

    await this.snapshotNow();
    if (!(await this.isCurrentTextStored(notePath))) {
      throw new Error('its current text could not be saved to history first');
    }

    await vscode.workspace.fs.writeFile(vscode.Uri.file(notePath), restoredBytes);
    await this.bringBackAttachments(notePath, new TextDecoder('utf-8').decode(restoredBytes));
  }

  dispose(): void {
    clearTimeout(this.snapshotTimer);
  }
}
