// Flashes a short confirmation in the status bar
import * as vscode from 'vscode';

// How long a status-bar note stays up
const STATUS_MESSAGE_MS = 2000;

export function flashStatusMessage(message: string): void {
  void vscode.window.setStatusBarMessage(message, STATUS_MESSAGE_MS);
}
