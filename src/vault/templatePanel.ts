import * as fs from 'node:fs';
import * as path from 'node:path';

import { marked } from 'marked';
import * as vscode from 'vscode';

import { fillTemplate, randomNonce } from '../common/utils/webview';
import { sendTextToClaude } from './sendToClaude';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'render'; text: string }
  | { type: 'copy'; text: string }
  | { type: 'sendToClaude'; text: string };

interface EditorStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  tabSize: number;
}

// --- helpers ---

// panel tab label for a note opened as a template
function titleFor(notePath: string): string {
  return `${path.basename(notePath).replace(/\.md$/i, '')} (template)`;
}

// scripts on, asset loads limited to the bundled media folder
function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
  };
}

// the user's editor font and spacing
function editorStyle(): EditorStyle {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const fontFamily = editorConfig.get<string>('fontFamily', 'monospace');
  const fontSize = editorConfig.get<number>('fontSize', 14);
  const fontWeight = editorConfig.get<string>('fontWeight', 'normal');
  const tabSize = editorConfig.get<number>('tabSize', 4);
  const lineHeightSetting = editorConfig.get<number>('lineHeight', 0);

  // convert editor.lineHeight to pixels (0 auto, under 8 a multiplier)
  let lineHeight = lineHeightSetting;
  if (lineHeightSetting === 0) {
    lineHeight = Math.round(1.5 * fontSize);
  } else if (lineHeightSetting < 8) {
    lineHeight = Math.round(lineHeightSetting * fontSize);
  }

  return { fontFamily, fontSize, fontWeight, lineHeight, tabSize };
}

// --- exports ---

export class TemplatePanel {
  static readonly viewType = 'promptStudio.template';

  private static readonly openPanels = new Map<string, TemplatePanel>();

  // reveal the note's template panel, creating it on first use
  static show(extensionUri: vscode.Uri, notePath: string): void {
    const existing = TemplatePanel.openPanels.get(notePath);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TemplatePanel.viewType,
      titleFor(notePath),
      vscode.ViewColumn.Active,
      { ...webviewOptions(extensionUri), retainContextWhenHidden: true }
    );
    new TemplatePanel(panel, extensionUri, notePath);
  }

  // reattach to a template panel VSCode restored after a window reload
  static restore(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, notePath: string): void {
    panel.webview.options = webviewOptions(extensionUri);
    new TemplatePanel(panel, extensionUri, notePath);
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly notePath: string
  ) {
    TemplatePanel.openPanels.set(notePath, this);
    this.panel.title = titleFor(notePath);
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => this.handle(msg)),
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
          style: editorStyle()
        });
        return;
      }
      case 'render': {
        const html = await marked.parse(msg.text);
        await this.panel.webview.postMessage({ type: 'rendered', html });
        return;
      }
      case 'copy':
        await vscode.env.clipboard.writeText(msg.text);
        void vscode.window.setStatusBarMessage('Copied template to clipboard.', 2000);
        return;
      case 'sendToClaude':
        await sendTextToClaude(msg.text);
        return;
    }
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const nonce = randomNonce();
    const codiconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/codicons/codicon.css')
    );
    const templateCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/template/template.css')
    );
    const templateJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media/template/template.js')
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    const template = fs.readFileSync(
      path.join(this.extensionUri.fsPath, 'media/template/template.html'),
      'utf8'
    );
    return fillTemplate(template, {
      csp,
      nonce,
      codiconCss: codiconCss.toString(),
      templateCss: templateCss.toString(),
      templateJs: templateJs.toString()
    });
  }
}
