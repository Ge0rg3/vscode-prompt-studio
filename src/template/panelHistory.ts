// Answers the template editor's history buttons, listing a note's saved versions and reading one back or restoring it
import * as path from 'node:path';

import * as vscode from 'vscode';

import { describeTimeAgo, formatDateTime } from '../common/utils/time';
import { VaultNode } from '../common/vaultNode';
import { NoteHistory } from '../history/noteHistory';
import { buildVersionUri } from '../history/versionDocuments';

// One saved version labelled for the bottom bar, kept in sync with the matching type in webview/template/versionStepper.ts
export interface VersionEntry {
  blobId: string;
  savedAt: number;
  ageLabel: string;
  dateLabel: string;
}

export class PanelHistory {
  // The versions last listed for the older button, the only ones a message may name
  private offeredVersions: readonly VersionEntry[] = [];

  constructor(
    private readonly history: NoteHistory,
    private readonly notePath: string,
    private readonly webview: vscode.Webview
  ) {}

  // Look a version up among the ones last listed, since the webview can send any id
  private findOfferedVersion(blobId: unknown): VersionEntry | undefined {
    return this.offeredVersions.find((version) => version.blobId === blobId);
  }

  // Open the version picker on the note
  async showPicker(): Promise<void> {
    const node: VaultNode = { kind: 'note', absPath: this.notePath, name: path.basename(this.notePath) };
    await vscode.commands.executeCommand('promptStudio.showHistory', node);
  }

  // Answer the older button with the note's saved versions newest first, an empty list when there are none to step through
  async postVersions(): Promise<void> {
    const entries: VersionEntry[] = [];
    for (const { blobId, savedAt } of await this.history.versionsOrExplain(this.notePath)) {
      entries.push({ blobId, savedAt, ageLabel: describeTimeAgo(savedAt), dateLabel: formatDateTime(savedAt) });
    }

    this.offeredVersions = entries;
    await this.webview.postMessage({ type: 'versions', versions: entries });
  }

  // Answer a step with the text of the version stepped onto
  async postVersionText(blobId: unknown): Promise<void> {
    const version = this.findOfferedVersion(blobId);
    if (!version) {
      return;
    }

    const text = await this.history.readVersionText(this.notePath, version.blobId);
    if (text === undefined) {
      void vscode.window.showErrorMessage('Prompt Studio: that version of the note is not stored.');
      return;
    }
    await this.webview.postMessage({ type: 'versionText', blobId: version.blobId, text });
  }

  // Hand the version on screen to the restore command, it confirms and saves the current text first
  async restoreVersion(blobId: unknown): Promise<void> {
    const version = this.findOfferedVersion(blobId);
    if (version) {
      await vscode.commands.executeCommand('promptStudio.restoreVersion', buildVersionUri(this.notePath, version));
    }
  }
}
