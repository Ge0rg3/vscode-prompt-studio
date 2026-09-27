// Copies a path to the clipboard and confirms it in the status bar
import * as vscode from 'vscode';

import { flashStatusMessage } from './statusBar';

export async function copyPathToClipboard(pathText: string, name: string): Promise<void> {
  await vscode.env.clipboard.writeText(pathText);
  flashStatusMessage(`Copied path of "${name}" to clipboard.`);
}
