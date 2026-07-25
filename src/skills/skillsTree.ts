// Builds the rows the skills sidebar renders, sub-projects and the skills under them
import * as path from 'node:path';

import * as vscode from 'vscode';

import { compareCaseInsensitive } from '../common/utils/compare';
import { VaultConfig } from '../common/vaultConfig';
import { ProjectSkills, scanProjectSkills } from './projectScanner';
import { SkillTreeNode } from './skillNode';
import { scanSkills, Skill, skillsRoot } from './skillScanner';
import { SkillsConfigs } from './skillsConfigs';

// A workspace directory that holds a nested skills root, or leads down to one
interface ProjectDir {
  name: string;
  absPath: string;
  project?: ProjectSkills;
  children: Map<string, ProjectDir>;
}

// --- helpers ---

// Compare two rows by display name, ignoring case
function compareByName(first: SkillTreeNode, second: SkillTreeNode): number {
  return compareCaseInsensitive(first.name, second.name);
}

// Read a directory tree into file and folder rows, folders first
async function readEntries(dir: string, config: VaultConfig): Promise<SkillTreeNode[]> {
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
      folders.push({
        kind: 'folder',
        name,
        absPath,
        color: config.getColor(absPath),
        children: await readEntries(absPath, config)
      });
    } else if (type === vscode.FileType.File) {
      files.push({ kind: 'file', name, absPath, color: config.getColor(absPath) });
    }
  }

  folders.sort(compareByName);
  files.sort(compareByName);
  return [...folders, ...files];
}

// Build a skill row carrying its folder contents
async function buildSkillNode(skill: Skill, config: VaultConfig): Promise<SkillTreeNode> {
  return {
    kind: 'skill',
    name: skill.name,
    absPath: skill.dirPath,
    skill: { name: skill.name, skillFile: skill.skillFile, description: skill.description },
    color: config.getColor(skill.dirPath),
    children: await readEntries(skill.dirPath, config)
  };
}

// Nest each project under its path segments below the workspace root
function buildProjectDirTree(
  workspaceRoot: string,
  projects: ProjectSkills[]
): Map<string, ProjectDir> {
  const rootDirs = new Map<string, ProjectDir>();
  for (const project of projects) {
    let siblings = rootDirs;
    let dirPath = workspaceRoot;
    let dir: ProjectDir | undefined;
    for (const segment of project.relativeSegments) {
      dirPath = path.join(dirPath, segment);
      dir = siblings.get(segment);
      if (!dir) {
        dir = { name: segment, absPath: dirPath, children: new Map() };
        siblings.set(segment, dir);
      }
      siblings = dir.children;
    }
    if (dir) {
      dir.project = project;
    }
  }
  return rootDirs;
}

// Squash a chain of single-child dirs into one row, the way the explorer does
function compressDir(dir: ProjectDir): ProjectDir {
  let mergedDir = dir;
  while (!mergedDir.project && mergedDir.children.size === 1) {
    const child = [...mergedDir.children.values()][0];
    mergedDir = { ...child, name: `${mergedDir.name}/${child.name}` };
  }
  return mergedDir;
}

// List the child dirs by name, squashed where a dir holds a single child
function listChildDirs(children: Map<string, ProjectDir>): ProjectDir[] {
  const sortedChildren = [...children.values()];
  sortedChildren.sort((first, second) => compareCaseInsensitive(first.name, second.name));

  const dirs: ProjectDir[] = [];
  for (const child of sortedChildren) {
    dirs.push(compressDir(child));
  }
  return dirs;
}

// Build a project row, nested project dirs first, then the dir's own skills
async function buildProjectNode(dir: ProjectDir, configs: SkillsConfigs): Promise<SkillTreeNode> {
  const children: SkillTreeNode[] = [];
  for (const child of listChildDirs(dir.children)) {
    children.push(await buildProjectNode(child, configs));
  }

  if (dir.project) {
    const config = configs.configFor(dir.project.skillsDir);
    if (config) {
      for (const skill of dir.project.skills) {
        children.push(await buildSkillNode(skill, config));
      }
    }
  }

  return {
    kind: 'project',
    name: dir.name,
    absPath: dir.absPath,
    skillsDir: dir.project?.skillsDir,
    children
  };
}

// --- exports ---

// Build the tree with sub-project dirs on top and the workspace's own skills below
export async function buildSkillsTree(configs: SkillsConfigs): Promise<SkillTreeNode[]> {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    return [];
  }

  // Add the sub-project rows first
  const nodes: SkillTreeNode[] = [];
  const projects = await scanProjectSkills(workspace.uri.fsPath);
  for (const dir of listChildDirs(buildProjectDirTree(workspace.uri.fsPath, projects))) {
    nodes.push(await buildProjectNode(dir, configs));
  }

  // Then add the workspace's own skills
  const root = skillsRoot();
  const config = root ? configs.configFor(root) : undefined;
  if (root && config) {
    for (const skill of await scanSkills(root)) {
      nodes.push(await buildSkillNode(skill, config));
    }
  }

  return nodes;
}
