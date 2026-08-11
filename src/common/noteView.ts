// Reads the setting that picks which view a note opens in, and opens a note that way
import * as vscode from 'vscode';

import { VaultNode } from './vaultNode';

export const NOTE_VIEWS = ['template', 'file'] as const;

export type NoteView = (typeof NOTE_VIEWS)[number];

const SETTING_SECTION = 'promptStudio';
const SETTING_KEY = 'defaultNoteView';

// Read the view a plain open uses, falling back to the template editor
export function defaultNoteView(): NoteView {
  const configured = vscode.workspace.getConfiguration(SETTING_SECTION).get<string>(SETTING_KEY);
  return configured === 'file' ? 'file' : 'template';
}

// Save the view a plain open should use from now on
export async function setDefaultNoteView(view: NoteView): Promise<void> {
  const config = vscode.workspace.getConfiguration(SETTING_SECTION);
  const hasWorkspaceValue = config.inspect<NoteView>(SETTING_KEY)?.workspaceValue !== undefined;

  // Write where the value already sits, or a workspace entry swallows the change
  const target = hasWorkspaceValue ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await config.update(SETTING_KEY, view, target);
}

export async function openNoteInView(view: NoteView, node: VaultNode, preserveFocus: boolean): Promise<void> {
  if (view === 'file') {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(node.absPath), { preserveFocus });
    return;
  }

  await vscode.commands.executeCommand('promptStudio.openTemplate', node, preserveFocus);
}

export function onDidChangeNoteView(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${SETTING_SECTION}.${SETTING_KEY}`)) {
      listener();
    }
  });
}
