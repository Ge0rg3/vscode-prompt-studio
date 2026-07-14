import * as path from 'node:path';

import * as vscode from 'vscode';

import { sendTextToClaude } from '../common/sendToClaude';
import { assetUri, renderWebviewHtml } from '../common/utils/webview';
import { existingPaths, listDirectory } from './mentionFilesystem';
import { MentionIndex } from './mentionIndex';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'copy'; text: string }
  | { type: 'sendToClaude'; text: string }
  | { type: 'listDir'; id: number; dirPath: string }
  | { type: 'checkPaths'; paths: string[] };

export class TemplatePanel {
  static readonly viewType = 'promptStudio.template';

  private static readonly openPanels = new Map<string, TemplatePanel>();

  // reveal the note's template panel, creating it on first use
  static show(extensionUri: vscode.Uri, mentionIndex: MentionIndex, notePath: string, claudeCommand?: string): void {
    const existing = TemplatePanel.openPanels.get(notePath);
    if (existing) {
      if (claudeCommand !== undefined) {
        existing.claudeCommand = claudeCommand;
      }
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TemplatePanel.viewType,
      TemplatePanel.titleFor(notePath),
      vscode.ViewColumn.Active,
      { ...TemplatePanel.webviewOptions(extensionUri), retainContextWhenHidden: true }
    );
    new TemplatePanel(panel, extensionUri, mentionIndex, notePath, claudeCommand);
  }

  // reattach to a template panel VSCode restored after a window reload
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

  // panel tab label for a note opened as a template
  private static titleFor(notePath: string): string {
    return `${path.basename(notePath).replace(/\.md$/i, '')} (template)`;
  }

  // scripts on, asset loads limited to the bundled media folder
  private static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    };
  }
}
