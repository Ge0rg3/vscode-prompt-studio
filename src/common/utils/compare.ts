// Compares names for sorting, ignoring case
export function compareCaseInsensitive(first: string, second: string): number {
  return first.localeCompare(second, undefined, { sensitivity: 'base' });
}
