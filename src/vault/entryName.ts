export const NOTE_EXT = '.md';

const INVALID_NAME = /[\\/:*?"<>|]/;

// reject empties, path separators, and OS-reserved characters
export function validateEntryName(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return 'A name is required';
  }
  if (INVALID_NAME.test(trimmed)) {
    return 'Name must not contain / \\ : * ? " < > |';
  }
  return undefined;
}

// append .md if the user did not type the extension
export function ensureNoteExt(name: string): string {
  return name.toLowerCase().endsWith(NOTE_EXT) ? name : `${name}${NOTE_EXT}`;
}
