import * as vscode from 'vscode';

import { pathExists } from '../common/utils/fs';
import { readStringField } from '../common/utils/webview';
import { VaultNode } from '../common/vaultNode';
import { TemplatePanel } from './templatePanel';

export function registerOpenTemplate(extensionUri: vscode.Uri): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.openTemplate', (target?: VaultNode) => {
    if (!target || target.kind !== 'note') {
      return;
    }

    TemplatePanel.show(extensionUri, target.absPath);
  });
}

export function registerTemplateSerializer(extensionUri: vscode.Uri): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(TemplatePanel.viewType, {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
      const notePath = readStringField(state, 'notePath');
      if (!notePath || !(await pathExists(vscode.Uri.file(notePath)))) {
        panel.dispose();
        return;
      }

      TemplatePanel.restore(panel, extensionUri, notePath, readStringField(state, 'claudeCommand'));
    }
  });
}
