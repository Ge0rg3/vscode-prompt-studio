import * as path from 'node:path';

import * as vscode from 'vscode';

import { VaultNode } from '../common/vaultNode';

export interface TreeNode extends VaultNode {
  children?: TreeNode[];
}

export interface TreeState {
  root: string;
  children: TreeNode[];
}

const NOTE_EXT = '.md';

// read a directory recursively, drop dotfiles and non-markdown, folders first then alpha
export async function readTree(dir: string): Promise<TreeNode[]> {
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));

  const nodes: TreeNode[] = [];
  for (const [name, type] of entries) {
    if (name.startsWith('.')) {
      continue;
    }
    const abs = path.join(dir, name);
    if (type === vscode.FileType.Directory) {
      nodes.push({ kind: 'folder', absPath: abs, name, children: await readTree(abs) });
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
