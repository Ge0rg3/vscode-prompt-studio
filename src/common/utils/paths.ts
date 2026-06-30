import { createHash } from 'node:crypto';
import * as path from 'node:path';

const HASH_LENGTH = 8;

// --- helpers ---

// first 8 hex chars of a sha256 of the input
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, HASH_LENGTH);
}

// strip characters that are unsafe in a folder name
function sanitizeBasename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

// --- exports ---

// true when target is the directory itself or nested beneath it
export function isWithin(target: string, dir: string): boolean {
  if (target === dir) {
    return true;
  }
  const rel = path.relative(dir, target);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// target made relative to root, '.' for root itself
export function relativeToRoot(root: string, target: string): string {
  return path.relative(root, target) || '.';
}

// map a workspace path into a "<basename>-<shorthash>" folder under the extension's global storage
export function projectStorageDir(globalStorageDir: string, workspaceFsPath: string): string {
  const hash = shortHash(workspaceFsPath);
  const base = sanitizeBasename(path.basename(workspaceFsPath));
  const folder = base ? `${base}-${hash}` : hash;
  return path.join(globalStorageDir, folder);
}
