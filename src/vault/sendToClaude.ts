// Registers the command that drops a note's text into the Claude Code chat input
import * as vscode from 'vscode';

import { splitOutAttachments } from '../common/noteAttachments';
import { sendToClaude } from '../common/sendToClaude';
import { readTextFile } from '../common/utils/fs';
import { VaultNode } from '../common/vaultNode';

export function registerSendToClaude(): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.sendToClaude', async (target?: VaultNode) => {
    if (!target || target.kind !== 'note') {
      return;
    }

    const note = await splitOutAttachments(target.absPath, await readTextFile(target.absPath));
    await sendToClaude(note.text, note.attachments);
  });
}
