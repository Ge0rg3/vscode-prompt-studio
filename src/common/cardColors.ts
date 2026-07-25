// The shared card color palette and the helpers that handle a webview's color messages
import * as vscode from 'vscode';

import { CardLayoutStore } from './cardLayoutStore';

// Palette keys for a colored entry, the fill and accent for each live in media/common/palette.css
export const CARD_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;

export type CardColor = (typeof CARD_COLORS)[number];

// A color to show while a swatch is hovered, before anything is saved
export interface ColorPreview {
  path: string;
  color: string | null;
}

export function isCardColor(candidate: string): candidate is CardColor {
  return (CARD_COLORS as readonly string[]).includes(candidate);
}

// Apply a color message from a webview, null clears the color
export function applyColorMessage(
  store: CardLayoutStore,
  message: { path: string; color: string | null }
): void {
  if (message.color === null) {
    store.setColor(message.path, undefined);
  } else if (isCardColor(message.color)) {
    store.setColor(message.path, message.color);
  }
}

export function postColorPreview(webview: vscode.Webview | undefined, preview: ColorPreview): void {
  void webview?.postMessage({ type: 'previewColor', path: preview.path, color: preview.color });
}
