// Registers the command that opens a note as a template and reattaches panels after a reload
import * as vscode from 'vscode';

import { pathExists } from '../common/utils/fs';
import { readStringField } from '../common/utils/webview';
import { VaultNode } from '../common/vaultNode';
import { NoteHistory } from '../history/noteHistory';
import { MentionIndex } from './mentionIndex';
import { TemplatePanel } from './templatePanel';

export class TemplateCommands {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly mentionIndex: MentionIndex,
    private readonly noteHistory: NoteHistory
  ) {}

  // Open a note as a template, ignoring folder rows
  registerOpenCommand(): vscode.Disposable {
    return vscode.commands.registerCommand(
      'promptStudio.openTemplate',
      (target?: VaultNode, preserveFocus?: boolean) => {
        if (!target || target.kind !== 'note') {
          return;
        }

        TemplatePanel.show(this.extensionUri, this.mentionIndex, this.noteHistory, target.absPath, undefined, preserveFocus === true);
      }
    );
  }

  // Reattach template panels VSCode restored after a window reload
  registerSerializer(): vscode.Disposable {
    return vscode.window.registerWebviewPanelSerializer(TemplatePanel.viewType, {
      deserializeWebviewPanel: async (panel: vscode.WebviewPanel, state: unknown): Promise<void> => {
        const notePath = readStringField(state, 'notePath');
        if (!notePath || !(await pathExists(vscode.Uri.file(notePath)))) {
          panel.dispose();
          return;
        }

        const claudeCommand = readStringField(state, 'claudeCommand');
        TemplatePanel.restore(panel, this.extensionUri, this.mentionIndex, this.noteHistory, notePath, claudeCommand);
      }
    });
  }
}
