import * as path from 'node:path';

// true when target is the directory itself or nested beneath it
export function isWithin(target: string, dir: string): boolean {
  if (target === dir) {
    return true;
  }
  const rel = path.relative(dir, target);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}
