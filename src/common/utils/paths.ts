// Checks whether one path sits inside another, makes paths relative or absolute, and names a storage folder for a path
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import * as path from 'node:path';

const HASH_LENGTH = 8;

// A path that already points elsewhere, like a url, a data uri, or a windows drive
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// --- helpers ---

// Hash the input to a short hex string
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, HASH_LENGTH);
}

// --- exports ---

// Swap characters that are unsafe in a file or folder name for underscores
export function sanitizeBasename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

// Expand a leading ~ to the home folder, undefined for an empty or relative path
export function resolveTypedPath(input: string): string | undefined {
  const typed = input.trim();
  if (typed === '~' || typed.startsWith('~/') || typed.startsWith(`~${path.sep}`)) {
    return path.resolve(path.join(homedir(), typed.slice(1)));
  }
  return path.isAbsolute(typed) ? path.resolve(typed) : undefined;
}

// Test whether target is the directory itself or sits beneath it
export function isWithin(target: string, dir: string): boolean {
  if (target === dir) {
    return true;
  }
  const rel = path.relative(dir, target);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Resolve a path written inside a file against the folder it sits in, undefined when it points elsewhere
export function resolveRelativePath(dir: string, reference: string): string | undefined {
  if (URL_SCHEME.test(reference) || path.isAbsolute(reference)) {
    return undefined;
  }

  return path.resolve(dir, reference);
}

// Swap in forward slashes so a relative path reads the same on every platform
export function toForwardSlashes(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

// Make target relative to root, '.' for root itself
export function relativeToRoot(root: string, target: string): string {
  return path.relative(root, target) || '.';
}

// Map a path to its own "<basename>-<shorthash>" folder under a storage folder
export function hashedStorageDir(storageDir: string, fsPath: string): string {
  const hash = shortHash(fsPath);
  const base = sanitizeBasename(path.basename(fsPath));
  const folder = base ? `${base}-${hash}` : hash;
  return path.join(storageDir, folder);
}
