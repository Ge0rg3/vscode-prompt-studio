import * as vscode from 'vscode';

import { VaultNode } from '../common/vaultNode';

const FOCUS_SETTLE_MS = 60;

export function registerSendToClaude(): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.sendToClaude', async (target?: VaultNode) => {
    if (!target || target.kind !== 'note') {
      return;
    }

    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target.absPath));
    const prompt = new TextDecoder('utf-8').decode(bytes);
    await vscode.env.clipboard.writeText(prompt);

    // focus the Claude Code chat input and paste the note into it
    try {
      await vscode.commands.executeCommand('claude-vscode.focus');
      await new Promise((resolve) => setTimeout(resolve, FOCUS_SETTLE_MS));
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    } catch {
      void vscode.window.showInformationMessage('Prompt copied to clipboard. Paste it into Claude Code.');
    }
  });
}
