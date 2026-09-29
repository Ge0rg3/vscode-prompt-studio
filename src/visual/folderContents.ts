// Turns a folder on disk into positioned cards and a breadcrumb trail
import * as path from 'node:path';

import * as vscode from 'vscode';

import { CardLayoutStore, NotePosition } from '../common/cardLayoutStore';
import { compareCaseInsensitive } from '../common/utils/compare';
import { readTextFile } from '../common/utils/fs';

export type VisualCardKind = 'folder' | 'note';

export interface VisualCard {
  kind: VisualCardKind;
  absPath: string;
  name: string;
  title: string;
  text?: string;
  color?: string;
  x: number;
  y: number;
  z?: number;
  width: number;
  height: number;

  // Left out for a folder that was not read, and empty for an empty folder
  children?: VisualCard[];
}

export interface Breadcrumb {
  path: string;
  name: string;
}

// One folder's cards and its color
export interface VisualLevel {
  cards: VisualCard[];
  folderColor?: string;
}

export interface VisualState extends VisualLevel {
  breadcrumbs: Breadcrumb[];
  parent?: VisualLevel;
}

const NOTE_EXT = '.md';
const HEADING = /^\s*#{1,6}\s+(.+?)\s*$/;

// Nest folder card previews this many layers deep, at least as deep as PREVIEW_DEPTH in
// media/visual/cards/cardBuilders.js
const PREVIEW_DEPTH = 3;

// Fall back to this card size and step the auto-placement grid by it. EMPTY_FOLDER_BOUNDS in
// media/visual/cards/cardBuilders.js copies the size and the margin
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

// Take the title from the first markdown heading, else the filename stem
function deriveTitle(raw: string, fallback: string): string {
  for (const line of raw.split('\n')) {
    const match = HEADING.exec(line);
    if (match) {
      return match[1];
    }
  }
  return fallback;
}

// Compare two cards by title, ignoring case
function byTitle(first: VisualCard, second: VisualCard): number {
  return compareCaseInsensitive(first.title, second.title);
}

// Build a trail from the canvas root down to the folder
function buildBreadcrumbs(root: string, folder: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [
    { path: root, name: path.basename(root) || root }
  ];

  const rel = path.relative(root, folder);
  if (!rel || rel === '.') {
    return crumbs;
  }

  let currentPath = root;
  for (const part of rel.split(path.sep)) {
    currentPath = path.join(currentPath, part);
    crumbs.push({ path: currentPath, name: part });
  }
  return crumbs;
}

// Test whether two card rectangles overlap on both axes
function overlaps(first: CardRect, second: CardRect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

// Find the nth grid slot, filling left to right then top to bottom
function gridSlot(index: number): NotePosition {
  const column = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  return {
    x: GRID_MARGIN + column * (CARD_W + GRID_GAP),
    y: GRID_MARGIN + row * (CARD_H + GRID_GAP)
  };
}

// Find the first grid slot that clears every occupied rectangle
function firstFreeSlot(occupied: CardRect[], width: number, height: number): NotePosition {
  for (let index = 0; ; index++) {
    const slot = gridSlot(index);
    const rect = { x: slot.x, y: slot.y, width, height };
    if (!occupied.some((taken) => overlaps(rect, taken))) {
      return slot;
    }
  }
}

// Take a card's current rectangle
function rectOf(card: VisualCard): CardRect {
  return { x: card.x, y: card.y, width: card.width, height: card.height };
}

// Size and stack every card, then flow the ones with no saved position into free slots
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

// Read a note file into an unplaced card, titled by its first heading
async function readNoteCard(store: CardLayoutStore, absPath: string, name: string): Promise<VisualCard> {
  const raw = await readTextFile(absPath);
  const stem = name.slice(0, -NOTE_EXT.length);
  return {
    kind: 'note',
    absPath,
    name,
    title: deriveTitle(raw, stem),
    text: raw,
    color: store.getColor(absPath),
    x: 0,
    y: 0,
    width: 0,
    height: 0
  };
}

// Read a folder's direct children as placed cards, folders first then notes
async function readEntries(store: CardLayoutStore, folder: string): Promise<VisualCard[]> {
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folder));

  // Turn each folder and markdown file into a card, skipping hidden ones and reading the notes together
  const folders: VisualCard[] = [];
  const noteReads: Promise<VisualCard>[] = [];
  for (const [name, type] of entries) {
    if (name.startsWith('.')) {
      continue;
    }
    const absPath = path.join(folder, name);
    if (type === vscode.FileType.Directory) {
      folders.push({
        kind: 'folder',
        absPath,
        name,
        title: name,
        color: store.getColor(absPath),
        x: 0,
        y: 0,
        width: 0,
        height: 0
      });
    } else if (type === vscode.FileType.File && name.toLowerCase().endsWith(NOTE_EXT)) {
      noteReads.push(readNoteCard(store, absPath, name));
    }
  }
  const notes = await Promise.all(noteReads);

  // Sort each group by title and lay the cards out
  folders.sort(byTitle);
  notes.sort(byTitle);
  const cards = [...folders, ...notes];
  placeCards(store, cards);
  return cards;
}

// Fill each folder card's children for its mini preview, recursing `layers` folders deep
async function attachPreviews(
  store: CardLayoutStore,
  cards: VisualCard[],
  layers: number
): Promise<void> {
  if (layers < 1) {
    return;
  }

  // Read the subfolders together
  const folderReads: Promise<void>[] = [];
  for (const card of cards) {
    if (card.kind === 'folder') {
      folderReads.push(attachChildren(store, card, layers));
    }
  }
  await Promise.all(folderReads);
}

// Fill one folder card's children, and theirs below them `layers - 1` folders deep
async function attachChildren(store: CardLayoutStore, card: VisualCard, layers: number): Promise<void> {
  card.children = await readEntries(store, card.absPath);
  await attachPreviews(store, card.children, layers - 1);
}

// Read a folder's cards with nested previews, leaving out the subtree of the card at skipPath
async function readLevel(store: CardLayoutStore, folder: string, skipPath?: string): Promise<VisualLevel> {
  const cards = await readEntries(store, folder);
  await attachPreviews(store, cards.filter((card) => card.absPath !== skipPath), PREVIEW_DEPTH);
  return { cards, folderColor: store.getColor(folder) };
}

// Read the parent folder's level, skipping the open folder's subtree since its own read covers it
async function readParentLevel(
  store: CardLayoutStore,
  parentFolder: string,
  openFolder: string
): Promise<VisualLevel | undefined> {
  try {
    return await readLevel(store, parentFolder, openFolder);
  } catch {
    // Leave the level out when a folder in it cannot be read, since the open folder still shows without it
    return undefined;
  }
}

// --- exports ---

// Read one folder's cards with nested previews and its breadcrumb trail, plus the parent's cards when asked for
export async function readFolder(
  store: CardLayoutStore,
  root: string,
  folder: string,
  shouldIncludeParent: boolean
): Promise<VisualState> {
  const breadcrumbs = buildBreadcrumbs(root, folder);
  const parentCrumb = breadcrumbs.at(-2);

  // Read the folder and its parent together, leaving the parent out at the root or when it was not asked for
  const parentRead = shouldIncludeParent && parentCrumb ? readParentLevel(store, parentCrumb.path, folder) : undefined;
  const [level, parentLevel] = await Promise.all([readLevel(store, folder), parentRead]);
  return { breadcrumbs, ...level, parent: parentLevel };
}
