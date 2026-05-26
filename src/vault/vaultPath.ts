import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';

const HASH_LENGTH = 8;

// first 8 hex chars of a sha256 over the workspace path, stable per workspace
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, HASH_LENGTH);
}

// strip anything that is not safe in a folder name on any common filesystem
function sanitizeBasename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

// --- exports ---

// map a workspace path into a "<basename>-<shorthash>" folder under the extension's global storage
export function projectStorageDir(globalStorageDir: string, workspaceFsPath: string): string {
  const hash = shortHash(workspaceFsPath);
  const base = sanitizeBasename(path.basename(workspaceFsPath));
  const folder = base ? `${base}-${hash}` : hash;
  return path.join(globalStorageDir, folder);
}

// create the directory if missing, return its path either way
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
