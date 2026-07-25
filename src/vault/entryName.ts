// Checks the names typed for new and renamed entries and keeps notes ending in .md
export const NOTE_EXT = '.md';

const INVALID_NAME = /[\\/:*?"<>|]/;

// Reject an empty name, a leading dot, and characters a filename cannot hold
export function validateEntryName(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return 'A name is required';
  }
  if (trimmed.startsWith('.')) {
    return 'Name must not start with a dot';
  }
  if (INVALID_NAME.test(trimmed)) {
    return 'Name must not contain / \\ : * ? " < > |';
  }
  return undefined;
}

// Add .md when the typed name does not already end with it
export function ensureNoteExt(name: string): string {
  return name.toLowerCase().endsWith(NOTE_EXT) ? name : `${name}${NOTE_EXT}`;
}
