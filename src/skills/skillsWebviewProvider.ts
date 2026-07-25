// Hosts the Claude Skills sidebar webview, its watchers, and its messages.
import * as path from 'node:path';

import * as vscode from 'vscode';

import { applyColorMessage, CARD_COLORS, ColorPreview, postColorPreview } from '../common/cardColors';
import { copyPathToClipboard } from '../common/utils/clipboard';
import { isWithin, relativeToRoot } from '../common/utils/paths';
import { assetUri, renderWebviewHtml } from '../common/utils/webview';
import { CONFIG_FILENAME } from '../common/vaultConfig';
import { SkillTreeNode } from './skillNode';
import { owningSkillsDir } from './skillScanner';
import { SkillsConfigs } from './skillsConfigs';
import { buildSkillsTree } from './skillsTree';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'openNote'; path: string }
  | { type: 'setColor'; path: string; color: string | null }
  | { type: 'previewColor'; path: string; color: string | null }
  | { type: 'command'; command: string; node?: SkillTreeNode };

const HAS_SKILLS_CONTEXT = 'promptStudio.hasSkills';
const REFRESH_DEBOUNCE_MS = 100;
const ALLOWED_COMMANDS = new Set([
  'promptStudio.openSkill',
  'promptStudio.openSkillTemplate',
  'promptStudio.openSkillVisual',
  'promptStudio.sendSkillToClaude',
  'promptStudio.newSkill',
  'promptStudio.openSkillsCanvas',
  'promptStudio.revealInOS',
  'promptStudio.copyPathStatic',
  'promptStudio.copyPathRelative'
]);

// watch every .claude/skills in the workspace, the bare .claude catches a new sub-project appearing
const WATCH_PATTERNS = ['**/.claude', '**/.claude/skills', '**/.claude/skills/**'] as const;

export class SkillsWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'promptStudio.skills';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcherSubs: vscode.Disposable[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private children: SkillTreeNode[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly skillsConfigs: SkillsConfigs,
    private readonly colorPreviewEmitter: vscode.EventEmitter<ColorPreview>
  ) {
    this.rebuildWatchers();
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.rebuildWatchers();
        this.scheduleRefresh();
      }),
      skillsConfigs.onDidChange(() => this.scheduleRefresh()),
      colorPreviewEmitter.event((preview) => postColorPreview(this.view?.webview, preview))
    );
    void this.refresh();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    view.webview.html = this.renderHtml(view.webview);
    view.onDidDispose(() => {
      this.view = undefined;
    });
    this.disposables.push(view.webview.onDidReceiveMessage((msg) => this.handle(msg)));
  }

  expandAll(): void {
    void this.view?.webview.postMessage({ type: 'expandAll' });
  }

  collapseAll(): void {
    void this.view?.webview.postMessage({ type: 'collapseAll' });
  }

  // re-scan and repaint the tree
  async refresh(): Promise<void> {
    this.children = await buildSkillsTree(this.skillsConfigs);
    await vscode.commands.executeCommand(
      'setContext',
      HAS_SKILLS_CONTEXT,
      this.children.length > 0
    );
    await this.postState();
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.teardownWatchers();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async postState(): Promise<void> {
    await this.view?.webview.postMessage({ type: 'state', children: this.children });
  }

  private async handle(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.postState();
        return;
      case 'openNote':
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
        return;
      case 'setColor': {
        const target = this.rowPath(msg.path);
        const config = target ? this.skillsConfigs.configFor(target) : undefined;
        if (target && config) {
          applyColorMessage(config, { ...msg, path: target });
        }
        return;
      }
      case 'previewColor': {
        const target = this.rowPath(msg.path);
        if (target) {
          this.colorPreviewEmitter.fire({ path: target, color: msg.color });
        }
        return;
      }
      case 'command':
        if (!ALLOWED_COMMANDS.has(msg.command)) {
          return;
        }
        if (msg.command === 'promptStudio.copyPathRelative') {
          await this.copyRelativePath(msg.node);
          return;
        }
        await vscode.commands.executeCommand(msg.command, msg.node);
        return;
    }
  }

  // a webview path, resolved and confined to the skills root that owns it
  private rowPath(rawPath: string): string | undefined {
    const target = path.resolve(rawPath);
    const skillsDir = owningSkillsDir(target);
    return skillsDir && isWithin(target, skillsDir) ? target : undefined;
  }

  // copy a node's path relative to its skills root, project rows relative to the workspace
  private async copyRelativePath(node: SkillTreeNode | undefined): Promise<void> {
    if (!node) {
      return;
    }

    const workspace = vscode.workspace.workspaceFolders?.[0];
    const root = owningSkillsDir(node.absPath) ?? workspace?.uri.fsPath;
    if (!root || !isWithin(node.absPath, root)) {
      return;
    }

    await copyPathToClipboard(relativeToRoot(root, node.absPath), node.name);
  }

  // one watcher per pattern, rebuilt whenever the workspace folders change
  private rebuildWatchers(): void {
    this.teardownWatchers();

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      return;
    }

    for (const pattern of WATCH_PATTERNS) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspace, pattern)
      );
      this.watchers.push(watcher);
      this.watcherSubs.push(
        watcher.onDidCreate((uri) => this.onSkillsEvent(uri)),
        watcher.onDidChange((uri) => this.onSkillsEvent(uri)),
        watcher.onDidDelete((uri) => this.onSkillsEvent(uri))
      );
    }
  }

  // re-scan on skill edits, skip config.yml layout writes
  private onSkillsEvent(uri: vscode.Uri): void {
    if (path.basename(uri.fsPath) === CONFIG_FILENAME) {
      return;
    }
    this.scheduleRefresh();
  }

  private teardownWatchers(): void {
    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcherSubs.length = 0;
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers.length = 0;
  }

  // collapse a burst of fs events into one re-scan after the last one settles
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private renderHtml(webview: vscode.Webview): string {
    return renderWebviewHtml(webview, this.extensionUri, 'media/skills/tree.html', {
      codiconCss: assetUri(webview, this.extensionUri, 'media/codicons/codicon.css'),
      paletteCss: assetUri(webview, this.extensionUri, 'media/common/palette.css'),
      contextMenuCss: assetUri(webview, this.extensionUri, 'media/common/contextMenu.css'),
      treeCss: assetUri(webview, this.extensionUri, 'media/vault/tree.css'),
      contextMenuJs: assetUri(webview, this.extensionUri, 'media/common/contextMenu.js'),
      paletteJs: assetUri(webview, this.extensionUri, 'media/common/palette.js'),
      treeJs: assetUri(webview, this.extensionUri, 'media/skills/tree.js'),
      cardColors: JSON.stringify(CARD_COLORS)
    });
  }
}
