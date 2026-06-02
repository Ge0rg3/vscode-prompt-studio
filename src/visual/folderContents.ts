import * as path from 'node:path';

import * as vscode from 'vscode';

import { NotePosition, VaultConfig } from '../common/vaultConfig';

export type VisualCardKind = 'folder' | 'note';

export interface VisualCard {
  kind: VisualCardKind;
  absPath: string;
  name: string;
  title: string;
  preview?: string;
  color?: string;
  x: number;
  y: number;
  z?: number;
  width: number;
  height: number;
  children?: VisualCard[];
}

export interface Breadcrumb {
  path: string;
  name: string;
}

export interface VisualState {
  breadcrumbs: Breadcrumb[];
  cards: VisualCard[];
  folderColor?: string;
}

const NOTE_EXT = '.md';
const HEADING = /^\s*#{1,6}\s+(.+?)\s*$/;

// how many nested folder layers a folder card previews before falling back to a plain icon
const PREVIEW_DEPTH = 3;

// default card size, also the auto-placement grid step
const CARD_W = 240;
const CARD_H = 170;
const GRID_MARGIN = 24;
const GRID_GAP = 20;
const GRID_COLUMNS = 4;

// --- helpers ---

// read a file as utf-8 text
async function readText(absPath: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
  return new TextDecoder('utf-8').decode(bytes);
}

// first markdown heading in the body, else the filename stem
function deriveTitle(raw: string, fallback: string): string {
  for (const line of raw.split('\n')) {
    const match = HEADING.exec(line);
    if (match) {
      return match[1];
    }
  }
  return fallback;
}

// the note body with the leading heading dropped
function previewOf(raw: string): string {
  return raw.replace(/^\s*#{1,6}\s+[^\n]*\n?/, '').trim();
}

// alphabetical by title, case-insensitive
function byTitle(first: VisualCard, second: VisualCard): number {
  return first.title.localeCompare(second.title, undefined, { sensitivity: 'base' });
}

// a trail from the vault root down to the folder
function buildBreadcrumbs(vaultRoot: string, folder: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [
    { path: vaultRoot, name: path.basename(vaultRoot) || vaultRoot }
  ];

  const rel = path.relative(vaultRoot, folder);
  if (!rel || rel === '.') {
    return crumbs;
  }

  let accum = vaultRoot;
  for (const part of rel.split(path.sep)) {
    accum = path.join(accum, part);
    crumbs.push({ path: accum, name: part });
  }
  return crumbs;
}

// grid slot for a card with no saved position, by its index in the ordered list
function autoPosition(index: number): NotePosition {
  const column = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  return {
    x: GRID_MARGIN + column * (CARD_W + GRID_GAP),
    y: GRID_MARGIN + row * (CARD_H + GRID_GAP)
  };
}

// give each card its saved position, size, and stacking order
function placeCards(config: VaultConfig, cards: VisualCard[]): void {
  for (let i = 0; i < cards.length; i++) {
    const position = config.getPosition(cards[i].absPath) ?? autoPosition(i);
    cards[i].x = position.x;
    cards[i].y = position.y;
    cards[i].z = config.getZ(cards[i].absPath);

    const size = config.getSize(cards[i].absPath) ?? { width: CARD_W, height: CARD_H };
    cards[i].width = size.width;
    cards[i].height = size.height;
  }
}

// a folder's direct children as placed cards, folders first then notes
async function readEntries(config: VaultConfig, folder: string): Promise<VisualCard[]> {
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folder));

  const folders: VisualCard[] = [];
  const notes: VisualCard[] = [];
  for (const [name, type] of entries) {
    if (name.startsWith('.')) {
      continue;
    }
    const abs = path.join(folder, name);
    if (type === vscode.FileType.Directory) {
      folders.push({
        kind: 'folder',
        absPath: abs,
        name,
        title: name,
        color: config.getColor(abs),
        x: 0,
        y: 0,
        width: 0,
        height: 0
      });
    } else if (type === vscode.FileType.File && name.toLowerCase().endsWith(NOTE_EXT)) {
      const raw = await readText(abs);
      const stem = name.slice(0, -NOTE_EXT.length);
      notes.push({
        kind: 'note',
        absPath: abs,
        name,
        title: deriveTitle(raw, stem),
        preview: previewOf(raw),
        color: config.getColor(abs),
        x: 0,
        y: 0,
        width: 0,
        height: 0
      });
    }
  }

  folders.sort(byTitle);
  notes.sort(byTitle);
  const cards = [...folders, ...notes];
  placeCards(config, cards);
  return cards;
}

// fill each folder card's children for the mini preview, recursing `layers` folders deep
async function attachPreviews(
  config: VaultConfig,
  cards: VisualCard[],
  layers: number
): Promise<void> {
  if (layers < 1) {
    return;
  }

  for (const card of cards) {
    if (card.kind === 'folder') {
      card.children = await readEntries(config, card.absPath);
      await attachPreviews(config, card.children, layers - 1);
    }
  }
}

// --- exports ---

// a folder's cards plus a breadcrumb trail, each folder card carrying a nested mini preview of its contents
export async function readFolder(
  config: VaultConfig,
  vaultRoot: string,
  folder: string
): Promise<VisualState> {
  const cards = await readEntries(config, folder);
  await attachPreviews(config, cards, PREVIEW_DEPTH);

  return {
    breadcrumbs: buildBreadcrumbs(vaultRoot, folder),
    cards,
    folderColor: config.getColor(folder)
  };
}
