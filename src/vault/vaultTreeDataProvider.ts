import * as path from 'node:path';

import * as vscode from 'vscode';

import { moveVaultEntry } from './moveEntry';
import { VaultManager } from './vaultManager';

export type VaultNodeKind = 'folder' | 'note';

export interface VaultNode {
  kind: VaultNodeKind;
  absPath: string;
  name: string;
}

const NOTE_EXT = '.md';
const REFRESH_DEBOUNCE_MS = 100;
const DRAG_MIME = 'application/vnd.code.tree.promptstudio.vault';

// --- helpers ---

// read one directory level, drop dotfiles and non-markdown files, folders first then alpha
async function readChildren(dir: string): Promise<VaultNode[]> {
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));

  const nodes: VaultNode[] = [];
  for (const [name, type] of entries) {
    if (name.startsWith('.')) {
      continue;
    }
    const abs = path.join(dir, name);
    if (type === vscode.FileType.Directory) {
      nodes.push({ kind: 'folder', absPath: abs, name });
    } else if (type === vscode.FileType.File && name.toLowerCase().endsWith(NOTE_EXT)) {
      nodes.push({ kind: 'note', absPath: abs, name });
    }
  }

  nodes.sort((first, second) => {
    if (first.kind !== second.kind) {
      return first.kind === 'folder' ? -1 : 1;
    }
    return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' });
  });

  return nodes;
}

// strip the .md extension for display, on-disk name keeps it
function stripNoteExt(name: string): string {
  return name.replace(/\.md$/i, '');
}

// --- exports ---

export class VaultTreeDataProvider
  implements
    vscode.TreeDataProvider<VaultNode>,
    vscode.TreeDragAndDropController<VaultNode>,
    vscode.Disposable
{
  readonly dropMimeTypes = [DRAG_MIME];
  readonly dragMimeTypes = [DRAG_MIME];

  private readonly emitter = new vscode.EventEmitter<VaultNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<VaultNode | undefined> = this.emitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly expandedFolders = new Set<string>();
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshScheduled = false;

  constructor(private readonly vaultManager: VaultManager) {
    this.rebuildWatcher();
    this.disposables.push(
      vaultManager.onDidChangeVault(() => {
        this.rebuildWatcher();
        this.refresh();
      })
    );
  }

  getTreeItem(node: VaultNode): vscode.TreeItem {
    const isFolder = node.kind === 'folder';
    const isExpanded = isFolder && this.expandedFolders.has(node.absPath);
    const label = isFolder ? node.name : stripNoteExt(node.name);
    const item = new vscode.TreeItem(
      label,
      isFolder
        ? isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    item.id = node.absPath;
    item.contextValue = node.kind;
    item.tooltip = node.absPath;
    item.iconPath = isFolder
      ? new vscode.ThemeIcon(isExpanded ? 'folder-opened' : 'folder')
      : new vscode.ThemeIcon('note');
    if (!isFolder) {
      item.command = {
        command: 'vscode.open',
        title: 'Open Note',
        arguments: [vscode.Uri.file(node.absPath)]
      };
    }
    return item;
  }

  // sync expansion state from TreeView events, swap the folder icon
  setExpanded(node: VaultNode, isExpanded: boolean): void {
    if (node.kind !== 'folder') {
      return;
    }
    const had = this.expandedFolders.has(node.absPath);
    if (had === isExpanded) {
      return;
    }
    if (isExpanded) {
      this.expandedFolders.add(node.absPath);
    } else {
      this.expandedFolders.delete(node.absPath);
    }
    this.emitter.fire(node);
  }

  async getChildren(node?: VaultNode): Promise<VaultNode[]> {
    if (!node) {
      const root = this.vaultManager.getVaultRoot();
      if (!root) {
        return [];
      }
      return readChildren(root);
    }
    if (node.kind !== 'folder') {
      return [];
    }
    return readChildren(node.absPath);
  }

  handleDrag(source: readonly VaultNode[], transfer: vscode.DataTransfer): void {
    if (source.length === 0) {
      return;
    }
    transfer.set(DRAG_MIME, new vscode.DataTransferItem(source[0].absPath));
  }

  async handleDrop(target: VaultNode | undefined, transfer: vscode.DataTransfer): Promise<void> {
    const item = transfer.get(DRAG_MIME);
    if (!item) {
      return;
    }

    const source = await item.asString();
    if (!source) {
      return;
    }

    const root = this.vaultManager.getVaultRoot();
    if (!root) {
      return;
    }

    const targetDir = target
      ? target.kind === 'folder'
        ? target.absPath
        : path.dirname(target.absPath)
      : root;

    const moved = await moveVaultEntry(root, source, targetDir);
    if (moved) {
      this.refresh();
    }
  }

  dispose(): void {
    this.watcher?.dispose();
    this.emitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // tear down any previous watcher, attach a new one to the current vault root
  private rebuildWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;

    const root = this.vaultManager.getVaultRoot();
    if (!root) {
      return;
    }

    const pattern = new vscode.RelativePattern(root, '**');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.disposables.push(
      this.watcher.onDidCreate(() => this.refresh()),
      this.watcher.onDidDelete(() => this.refresh())
    );
  }

  // coalesce bursts of fs events into a single debounced tree refresh
  private refresh(): void {
    if (this.refreshScheduled) {
      return;
    }
    this.refreshScheduled = true;
    setTimeout(() => {
      this.refreshScheduled = false;
      this.emitter.fire(undefined);
    }, REFRESH_DEBOUNCE_MS);
  }
}
