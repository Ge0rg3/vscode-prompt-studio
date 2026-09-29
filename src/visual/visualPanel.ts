// Hosts the card canvas panel, its folder watcher, and its webview messages
import * as path from 'node:path';

import * as vscode from 'vscode';

import { applyColorMessage, CARD_COLORS, ColorPreview, postColorPreview } from '../common/cardColors';
import { CardLayoutStore, NotePosition } from '../common/cardLayoutStore';
import { defaultNoteView, NoteView, onDidChangeNoteView, openNoteInView } from '../common/noteView';
import { copyPathToClipboard } from '../common/utils/clipboard';
import { folderExists, pathExists } from '../common/utils/fs';
import { isWithin, relativeToRoot } from '../common/utils/paths';
import { assetUri, renderWebviewHtml } from '../common/utils/webview';
import { CONFIG_FILENAME } from '../common/vaultConfig';
import { VaultNode } from '../common/vaultNode';
import { NOTE_EXT } from '../vault/entryName';
import { readFolder, VisualState } from './folderContents';

// What one canvas is bound to
export interface CanvasContext {
  store: CardLayoutStore;
  root: string;
  allowCrud: boolean;
  colorPreviewEmitter: vscode.EventEmitter<ColorPreview>;
  activeFolderEmitter?: vscode.EventEmitter<string | undefined>;
}

type InboundMessage =
  | { type: 'ready' }
  | { type: 'openNote'; node: VaultNode }
  | { type: 'openFile'; path: string }
  | { type: 'navigate'; folder: string; fromFolder: string; navigateNumber: number }
  | { type: 'moveCard'; path: string; x: number; y: number; z: number }
  | { type: 'resizeCard'; path: string; width: number; height: number }
  | { type: 'setColor'; path: string; color: string | null }
  | { type: 'previewColor'; path: string; color: string | null }
  | { type: 'newEntry'; kind: 'note' | 'folder'; x: number; y: number }
  | { type: 'saveNote'; path: string; text: string }
  | { type: 'command'; command: string; node: VaultNode };

const REFRESH_DEBOUNCE_MS = 100;

// Ignore a note's change event for this long after writing it from a card
const OWN_WRITE_IGNORE_MS = 1000;

// Run only these commands from a canvas message, a webview can send anything
const ALLOWED_COMMANDS = new Set([
  'promptStudio.rename',
  'promptStudio.delete',
  'promptStudio.copyContents',
  'promptStudio.openTemplate',
  'promptStudio.sendToClaude',
  'promptStudio.showHistory',
  'promptStudio.copyPathStatic',
  'promptStudio.copyPathRelative',
  'promptStudio.revealInOS'
]);

// Block these commands on a read-only canvas, they change the folder's structure
const CRUD_COMMANDS = new Set(['promptStudio.rename', 'promptStudio.delete']);

export class VisualPanel {
  static readonly viewType = 'promptStudio.visual';

  private static readonly panels = new Map<string, VisualPanel>();

  // Reveal this root's canvas at the given folder, creating the panel on first use
  static show(extensionUri: vscode.Uri, context: CanvasContext, folder: string): void {
    const existing = VisualPanel.panels.get(context.root);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      void existing.navigate(folder, true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VisualPanel.viewType,
      VisualPanel.titleFor(folder),
      vscode.ViewColumn.Active,
      { ...VisualPanel.webviewOptions(extensionUri), retainContextWhenHidden: true }
    );
    VisualPanel.panels.set(context.root, new VisualPanel(panel, extensionUri, context, folder));
  }

  // Reattach to a canvas panel VSCode restored after a window reload
  static restore(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: CanvasContext,
    folder: string
  ): void {
    panel.webview.options = VisualPanel.webviewOptions(extensionUri);
    VisualPanel.panels.set(context.root, new VisualPanel(panel, extensionUri, context, folder));
  }

  // Close every canvas over the vault, leaving the read-only skill ones open
  static closeVaultCanvases(): void {
    for (const canvas of [...VisualPanel.panels.values()]) {
      if (canvas.context.allowCrud) {
        canvas.panel.dispose();
      }
    }
  }

  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcherSubs: vscode.Disposable[] = [];
  private readonly ownWrites = new Map<string, number>();
  private watcher: vscode.FileSystemWatcher | undefined;

  // Card saves still being written to disk
  private pendingNoteWrites: Promise<void> = Promise.resolve();
  private refreshScheduled = false;
  private stateRequests = 0;
  private saveRequests = 0;
  private folder: string;

  // The number on the webview's latest navigate message, sent back with every state
  private latestNavigateNumber = 0;

