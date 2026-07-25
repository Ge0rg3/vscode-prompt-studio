// Hosts the template panel for one note, its webview messages, and the lookups behind an @ mention
import * as path from 'node:path';

import * as vscode from 'vscode';

import { sendTextToClaude } from '../common/sendToClaude';
import { assetUri, renderWebviewHtml } from '../common/utils/webview';
import { existingPaths, listDirectory } from './mentionFilesystem';
import { MentionIndex } from './mentionIndex';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'save'; text: string }
  | { type: 'dirty'; dirty: boolean }
  | { type: 'copy'; text: string }
  | { type: 'sendToClaude'; text: string }
  | { type: 'listDir'; id: number; dirPath: string }
  | { type: 'checkPaths'; paths: string[] };

export class TemplatePanel {
  static readonly viewType = 'promptStudio.template';

  private static readonly openPanels = new Map<string, TemplatePanel>();

  // Reveal the note's template panel, creating it on first use
  static show(
    extensionUri: vscode.Uri,
    mentionIndex: MentionIndex,
    notePath: string,
    claudeCommand?: string,
    preserveFocus = false
  ): void {
    const existing = TemplatePanel.openPanels.get(notePath);
    if (existing) {
      if (claudeCommand !== undefined) {
        existing.claudeCommand = claudeCommand;
      }
      existing.panel.reveal(vscode.ViewColumn.Active, preserveFocus);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TemplatePanel.viewType,
      TemplatePanel.titleFor(notePath),
      { viewColumn: vscode.ViewColumn.Active, preserveFocus },
      { ...TemplatePanel.webviewOptions(extensionUri), retainContextWhenHidden: true }
    );
    new TemplatePanel(panel, extensionUri, mentionIndex, notePath, claudeCommand);
  }

  // Reattach to a template panel VSCode restored after a window reload
  static restore(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    mentionIndex: MentionIndex,
    notePath: string,
    claudeCommand?: string
  ): void {
    panel.webview.options = TemplatePanel.webviewOptions(extensionUri);
    new TemplatePanel(panel, extensionUri, mentionIndex, notePath, claudeCommand);
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly mentionIndex: MentionIndex,
    private readonly notePath: string,
    private claudeCommand: string | undefined
  ) {
    TemplatePanel.openPanels.set(notePath, this);
    this.panel.title = TemplatePanel.titleFor(notePath);
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => this.handle(msg)),
      this.mentionIndex.onDidChange(() => void this.postMentions()),
      this.panel.onDidDispose(() => this.dispose())
    );
  }

  private dispose(): void {
    TemplatePanel.openPanels.delete(this.notePath);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // Act on one message from the template webview
  private async handle(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(this.notePath));
        const text = new TextDecoder('utf-8').decode(bytes);
        await this.panel.webview.postMessage({
          type: 'content',
          text,
          notePath: this.notePath,
          claudeCommand: this.claudeCommand
        });
        await this.postMentions();
        return;
      }
      case 'save':
        await vscode.workspace.fs.writeFile(vscode.Uri.file(this.notePath), new TextEncoder().encode(msg.text));
        await this.panel.webview.postMessage({ type: 'saved', text: msg.text });
        void vscode.window.setStatusBarMessage(`Saved "${path.basename(this.notePath)}".`, 2000);
        return;
      case 'dirty':
        this.markDirty(msg.dirty);
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(msg.text);
        void vscode.window.setStatusBarMessage('Copied template to clipboard.', 2000);
        return;
      case 'sendToClaude':
        await sendTextToClaude(this.claudeCommand ?? msg.text);
        return;
      case 'listDir':
        await this.panel.webview.postMessage({
          type: 'dirEntries',
          id: msg.id,
          entries: await listDirectory(msg.dirPath)
        });
        return;
      case 'checkPaths':
        await this.panel.webview.postMessage({ type: 'verifiedPaths', entries: await existingPaths(msg.paths) });
        return;
    }
  }

  private async postMentions(): Promise<void> {
    await this.panel.webview.postMessage({ type: 'mentions', entries: await this.mentionIndex.entries() });
  }

  // Suffix the tab title with a white circle while the editor differs from what is on disk
  private markDirty(dirty: boolean): void {
    this.panel.title = TemplatePanel.titleFor(this.notePath) + (dirty ? ' \u26AA' : '');
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    return renderWebviewHtml(
      webview,
      this.extensionUri,
      'media/template/template.html',
      {
        codiconCss: assetUri(webview, this.extensionUri, 'media/codicons/codicon.css'),
        templateCss: assetUri(webview, this.extensionUri, 'media/template/template.css'),
        templateJs: assetUri(webview, this.extensionUri, 'media/template/template.js')
      },
      true
    );
  }

  // Build the tab label for a note opened as a template
  private static titleFor(notePath: string): string {
    return `${path.basename(notePath).replace(/\.md$/i, '')} (template)`;
  }

  // Allow scripts and limit asset loads to the bundled media folder
  private static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    };
  }
}
