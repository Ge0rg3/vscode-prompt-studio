// Registers the command that opens a note as a template and reattaches panels after a reload
import * as vscode from 'vscode';

import { pathExists } from '../common/utils/fs';
import { readStringField } from '../common/utils/webview';
import { VaultNode } from '../common/vaultNode';
import { MentionIndex } from './mentionIndex';
import { TemplatePanel } from './templatePanel';

// Open a note as a template, ignoring folder rows
export function registerOpenTemplate(extensionUri: vscode.Uri, mentionIndex: MentionIndex): vscode.Disposable {
  return vscode.commands.registerCommand(
    'promptStudio.openTemplate',
    (target?: VaultNode, preserveFocus?: boolean) => {
      if (!target || target.kind !== 'note') {
        return;
      }

      TemplatePanel.show(extensionUri, mentionIndex, target.absPath, undefined, preserveFocus === true);
    }
  );
}

// Reattach template panels VSCode restored after a window reload
export function registerTemplateSerializer(extensionUri: vscode.Uri, mentionIndex: MentionIndex): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(TemplatePanel.viewType, {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
      const notePath = readStringField(state, 'notePath');
      if (!notePath || !(await pathExists(vscode.Uri.file(notePath)))) {
        panel.dispose();
        return;
      }

      TemplatePanel.restore(panel, extensionUri, mentionIndex, notePath, readStringField(state, 'claudeCommand'));
    }
  });
}
