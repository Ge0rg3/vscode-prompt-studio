// Hosts the template panel for one note, its webview messages, and the lookups behind an @ mention
import * as path from 'node:path';

import * as vscode from 'vscode';

import { attachmentsIn, dropAttachment, pruneAttachments, splitOutAttachments } from '../common/noteAttachments';
import { sendToClaude } from '../common/sendToClaude';
import { assetUri, renderWebviewHtml } from '../common/utils/webview';
import { existingPaths, listDirectory } from './mentionFilesystem';
import { MentionIndex } from './mentionIndex';
import { openMention } from './openMention';
import { copyPickedFiles, MAX_ATTACHMENT_MB, resolveAttachments, storeAttachment } from './panelAttachments';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'save'; text: string }
  | { type: 'dirty'; dirty: boolean }
  | { type: 'copy'; text: string }
  | { type: 'sendToClaude'; text: string }
  | { type: 'listDir'; id: number; dirPath: string }
  | { type: 'checkPaths'; paths: string[] }
  | { type: 'openMention'; path: string }
  | { type: 'attachFile'; id: number; name: string; mime: string; base64: string }
  | { type: 'attachFromDisk' }
  | { type: 'attachmentTooLarge'; name: string }
  | { type: 'resolveAttachments'; references: string[] }
  | { type: 'dropAttachment'; reference: string };

// How long a status-bar note stays up
const STATUS_MESSAGE_MS = 2000;

export class TemplatePanel {
  static readonly viewType = 'promptStudio.template';

  private static readonly openPanels = new Map<string, TemplatePanel>();

  private readonly disposables: vscode.Disposable[] = [];

  // Edits in the editor and files still being written, none of it on disk yet
  private isDirty = false;
  private pendingAttachmentWrites = 0;

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
      case 'ready':
        await this.postContent();
        await this.postMentions();
        return;
      case 'save':
        await this.saveNote(msg.text);
        return;
      case 'dirty':
        this.markDirty(msg.dirty);
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(msg.text);
        void vscode.window.setStatusBarMessage('Copied template to clipboard.', STATUS_MESSAGE_MS);
        return;
      case 'sendToClaude':
        await this.sendNote(msg.text);
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
      case 'openMention':
        await openMention(msg.path);
        return;
      case 'attachFile':
        await this.attachFile(msg.id, msg.name, msg.mime, msg.base64);
        return;
      case 'attachFromDisk':
        await this.attachFromDisk();
        return;
      case 'attachmentTooLarge':
        void vscode.window.showWarningMessage(
          `"${path.basename(msg.name)}" is over the ${MAX_ATTACHMENT_MB} MB attachment limit.`
        );
        return;
      case 'resolveAttachments':
        await this.postResolvedAttachments(msg.references);
        return;
      case 'dropAttachment':
        await dropAttachment(this.notePath, msg.reference);
        return;
    }
  }

  // Hand the editor the note as it sits on disk
  private async postContent(): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(this.notePath));
    await this.panel.webview.postMessage({
      type: 'content',
      text: new TextDecoder('utf-8').decode(bytes),
      notePath: this.notePath,
      claudeCommand: this.claudeCommand
    });
  }

  // Send the slash command when the panel came from a skill, and the note's words with its files otherwise
  private async sendNote(text: string): Promise<void> {
    if (this.claudeCommand !== undefined) {
      await sendToClaude(this.claudeCommand);
      return;
    }

    const note = await splitOutAttachments(this.notePath, text);
    await sendToClaude(note.text, note.attachments);
  }

  // Write the editor's text over the note, then tidy the folder's attachments
  private async saveNote(text: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(this.notePath), new TextEncoder().encode(text));
    await this.panel.webview.postMessage({ type: 'saved', text });
    void vscode.window.setStatusBarMessage(`Saved "${path.basename(this.notePath)}".`, STATUS_MESSAGE_MS);

    // A prune reads the notes on disk, so it waits until every panel here has written what it holds
    const noteDir = path.dirname(this.notePath);
    if (!TemplatePanel.hasUnwrittenWork(noteDir, this)) {
      await pruneAttachments(noteDir);
    }
  }

  // Store a pasted file beside the note and hand the editor the reference to point at
  private async attachFile(id: number, name: string, mime: string, base64: string): Promise<void> {
    this.pendingAttachmentWrites++;
    try {
      const reference = await storeAttachment(this.notePath, name, mime, base64);
      await this.panel.webview.postMessage({ type: 'attached', id, reference });
    } finally {
      this.pendingAttachmentWrites--;
    }
  }

  // Copy files the user picks off disk into the note's attachments folder
  private async attachFromDisk(): Promise<void> {
    const pickedFiles = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      openLabel: 'Attach'
    });
    if (!pickedFiles) {
      return;
    }

    this.pendingAttachmentWrites++;
    try {
      const references = await copyPickedFiles(this.notePath, pickedFiles);
      await this.panel.webview.postMessage({ type: 'attachedFromDisk', references });
    } finally {
      this.pendingAttachmentWrites--;
    }
  }

  // Answer with a uri and the details of every reference that names a file beside the note
  private async postResolvedAttachments(references: string[]): Promise<void> {
    const entries = await resolveAttachments(this.panel.webview, this.notePath, references);
    await this.panel.webview.postMessage({ type: 'resolvedAttachments', entries });
  }

  private async postMentions(): Promise<void> {
    await this.panel.webview.postMessage({ type: 'mentions', entries: await this.mentionIndex.entries() });
  }

  // Suffix the tab title with a white circle while the editor differs from what is on disk
  private markDirty(dirty: boolean): void {
    this.isDirty = dirty;
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
        toolbarCss: assetUri(webview, this.extensionUri, 'media/common/toolbar.css'),
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

  // Test whether a panel on this folder holds edits or a file no note there names yet
  private static hasUnwrittenWork(noteDir: string, savingPanel: TemplatePanel): boolean {
    for (const panel of TemplatePanel.openPanels.values()) {
      if (path.dirname(panel.notePath) !== noteDir) {
        continue;
      }

      // The text of the panel doing the saving has just landed, so only its writes still count
      if (panel.pendingAttachmentWrites > 0 || (panel !== savingPanel && panel.isDirty)) {
        return true;
      }
    }

    return false;
  }

  // Allow scripts, and load assets from the bundled media folder and the note's attachments
  private static webviewOptions(extensionUri: vscode.Uri, notePath: string): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'media'),
        vscode.Uri.file(attachmentsIn(path.dirname(notePath)))
      ]
    };
  }

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
      { ...TemplatePanel.webviewOptions(extensionUri, notePath), retainContextWhenHidden: true }
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
    panel.webview.options = TemplatePanel.webviewOptions(extensionUri, notePath);
    new TemplatePanel(panel, extensionUri, mentionIndex, notePath, claudeCommand);
  }
}
