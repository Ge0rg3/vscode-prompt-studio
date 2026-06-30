import * as vscode from 'vscode';

// give the chat input time to take focus before pasting
const FOCUS_SETTLE_MS = 60;

// drop text into claude code's chat input
export async function sendTextToClaude(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);

  try {
    await vscode.commands.executeCommand('claude-vscode.focus');
    await new Promise((resolve) => setTimeout(resolve, FOCUS_SETTLE_MS));
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
  } catch {
    void vscode.window.showInformationMessage('Prompt copied to clipboard. Paste it into Claude Code.');
  }
}