  // Send the parent folder's cards with the next state that can carry them.
  // A new panel starts with this on, since the store's start-up refresh can land before the reply to ready
  private shouldSendParent = true;

  // The folder a navigate is moving to while it is checked, so saves to its notes still go through
  private pendingTarget: string | undefined;

  // The folder read last, which the panel goes back to when a folder on disk cannot be read
  private lastReadFolder: string | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly context: CanvasContext,
    initialFolder: string
  ) {
    this.folder = initialFolder;
    this.panel.title = VisualPanel.titleFor(initialFolder);
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => this.handle(msg)),
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.onDidChangeViewState(() => this.emitActiveFolder()),
      this.context.store.onDidChange(() => this.scheduleRefresh()),
      onDidChangeNoteView(() => this.postNoteView()),
      this.context.colorPreviewEmitter.event((preview) => postColorPreview(this.panel.webview, preview))
    );
    this.rebuildWatcher();
    this.emitActiveFolder();
  }

  private dispose(): void {
    VisualPanel.panels.delete(this.context.root);
    this.context.activeFolderEmitter?.fire(undefined);

    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcher?.dispose();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // Move the panel to a folder inside the canvas root and push its state. Anything else leaves the panel where it is
  // and pushes that folder again, parent included
  private async navigate(folder: string, shouldIncludeParent: boolean): Promise<void> {
    const target = path.resolve(folder);
    if (target === this.folder || !isWithin(target, this.context.root)) {
      return this.postState(true);
    }

    // Take saves for the target while it is checked, since the webview has already moved there
    this.pendingTarget = target;
    const isFolder = await folderExists(vscode.Uri.file(target));
    if (this.pendingTarget === target) {
      this.pendingTarget = undefined;
    }
    if (!isFolder) {
      return this.postState(true);
    }

    this.moveTo(target);
    return this.postState(shouldIncludeParent);
  }

  // Move the panel to another folder, taking its title and watcher along
  private moveTo(folder: string): void {
    this.folder = folder;
    this.panel.title = VisualPanel.titleFor(folder);
    this.rebuildWatcher();
    this.emitActiveFolder();
  }

  // Walk up from a folder to the nearest one still on disk, stopping at the canvas root
  private async findNearestExistingFolder(folder: string): Promise<string | undefined> {
    let candidate = folder;
    while (isWithin(candidate, this.context.root)) {
      if (await folderExists(vscode.Uri.file(candidate))) {
        return candidate;
      }
      if (candidate === this.context.root) {
        return undefined;
      }
      candidate = path.dirname(candidate);
    }
    return undefined;
  }

  // Fire this canvas's folder while it is the active panel, undefined otherwise
  private emitActiveFolder(): void {
    this.context.activeFolderEmitter?.fire(this.panel.active ? this.folder : undefined);
  }

  // Point the watcher at the current folder's direct children
  private rebuildWatcher(): void {
    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcherSubs.length = 0;
    this.watcher?.dispose();

    const pattern = new vscode.RelativePattern(this.folder, '*');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcherSubs.push(
      this.watcher.onDidCreate((uri) => this.onFolderEvent(uri)),
      this.watcher.onDidDelete((uri) => this.onFolderEvent(uri)),
      this.watcher.onDidChange((uri) => this.onNoteChange(uri))
    );
  }

  // Test whether an event is the one a card's own write just caused
  private isOwnWrite(absPath: string): boolean {
    const writtenAt = this.ownWrites.get(absPath);
    if (writtenAt === undefined) {
      return false;
    }

    if (Date.now() - writtenAt > OWN_WRITE_IGNORE_MS) {
      this.ownWrites.delete(absPath);
      return false;
    }
    return true;
  }

  // Refresh on any entry change, the layout store fires its own event for the config file
  private onFolderEvent(uri: vscode.Uri): void {
    if (path.basename(uri.fsPath) === CONFIG_FILENAME) {
      return;
    }
    this.scheduleRefresh();
  }

  // Skip the edit a card just wrote, the canvas already shows the text it holds
  private onNoteChange(uri: vscode.Uri): void {
    if (this.isOwnWrite(uri.fsPath)) {
      return;
    }
    this.onFolderEvent(uri);
  }

  // Collapse a burst of file events into one delayed state push
  private scheduleRefresh(): void {
    if (this.refreshScheduled) {
      return;
    }
    this.refreshScheduled = true;
    setTimeout(() => {
      this.refreshScheduled = false;
      void this.postState(false);
    }, REFRESH_DEBOUNCE_MS);
  }

  // Test whether a path names a note card in the folder the canvas is showing, or in the one a navigate is moving it to
  private isCardNote(absPath: string): boolean {
    const name = path.basename(absPath);
    const folder = path.dirname(absPath);
    return (folder === this.folder || folder === this.pendingTarget) &&
      isWithin(absPath, this.context.root) &&
      !name.startsWith('.') &&
      name.toLowerCase().endsWith(NOTE_EXT);
  }

  // Queue a card's edited text, so a command reading the note off disk sees it
  private saveNote(absPath: string, text: string): void {
    if (!this.isCardNote(absPath)) {
      return;
    }

    const requestId = ++this.saveRequests;
    this.pendingNoteWrites = this.pendingNoteWrites.then(async () => {
      await this.writeNote(absPath, text);

      // Push the folder again once the typing settles, so the card titles catch up
      if (requestId === this.saveRequests) {
        this.scheduleRefresh();
      }
    });
  }

  // Write the text over the note, marking it so the change event it fires is skipped
  private async writeNote(absPath: string, text: string): Promise<void> {
    // A note renamed or deleted mid-edit must not be written back into place
    const uri = vscode.Uri.file(absPath);
    if (!(await pathExists(uri))) {
      void vscode.window.showWarningMessage(
        `Prompt Studio: could not save ${path.basename(absPath)}, the note is gone.`
      );
      return;
    }

    this.ownWrites.set(absPath, Date.now());
    try {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Prompt Studio: could not save ${path.basename(absPath)} - ${(err as Error).message}`
      );
    }
  }

  // Follow a folder change the webview made, answering with the open folder when the webview asked from one the panel
  // has since left, such as after a folder was opened from the sidebar
  private async followNavigate(folder: string, fromFolder: string, navigateNumber: number): Promise<void> {
    this.latestNavigateNumber = navigateNumber;
    if (fromFolder !== this.folder) {
      await this.postState(true);
      return;
    }

    // Leave the parent out when the webview opened a child folder, since that parent is the level it just drew
    await this.navigate(folder, path.dirname(path.resolve(folder)) !== fromFolder);
  }

  // Act on one message from the canvas webview
  private async handle(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postNoteView();
        await this.postState(true);
        return;
      case 'openNote':
        if (!isWithin(msg.node.absPath, this.context.root)) {
          return;
        }

        await this.pendingNoteWrites;
        await openNoteInView(this.cardView(), msg.node, false);
        return;
      case 'openFile':
        if (!isWithin(msg.path, this.context.root)) {
          return;
        }

        await this.pendingNoteWrites;
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
        return;
      case 'navigate':
        if (
          typeof msg.folder === 'string' &&
          typeof msg.fromFolder === 'string' &&
          Number.isSafeInteger(msg.navigateNumber)
        ) {
          await this.followNavigate(msg.folder, msg.fromFolder, msg.navigateNumber);
        }
        return;
      case 'moveCard':
        this.context.store.setPosition(msg.path, { x: msg.x, y: msg.y });
        this.context.store.setZ(msg.path, msg.z);
        return;
      case 'resizeCard':
        this.context.store.setSize(msg.path, { width: msg.width, height: msg.height });
        return;
      case 'setColor':
        applyColorMessage(this.context.store, msg);
        return;
      case 'previewColor':
        this.context.colorPreviewEmitter.fire({ path: msg.path, color: msg.color });
        return;
      case 'saveNote':
        if (typeof msg.path === 'string' && typeof msg.text === 'string') {
          this.saveNote(msg.path, msg.text);
        }
        return;
      case 'newEntry':
        if (this.context.allowCrud) {
          await this.createEntry(msg.kind, { x: msg.x, y: msg.y });
        }
        return;
      case 'command':
        if (!ALLOWED_COMMANDS.has(msg.command) || this.isBlockedCommand(msg.command)) {
          return;
        }
        await this.pendingNoteWrites;
        if (msg.command === 'promptStudio.copyPathRelative') {
          await this.copyRelativePath(msg.node);
          return;
        }
        await vscode.commands.executeCommand(msg.command, msg.node);
        return;
    }
  }

  private isBlockedCommand(command: string): boolean {
    return !this.context.allowCrud && CRUD_COMMANDS.has(command);
  }

  // Copy a card's path relative to this canvas root
  private async copyRelativePath(node: VaultNode): Promise<void> {
    await copyPathToClipboard(relativeToRoot(this.context.root, node.absPath), node.name);
  }

  // Create a note or folder in the open folder, placed at the drop point
  private async createEntry(kind: 'note' | 'folder', position: NotePosition): Promise<void> {
    const node: VaultNode = { kind: 'folder', absPath: this.folder, name: path.basename(this.folder) };
    const command = kind === 'note' ? 'promptStudio.newNote' : 'promptStudio.newFolder';
    await vscode.commands.executeCommand(command, node, position);
  }

  // Read the open folder and push it, dropping a read that a newer one has already overtaken
  private async postState(shouldIncludeParent: boolean): Promise<void> {
    // Remember any request for the parent's cards, since a newer read drops the read that asked
    this.shouldSendParent ||= shouldIncludeParent;
    const requestId = ++this.stateRequests;
    await this.pendingNoteWrites;

    // Read the folder, stepping off it when the read fails
    const folder = this.folder;
    let state: VisualState;
    try {
      state = await readFolder(this.context.store, this.context.root, folder, this.shouldSendParent);
    } catch (err) {
      await this.leaveUnreadableFolder(folder, requestId, err);
      return;
    }
    this.lastReadFolder = folder;
    if (requestId !== this.stateRequests) {
      return;
    }

    // Keep asking for the parent's cards until a state carries them, since a parent that failed to read is left out
    this.shouldSendParent &&= !state.parent && state.breadcrumbs.length > 1;
    await this.panel.webview.postMessage({ type: 'state', state, navigateNumber: this.latestNavigateNumber });
  }

  // Move off a folder that failed to read, back to the last folder read if this one is still on disk, else up to the
  // nearest folder left after a delete or a rename
  private async leaveUnreadableFolder(folder: string, requestId: number, readError: unknown): Promise<void> {
    const fallbackFolder = await this.findNearestExistingFolder(folder);
    if (requestId !== this.stateRequests) {
      return;
    }

    // Rethrow when no folder up the tree is left, or this one is still on disk with no earlier folder to go back to
    const destination = fallbackFolder === folder ? this.lastReadFolder : fallbackFolder;
    if (destination === undefined || destination === folder) {
      throw readError;
    }
    this.moveTo(destination);
    await this.postState(true);
  }

  // Pick the view a card opens in, forcing the raw file on a skills canvas so edits save to disk
  private cardView(): NoteView {
    return this.context.allowCrud ? defaultNoteView() : 'file';
  }

  // Push the view a card click opens
  private postNoteView(): void {
    void this.panel.webview.postMessage({ type: 'noteView', view: this.cardView() });
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    return renderWebviewHtml(webview, this.extensionUri, 'media/visual/canvas.html', {
      codiconCss: assetUri(webview, this.extensionUri, 'media/codicons/codicon.css'),
      paletteCss: assetUri(webview, this.extensionUri, 'media/common/palette.css'),
      contextMenuCss: assetUri(webview, this.extensionUri, 'media/common/contextMenu.css'),
      toolbarCss: assetUri(webview, this.extensionUri, 'media/common/toolbar.css'),
      contextMenuJs: assetUri(webview, this.extensionUri, 'media/common/contextMenu.js'),
      noteOpenJs: assetUri(webview, this.extensionUri, 'media/common/noteOpen.js'),
      paletteJs: assetUri(webview, this.extensionUri, 'media/common/palette.js'),
      canvasCss: assetUri(webview, this.extensionUri, 'media/visual/canvas.css'),
      viewportJs: assetUri(webview, this.extensionUri, 'media/visual/viewport.js'),
      cardBuildersJs: assetUri(webview, this.extensionUri, 'media/visual/cards/cardBuilders.js'),
      coverageJs: assetUri(webview, this.extensionUri, 'media/visual/zoom/coverage.js'),
      levelsJs: assetUri(webview, this.extensionUri, 'media/visual/zoom/levels.js'),
      lookPainterJs: assetUri(webview, this.extensionUri, 'media/visual/zoom/lookPainter.js'),
      ancestorsJs: assetUri(webview, this.extensionUri, 'media/visual/zoom/ancestors.js'),
      folderZoomJs: assetUri(webview, this.extensionUri, 'media/visual/zoom/folderZoom.js'),
      noteEditingJs: assetUri(webview, this.extensionUri, 'media/visual/cards/noteEditing.js'),
      heldStatesJs: assetUri(webview, this.extensionUri, 'media/visual/heldStates.js'),
      colorsJs: assetUri(webview, this.extensionUri, 'media/visual/colors.js'),
      menusJs: assetUri(webview, this.extensionUri, 'media/visual/menus.js'),
      canvasJs: assetUri(webview, this.extensionUri, 'media/visual/canvas.js'),
      cardColors: JSON.stringify(CARD_COLORS),
      allowCrud: JSON.stringify(this.context.allowCrud)
    });
  }

  // Label the panel tab with the folder name
  private static titleFor(folder: string): string {
    return `Visual: ${path.basename(folder) || folder}`;
  }

  // Allow scripts and limit asset loads to the bundled media folder
  private static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    };
  }
}
