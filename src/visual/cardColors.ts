// palette keys for note and folder cards, the matching fill and accent live in media/common/palette.css
export const CARD_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;

export type CardColor = (typeof CARD_COLORS)[number];

export function isCardColor(value: string): value is CardColor {
  return (CARD_COLORS as readonly string[]).includes(value);
}
