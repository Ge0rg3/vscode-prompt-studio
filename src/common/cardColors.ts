import * as vscode from 'vscode';

import { CardLayoutStore } from './cardLayoutStore';

// palette keys for any colored entry, the matching fill and accent live in media/common/palette.css
export const CARD_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;

export type CardColor = (typeof CARD_COLORS)[number];

// an unsaved color preview
export interface ColorPreview {
  path: string;
  color: string | null;
}

export function isCardColor(candidate: string): candidate is CardColor {
  return (CARD_COLORS as readonly string[]).includes(candidate);
}

// apply a setColor webview message to a store
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

// post a color preview to a webview
export function postColorPreview(webview: vscode.Webview | undefined, preview: ColorPreview): void {
  void webview?.postMessage({ type: 'previewColor', path: preview.path, color: preview.color });
}
