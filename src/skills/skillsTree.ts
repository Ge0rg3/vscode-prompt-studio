import * as path from 'node:path';

import * as vscode from 'vscode';

import { compareCaseInsensitive } from '../common/utils/compare';
import { SkillTreeNode } from './skillNode';
import { scanSkills } from './skillScanner';

// --- helpers ---

// case-insensitive by display name
function compareByName(first: SkillTreeNode, second: SkillTreeNode): number {
  return compareCaseInsensitive(first.name, second.name);
}

// a directory's child file and folder nodes
async function readEntries(dir: string): Promise<SkillTreeNode[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
  } catch {
    return [];
  }

  const folders: SkillTreeNode[] = [];
  const files: SkillTreeNode[] = [];
  for (const [name, type] of entries) {
    if (name.startsWith('.')) {
      continue;
    }
    const absPath = path.join(dir, name);
    if (type === vscode.FileType.Directory) {
      folders.push({ kind: 'folder', name, absPath, children: await readEntries(absPath) });
    } else if (type === vscode.FileType.File) {
      files.push({ kind: 'file', name, absPath });
    }
  }

  folders.sort(compareByName);
  files.sort(compareByName);
  return [...folders, ...files];
}

// --- exports ---

// the skill rows for the webview, each carrying its folder contents
export async function buildSkillsTree(): Promise<SkillTreeNode[]> {
  const skills = await scanSkills();

  const nodes: SkillTreeNode[] = [];
  for (const skill of skills) {
    nodes.push({
      kind: 'skill',
      name: skill.name,
      absPath: skill.dirPath,
      skill: { name: skill.name, skillFile: skill.skillFile, description: skill.description },
      children: await readEntries(skill.dirPath)
    });
  }
  return nodes;
}
