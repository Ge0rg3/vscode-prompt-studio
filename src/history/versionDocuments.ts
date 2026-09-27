// Serves a note's stored versions as read-only documents
import * as vscode from 'vscode';

import { NoteHistory } from './noteHistory';
import { NoteVersion } from './versionLog';

export const VERSION_SCHEME = 'prompt-studio-version';

// The query keys a version's uri carries
const BLOB_ID_PARAM = 'blobId';
const SAVED_AT_PARAM = 'savedAt';

const NOT_STORED_MESSAGE = 'This version of the note is not stored.';

// The stored version a document's uri points to
export interface VersionReference {
  notePath: string;
  blobId: string;
  savedAt: number;
}

// Build the uri of a version's document, keeping the note's path so the tab shows its name and markdown colors
export function buildVersionUri(notePath: string, version: NoteVersion): vscode.Uri {
  const query = new URLSearchParams({ [BLOB_ID_PARAM]: version.blobId, [SAVED_AT_PARAM]: String(version.savedAt) });
  return vscode.Uri.file(notePath).with({ scheme: VERSION_SCHEME, query: query.toString() });
}

// Read a version's uri back, undefined for any other uri or one missing its id or time
export function parseVersionUri(uri: vscode.Uri): VersionReference | undefined {
  if (uri.scheme !== VERSION_SCHEME) {
    return undefined;
  }

  const query = new URLSearchParams(uri.query);
  const blobId = query.get(BLOB_ID_PARAM);
  const savedAt = Number(query.get(SAVED_AT_PARAM) ?? NaN);
  if (!blobId || !Number.isFinite(savedAt)) {
    return undefined;
  }
  return { notePath: uri.fsPath, blobId, savedAt };
}

export class VersionContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly history: NoteHistory) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const reference = parseVersionUri(uri);
    if (reference) {
      const text = await this.history.readVersionText(reference.notePath, reference.blobId);
      if (text !== undefined) {
        return text;
      }
    }
    throw new Error(NOT_STORED_MESSAGE);
  }
}
