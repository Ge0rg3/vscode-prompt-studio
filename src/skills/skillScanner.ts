// Reads .claude/skills off disk and pulls the name and description out of each SKILL.md
import { homedir } from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';
import { parse } from 'yaml';

import { compareCaseInsensitive } from '../common/utils/compare';
import { isDirectory } from '../common/utils/fs';

export interface Skill {
  name: string;
  description: string | undefined;
  dirPath: string;
  skillFile: string;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

export const SKILL_FILE = 'SKILL.md';
export const CLAUDE_DIR = '.claude';
const SKILLS_DIR = 'skills';
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

// --- helpers ---

// Pull name and description out of a SKILL.md's leading YAML frontmatter
function parseFrontmatter(text: string): SkillFrontmatter {
  const match = FRONTMATTER.exec(text);
  if (!match) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = parse(match[1]);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  const fields = parsed as Record<string, unknown>;
  const name = typeof fields.name === 'string' ? fields.name : undefined;
  const description = typeof fields.description === 'string' ? fields.description : undefined;
  return { name, description };
}

// Read one skill directory, undefined when it has no SKILL.md
async function readSkill(dirPath: string, dirName: string): Promise<Skill | undefined> {
  const skillFile = path.join(dirPath, SKILL_FILE);
  let raw: Uint8Array;
  try {
    raw = await vscode.workspace.fs.readFile(vscode.Uri.file(skillFile));
  } catch {
    return undefined;
  }

  const { name, description } = parseFrontmatter(new TextDecoder('utf-8').decode(raw));
  return {
    name: name?.trim() || dirName,
    description: description?.trim() || undefined,
    dirPath,
    skillFile
  };
}

// --- exports ---

// Build the .claude/skills path inside a project directory
export function skillsDirIn(dirPath: string): string {
  return path.join(dirPath, CLAUDE_DIR, SKILLS_DIR);
}

// Find the user's own .claude/skills directory, the one Claude Code reads in every project
export function globalSkillsRoot(): string {
  return skillsDirIn(homedir());
}

// Walk up from a path to the .claude/skills folder it lives in
export function owningSkillsDir(absPath: string): string | undefined {
  let dir = absPath;
  while (true) {
    if (path.basename(dir) === SKILLS_DIR && path.basename(path.dirname(dir)) === CLAUDE_DIR) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

// Read every skill directly under a .claude/skills root, sorted by display name
export async function scanSkills(root: string): Promise<Skill[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(root));
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const [dirName, type] of entries) {
    if (!isDirectory(type) || dirName.startsWith('.')) {
      continue;
    }
    const skill = await readSkill(path.join(root, dirName), dirName);
    if (skill) {
      skills.push(skill);
    }
  }

  skills.sort((first, second) => compareCaseInsensitive(first.name, second.name));
  return skills;
}
