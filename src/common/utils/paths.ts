// Checks whether one path sits inside another, makes paths relative, and names per-project storage folders
import { createHash } from 'node:crypto';
import * as path from 'node:path';

const HASH_LENGTH = 8;

// --- helpers ---

// Hash the input to a short hex string
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, HASH_LENGTH);
}

// Swap characters that are unsafe in a folder name for underscores
function sanitizeBasename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

// --- exports ---

// Test whether target is the directory itself or sits beneath it
export function isWithin(target: string, dir: string): boolean {
  if (target === dir) {
    return true;
  }
  const rel = path.relative(dir, target);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Make target relative to root, '.' for root itself
export function relativeToRoot(root: string, target: string): string {
  return path.relative(root, target) || '.';
}

// Map a workspace path to a "<basename>-<shorthash>" folder under the extension's global storage
export function projectStorageDir(globalStorageDir: string, workspaceFsPath: string): string {
  const hash = shortHash(workspaceFsPath);
  const base = sanitizeBasename(path.basename(workspaceFsPath));
  const folder = base ? `${base}-${hash}` : hash;
  return path.join(globalStorageDir, folder);
}
