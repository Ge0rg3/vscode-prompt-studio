import * as vscode from 'vscode';

import { pathExists } from '../common/utils/fs';
import { VaultNode } from '../common/vaultNode';
import { TemplatePanel } from './templatePanel';

// --- helpers ---

// the note path stashed in a restored panel's state
function readStateNotePath(state: unknown): string | undefined {
  if (state && typeof state === 'object' && typeof (state as { notePath?: unknown }).notePath === 'string') {
    return (state as { notePath: string }).notePath;
  }
  return undefined;
}

// --- exports ---

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
      const notePath = readStateNotePath(state);
      if (!notePath || !(await pathExists(vscode.Uri.file(notePath)))) {
        panel.dispose();
        return;
      }

      TemplatePanel.restore(panel, extensionUri, notePath);
    }
  });
}
