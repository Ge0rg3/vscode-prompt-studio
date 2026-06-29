import * as vscode from 'vscode';

import { sendTextToClaude } from '../common/sendToClaude';
import { VaultNode } from '../common/vaultNode';

export function registerSendToClaude(): vscode.Disposable {
  return vscode.commands.registerCommand('promptStudio.sendToClaude', async (target?: VaultNode) => {
    if (!target || target.kind !== 'note') {
      return;
    }

    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target.absPath));
    await sendTextToClaude(new TextDecoder('utf-8').decode(bytes));
  });
}
