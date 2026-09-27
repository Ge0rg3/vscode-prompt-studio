// Registers the commands that list a note's past versions, compare one with the note, and restore it
import * as path from 'node:path';

import * as vscode from 'vscode';

import { flashStatusMessage } from '../common/utils/statusBar';
import { describeTimeAgo, formatDateTime } from '../common/utils/time';
import { VaultNode } from '../common/vaultNode';
import { TemplatePanel } from '../template/templatePanel';
import { NoteHistory } from './noteHistory';
import {
  buildVersionUri,
  parseVersionUri,
  VERSION_SCHEME,
  VersionContentProvider,
  VersionReference
} from './versionDocuments';
import { NoteVersion } from './versionLog';

// One row in the version picker
interface VersionPick extends vscode.QuickPickItem {
  version: NoteVersion;
}

// Show the restore button while the active tab compares a stored version with its note
const IS_VERSION_DIFF_CONTEXT = 'promptStudio.isVersionDiff';

const RESTORE_CHOICE = 'Restore';

export class HistoryCommands {
  constructor(private readonly history: NoteHistory) {}

  // Find the version the active tab compares, undefined for any other tab
  private findComparedVersion(): VersionReference | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputTextDiff ? parseVersionUri(input.original) : undefined;
  }

  // Label each version by how long ago it was saved, naming its old path when the note has moved since
  private buildVersionPicks(versions: NoteVersion[]): VersionPick[] {
    const picks: VersionPick[] = [];
    for (const version of versions) {
      picks.push({
        label: describeTimeAgo(version.savedAt),
        description: formatDateTime(version.savedAt),
        detail: version.formerPath ? `Saved as ${version.formerPath}` : undefined,
        version
      });
    }
    return picks;
  }

  // Name the version to restore, from a version uri or else from the comparison in the active tab
  private resolveVersionToRestore(target: vscode.Uri | undefined): VersionReference | undefined {
    if (target?.scheme === VERSION_SCHEME) {
      return parseVersionUri(target);
    }

    // The title-bar button shows in every editor group, so act only for the group showing the comparison
    const comparedVersion = this.findComparedVersion();
    if (!comparedVersion || (target && target.fsPath !== comparedVersion.notePath)) {
      return undefined;
    }
    return comparedVersion;
  }

  // Test whether a template editor or a text editor holds edits to the note that are not on disk yet
  private hasUnsavedEdits(notePath: string): boolean {
    if (TemplatePanel.hasUnsavedEdits(notePath)) {
      return true;
    }

    for (const document of vscode.workspace.textDocuments) {
      if (document.isDirty && document.uri.scheme === 'file' && document.uri.fsPath === notePath) {
        return true;
      }
    }
    return false;
  }

  // List a note's past versions and open the picked one against the note as it is now
  private async showHistory(target: VaultNode | undefined): Promise<void> {
    if (!target || target.kind !== 'note') {
      return;
    }

    // List the versions and let the user pick one
    const noteName = path.basename(target.absPath);
    const versions = await this.history.versionsOrExplain(target.absPath);
    if (versions.length === 0) {
      return;
    }

    const picked = await vscode.window.showQuickPick(this.buildVersionPicks(versions), {
      title: `History of ${noteName}`,
      placeHolder: 'Pick a version to compare with the note now'
    });
    if (!picked) {
      return;
    }

    // Put the old version on the left and the note as it is now on the right
    const title = `${noteName} (${formatDateTime(picked.version.savedAt)}) \u2194 Now`;
    await vscode.commands.executeCommand(
      'vscode.diff',
      buildVersionUri(target.absPath, picked.version),
      vscode.Uri.file(target.absPath),
      title
    );
  }

  // Write a stored version back over its note, keeping the text it replaces in history
  private async restoreVersion(target: vscode.Uri | undefined): Promise<void> {
    const reference = this.resolveVersionToRestore(target);
    if (!reference) {
      return;
    }

    // Leave unsaved edits alone, a restore would drop them or clash with them on the next save
    const noteName = path.basename(reference.notePath);
    if (this.hasUnsavedEdits(reference.notePath)) {
      void vscode.window.showWarningMessage(`Save or undo the unsaved edits to "${noteName}" before restoring it.`);
      return;
    }

    // Confirm with the user
    const choice = await vscode.window.showWarningMessage(
      `Restore "${noteName}" to its version from ${formatDateTime(reference.savedAt)}?`,
      { modal: true, detail: "The note's current text stays in its history." },
      RESTORE_CHOICE
    );
    if (choice !== RESTORE_CHOICE) {
      return;
    }

    // Write the version back
    const repo = await this.history.findRepoOrExplain(reference.notePath);
    if (!repo) {
      return;
    }

    try {
      await repo.restore(reference.notePath, reference.blobId);
    } catch (err) {
      void vscode.window.showErrorMessage(`Prompt Studio: could not restore "${noteName}" - ${(err as Error).message}`);
      return;
    }

    // Show the restored text in an open template editor
    TemplatePanel.reloadFromDisk(reference.notePath);
    flashStatusMessage(`Restored "${noteName}".`);
  }

  // Track whether the active tab compares a stored version, since a diff's title-bar menu only sees the right-hand file
  private publishDiffContext(): void {
    void vscode.commands.executeCommand('setContext', IS_VERSION_DIFF_CONTEXT, this.findComparedVersion() !== undefined);
  }

  register(): vscode.Disposable {
    // Catch a comparison VSCode brought back with the window
    this.publishDiffContext();

    return vscode.Disposable.from(
      vscode.workspace.registerTextDocumentContentProvider(VERSION_SCHEME, new VersionContentProvider(this.history)),
      vscode.commands.registerCommand('promptStudio.showHistory', (target?: VaultNode) => this.showHistory(target)),
      vscode.commands.registerCommand('promptStudio.restoreVersion', (target?: vscode.Uri) => this.restoreVersion(target)),
      vscode.window.tabGroups.onDidChangeTabs(() => this.publishDiffContext()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.publishDiffContext())
    );
  }
}
