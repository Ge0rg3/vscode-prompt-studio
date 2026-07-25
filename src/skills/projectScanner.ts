// Finds the workspace subdirectories that own their own .claude/skills
import * as path from 'node:path';

import * as vscode from 'vscode';

import { compareCaseInsensitive } from '../common/utils/compare';
import { isDirectory } from '../common/utils/fs';
import { CLAUDE_DIR, scanSkills, Skill, skillsDirIn } from './skillScanner';

// A workspace subdirectory with skills in its own .claude/skills
export interface ProjectSkills {
  relativeSegments: string[];
  dirPath: string;
  skillsDir: string;
  skills: Skill[];
}

// A directory waiting to be walked, with its segments below the workspace root
interface PendingDir {
  dirPath: string;
  segments: string[];
}

const MAX_SCAN_DEPTH = 5;
const MAX_SCAN_DIRS = 2000;
const SKIPPED_DIRS = new Set(['node_modules']);

// --- helpers ---

// List the subdirectory names worth walking
function listWalkableDirs(entries: [string, vscode.FileType][]): string[] {
  const dirs: string[] = [];
  for (const [name, type] of entries) {
    if (isDirectory(type) && !name.startsWith('.') && !SKIPPED_DIRS.has(name)) {
      dirs.push(name);
    }
  }
  return dirs;
}

// Look for a .claude directory among the entries
function hasClaudeDir(entries: [string, vscode.FileType][]): boolean {
  for (const [name, type] of entries) {
    if (name === CLAUDE_DIR && isDirectory(type)) {
      return true;
    }
  }
  return false;
}

// --- exports ---

// Find every workspace subdirectory with its own skills, sorted by workspace-relative path
export async function scanProjectSkills(workspaceRoot: string): Promise<ProjectSkills[]> {
  // Walk breadth-first so the directory limit goes to the shallow projects first
  const projects: ProjectSkills[] = [];
  const queue: PendingDir[] = [{ dirPath: workspaceRoot, segments: [] }];
  let head = 0;

  while (head < queue.length && head < MAX_SCAN_DIRS) {
    const { dirPath, segments } = queue[head++];

    // Read the directory
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
    } catch {
      continue;
    }

    // Record a sub-project, skipping the workspace root itself
    if (segments.length > 0 && hasClaudeDir(entries)) {
      const skillsDir = skillsDirIn(dirPath);
      const skills = await scanSkills(skillsDir);
      if (skills.length > 0) {
        projects.push({ relativeSegments: segments, dirPath, skillsDir, skills });
      }
    }

    // Queue the children
    if (segments.length < MAX_SCAN_DEPTH) {
      for (const name of listWalkableDirs(entries)) {
        queue.push({ dirPath: path.join(dirPath, name), segments: [...segments, name] });
      }
    }
  }

  // Sort by workspace-relative path
  projects.sort((first, second) =>
    compareCaseInsensitive(first.relativeSegments.join('/'), second.relativeSegments.join('/'))
  );
  return projects;
}
