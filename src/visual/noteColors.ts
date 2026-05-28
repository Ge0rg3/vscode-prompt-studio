// palette keys for note cards, the matching swatch and card styles live in media/visual/canvas.css
export const NOTE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export function isNoteColor(value: string): value is NoteColor {
  return (NOTE_COLORS as readonly string[]).includes(value);
}
