import * as path from 'node:path';

import * as vscode from 'vscode';

import { CardLayoutStore, NotePosition } from '../common/cardLayoutStore';
import { compareCaseInsensitive } from '../common/utils/compare';

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

interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  return compareCaseInsensitive(first.title, second.title);
}

// a trail from the canvas root down to the folder
function buildBreadcrumbs(root: string, folder: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [
    { path: root, name: path.basename(root) || root }
  ];

  const rel = path.relative(root, folder);
  if (!rel || rel === '.') {
    return crumbs;
  }

  let accum = root;
  for (const part of rel.split(path.sep)) {
    accum = path.join(accum, part);
    crumbs.push({ path: accum, name: part });
  }
  return crumbs;
}

// two card rectangles overlap on both axes
function overlaps(first: CardRect, second: CardRect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

// the nth grid slot, filling left to right then top to bottom
function gridSlot(index: number): NotePosition {
  const column = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  return {
    x: GRID_MARGIN + column * (CARD_W + GRID_GAP),
    y: GRID_MARGIN + row * (CARD_H + GRID_GAP)
  };
}

// the first grid slot whose card rectangle clears every occupied rectangle
function firstFreeSlot(occupied: CardRect[], width: number, height: number): NotePosition {
  for (let index = 0; ; index++) {
    const slot = gridSlot(index);
    const rect = { x: slot.x, y: slot.y, width, height };
    if (!occupied.some((taken) => overlaps(rect, taken))) {
      return slot;
    }
  }
}

// a card's current rectangle
function rectOf(card: VisualCard): CardRect {
  return { x: card.x, y: card.y, width: card.width, height: card.height };
}

// size and stack every card, keep saved positions, flow the rest into free slots
function placeCards(store: CardLayoutStore, cards: VisualCard[]): void {
  const occupied: CardRect[] = [];
  const unplaced: VisualCard[] = [];
  for (const card of cards) {
    const size = store.getSize(card.absPath) ?? { width: CARD_W, height: CARD_H };
    card.width = size.width;
    card.height = size.height;
    card.z = store.getZ(card.absPath);

    const saved = store.getPosition(card.absPath);
    if (saved) {
      card.x = saved.x;
      card.y = saved.y;
      occupied.push(rectOf(card));
    } else {
      unplaced.push(card);
    }
  }

  for (const card of unplaced) {
    const slot = firstFreeSlot(occupied, card.width, card.height);
    card.x = slot.x;
    card.y = slot.y;
    occupied.push(rectOf(card));
  }
}

// a folder's direct children as placed cards, folders first then notes
async function readEntries(store: CardLayoutStore, folder: string): Promise<VisualCard[]> {
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
        color: store.getColor(abs),
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
        color: store.getColor(abs),
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
  placeCards(store, cards);
  return cards;
}

// fill each folder card's children for the mini preview, recursing `layers` folders deep
async function attachPreviews(
  store: CardLayoutStore,
  cards: VisualCard[],
  layers: number
): Promise<void> {
  if (layers < 1) {
    return;
  }

  for (const card of cards) {
    if (card.kind === 'folder') {
      card.children = await readEntries(store, card.absPath);
      await attachPreviews(store, card.children, layers - 1);
    }
  }
}

// --- exports ---

// a folder's cards plus a breadcrumb trail, each folder card carrying a nested mini preview of its contents
export async function readFolder(
  store: CardLayoutStore,
  root: string,
  folder: string
): Promise<VisualState> {
  const cards = await readEntries(store, folder);
  await attachPreviews(store, cards, PREVIEW_DEPTH);

  return {
    breadcrumbs: buildBreadcrumbs(root, folder),
    cards,
    folderColor: store.getColor(folder)
  };
}
