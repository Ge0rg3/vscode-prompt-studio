// Drops a prompt and the files attached to it into the Claude Code chat input
import * as vscode from 'vscode';

import { copyImageToClipboard } from './utils/imageClipboard';
import { delay } from './utils/time';

// Give the chat input time to take focus, and to take each paste in turn
const PASTE_SETTLE_MS = 60;

const PASTE_COMMAND = 'editor.action.clipboardPasteAction';
const SELECT_ALL_COMMAND = 'editor.action.selectAll';

// Head the paths so Claude opens them, rather than reading a bare list as part of the prompt
const ATTACHMENTS_HEADING = '--- attachments <agent MUST read> ---';

// --- helpers ---

// Paste each file into the chat as an attachment, handing back the ones the clipboard could not carry
async function pasteAttachments(attachments: readonly string[]): Promise<string[]> {
  const missedAttachments: string[] = [];

  for (const attachment of attachments) {
    if (!(await copyImageToClipboard(attachment))) {
      missedAttachments.push(attachment);
      continue;
    }

    await vscode.commands.executeCommand(PASTE_COMMAND);
    await delay(PASTE_SETTLE_MS);
  }

  return missedAttachments;
}

// Test whether a select-all left the whole of an open file selected
function hasWholeFileSelected(editor: vscode.TextEditor): boolean {
  const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  return editor.selection.isEqual(new vscode.Range(0, 0, end.line, end.character));
}

// Try a select-all and see where it landed, since it only moves a cursor and can be put back
async function chatInputHasFocus(): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  const selection = editor?.selection;

  await vscode.commands.executeCommand(SELECT_ALL_COMMAND);
  await delay(PASTE_SETTLE_MS);

  // No open file at all means nothing else could have taken the paste
  if (!editor || !selection || !hasWholeFileSelected(editor)) {
    return true;
  }

  editor.selection = selection;
  return false;
}

// List any file that could not be attached under its own heading, so Claude reads it off disk
function appendAttachmentSection(text: string, attachmentPaths: readonly string[]): string {
  if (attachmentPaths.length === 0) {
    return text;
  }

  return [text.trim(), '', ATTACHMENTS_HEADING, ...attachmentPaths].join('\n');
}

// --- exports ---

// Put the prompt in the Claude Code chat input, its files attached the way a paste would leave them
export async function sendToClaude(text: string, attachments: readonly string[] = []): Promise<void> {
  try {
    await vscode.commands.executeCommand('claude-vscode.focus');
    await delay(PASTE_SETTLE_MS);

    // Find out where a paste would go before making one, so nothing lands in an open file
    if (!(await chatInputHasFocus())) {
      await vscode.env.clipboard.writeText(appendAttachmentSection(text, attachments));
      void vscode.window.showInformationMessage('Claude Code did not take focus. The prompt is on the clipboard.');
      return;
    }

    // The attachments go first, so the chat input is left holding the prompt and the caret
    const missedAttachments = await pasteAttachments(attachments);
    await vscode.env.clipboard.writeText(appendAttachmentSection(text, missedAttachments));

    // Select whatever the input holds, so a second send replaces the prompt rather than piling onto it
    await vscode.commands.executeCommand(SELECT_ALL_COMMAND);
    await vscode.commands.executeCommand(PASTE_COMMAND);
  } catch {
    await vscode.env.clipboard.writeText(appendAttachmentSection(text, attachments));
    void vscode.window.showInformationMessage('Prompt copied to clipboard. Paste it into Claude Code.');
  }
}
