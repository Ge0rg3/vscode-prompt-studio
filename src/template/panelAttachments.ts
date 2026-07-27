// Stores what the template editor attaches, and resolves a note's files to uris the editor can load
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  copyIntoAttachments,
  isImageAttachment,
  reserveAttachment,
  resolveAttachment
} from '../common/noteAttachments';

// The size the editor stops at, in step with MAX_ATTACHMENT_BYTES in webview/template/attachments.ts
export const MAX_ATTACHMENT_MB = 20;

// One stored file, resolved to a uri the editor can load
export interface ResolvedAttachment {
  reference: string;
  uri: string;
  isImage: boolean;
  size: number;
}

// Write pasted bytes beside the note, undefined when the disk says no
export async function storeAttachment(
  notePath: string,
  name: string,
  mime: string,
  base64: string
): Promise<string | undefined> {
  try {
    const stored = await reserveAttachment(notePath, name, mime);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(stored.absPath), Buffer.from(base64, 'base64'));
    return stored.reference;
  } catch {
    void vscode.window.showErrorMessage(`Could not store the file beside "${path.basename(notePath)}".`);
    return undefined;
  }
}

// Copy each pick beside the note, leaving out the ones the disk refuses
export async function copyPickedFiles(notePath: string, sources: readonly vscode.Uri[]): Promise<string[]> {
  const references: string[] = [];

  for (const source of sources) {
    try {
      const stored = await copyIntoAttachments(notePath, source.fsPath);
      references.push(stored.reference);
    } catch {
      void vscode.window.showErrorMessage(`Could not attach "${path.basename(source.fsPath)}".`);
    }
  }

  return references;
}

// Resolve every reference that names a file beside the note, dropping the ones that have gone
export async function resolveAttachments(
  webview: vscode.Webview,
  notePath: string,
  references: readonly string[]
): Promise<ResolvedAttachment[]> {
  const entries: ResolvedAttachment[] = [];

  for (const reference of references) {
    const target = resolveAttachment(notePath, reference);
    if (!target) {
      continue;
    }

    // A stat that throws is a file that has gone, so it is left out
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(target));
      if ((stat.type & vscode.FileType.File) === 0) {
        continue;
      }

      entries.push({
        reference,
        uri: webview.asWebviewUri(vscode.Uri.file(target)).toString(),
        isImage: isImageAttachment(target),
        size: stat.size
      });
    } catch {
      continue;
    }
  }

  return entries;
}
