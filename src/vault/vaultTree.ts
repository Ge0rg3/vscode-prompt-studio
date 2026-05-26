import * as path from 'node:path';

import * as vscode from 'vscode';

export type VaultNodeKind = 'folder' | 'note';

export interface VaultNode {
  kind: VaultNodeKind;
  absPath: string;
  name: string;
  children?: VaultNode[];
}

const NOTE_EXT = '.md';

// read one folder, recurse into subfolders, skip dotfiles and non-markdown files
async function readDir(dir: string): Promise<VaultNode[]> {
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));

  const nodes: VaultNode[] = [];
  for (const [name, type] of entries) {
    if (name.startsWith('.')) {
      continue;
    }
    const abs = path.join(dir, name);
    if (type === vscode.FileType.Directory) {
      nodes.push({ kind: 'folder', absPath: abs, name, children: await readDir(abs) });
    } else if (type === vscode.FileType.File && name.toLowerCase().endsWith(NOTE_EXT)) {
      nodes.push({ kind: 'note', absPath: abs, name });
    }
  }

  sortNodes(nodes);
  return nodes;
}

// folders before notes, case-insensitive alphabetical within each group
function sortNodes(nodes: VaultNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'folder' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

// --- exports ---

export async function readVaultTree(root: string): Promise<VaultNode> {
  return {
    kind: 'folder',
    absPath: root,
    name: path.basename(root) || root,
    children: await readDir(root)
  };
}
