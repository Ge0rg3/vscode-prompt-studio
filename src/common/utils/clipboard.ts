import * as vscode from 'vscode';

// copy a path to the clipboard and flash a status-bar confirmation
export async function copyPathToClipboard(pathText: string, name: string): Promise<void> {
  await vscode.env.clipboard.writeText(pathText);
  void vscode.window.setStatusBarMessage(`Copied path of "${name}" to clipboard.`, 2000);
}
