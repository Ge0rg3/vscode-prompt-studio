// Copies a path to the clipboard and confirms it in the status bar
import * as vscode from 'vscode';

export async function copyPathToClipboard(pathText: string, name: string): Promise<void> {
  await vscode.env.clipboard.writeText(pathText);
  void vscode.window.setStatusBarMessage(`Copied path of "${name}" to clipboard.`, 2000);
}
