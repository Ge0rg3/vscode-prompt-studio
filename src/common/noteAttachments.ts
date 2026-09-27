// Stores the files a note keeps beside it and drops the ones no note there names
import * as path from 'node:path';

import * as vscode from 'vscode';

import { readTextFile } from './utils/fs';
import { isWithin, resolveRelativePath, sanitizeBasename } from './utils/paths';

// A stored file, as the note points at it and as it sits on disk
export interface StoredAttachment {
  reference: string;
  absPath: string;
}

// A note on its way to Claude, the words alone and the files to attach beside them
export interface NoteToSend {
  text: string;
  attachments: string[];
}

// The hidden folder beside a note that holds its files
const ATTACHMENTS_DIR = '.attachments';

const NOTE_EXT = '.md';

// A whole markdown image or link with the path split out, in step with the twin in webview/template/attachments.ts
const ATTACHMENT_REFERENCE = /!?\[[^\]\n]*\]\([ \t]*<?([^)>\s]+)[^)\n]*\)/g;

// The image types the editor can draw a thumbnail of, in step with the twin in webview/template/attachments.ts
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

// The image types a paste arrives as, and the extension each one is stored under
const PASTED_IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp']
]);

// --- helpers ---

// List a folder, empty when it is not there
async function readEntries(dir: string): Promise<[string, vscode.FileType][]> {
  try {
    return await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
  } catch {
    return [];
  }
}

// Test whether a filename is a note, going on the extension
function isNote(absPath: string): boolean {
  return absPath.toLowerCase().endsWith(NOTE_EXT);
}

// Test whether a path is a file on disk, so a folder never passes for a stored one
async function isFile(absPath: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

// Take the files an attachments folder holds
async function attachmentFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const [name, type] of await readEntries(dir)) {
    if (type === vscode.FileType.File) {
      files.push(path.join(dir, name));
    }
  }

  return files;
}

// Read a note, undefined when it cannot be read
async function readNote(notePath: string): Promise<string | undefined> {
  try {
    return await readTextFile(notePath);
  } catch {
    return undefined;
  }
}

// Read every note in a folder into one lowercased run of text
async function readNotesText(dir: string, skipNote?: string): Promise<string | undefined> {
  const texts: string[] = [];

  for (const [name, type] of await readEntries(dir)) {
    if (type !== vscode.FileType.File || !isNote(name) || name === skipNote) {
      continue;
    }

    // One note nobody can read leaves every file in place, since guessing would delete a used one
    const text = await readNote(path.join(dir, name));
    if (text === undefined) {
      return undefined;
    }
    texts.push(text.toLowerCase());
  }

  return texts.join('\n');
}

// Test whether text names a stored file, going on the filename so any style of link counts
function isNamedIn(lowercaseText: string, file: string): boolean {
  return lowercaseText.includes(path.basename(file).toLowerCase());
}

// Take the paths a note's markdown points at
function attachmentReferences(text: string): string[] {
  const references: string[] = [];
  for (const match of text.matchAll(ATTACHMENT_REFERENCE)) {
    references.push(match[1]);
  }

  return references;
}

// Name the file the bytes land in, falling back to the mime type when a screenshot arrives without one
function attachmentName(fileName: string, mime?: string): string {
  const cleaned = sanitizeBasename(path.basename(fileName));
  const ownExtension = path.extname(cleaned);
  const extension = ownExtension || (mime && PASTED_IMAGE_EXTENSIONS.get(mime)) || '';

  // A stem of nothing but dots would step back out of the attachments folder
  const stem = cleaned.slice(0, cleaned.length - ownExtension.length);
  const safeStem = /^\.*$/.test(stem) ? '' : stem;

  return `${safeStem || 'pasted-image'}${extension}`;
}

// Find a free name in the attachments folder, numbering a clash
async function freeName(dir: string, name: string): Promise<string> {
  const taken = new Set<string>();
  for (const [existing] of await readEntries(dir)) {
    taken.add(existing.toLowerCase());
  }

  if (!taken.has(name.toLowerCase())) {
    return name;
  }

  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let n = 1; ; n++) {
    const candidate = `${stem}-${n}${extension}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

// Lift the named files out of the text, tidying up the space they leave behind
function withoutAttachments(text: string, references: ReadonlySet<string>): string {
  let out = '';
  let at = 0;

  for (const match of text.matchAll(ATTACHMENT_REFERENCE)) {
    if (!references.has(match[1])) {
      continue;
    }

    const start = match.index ?? 0;
    out += text.slice(at, start);
    at = start + match[0].length;
  }

  return (out + text.slice(at)).replace(/[ \t]+$/gm, '').trimEnd();
}

// Point a note's stored references at the name a file ended up under, leaving the prose alone
function repointReference(text: string, name: string, replacement: string): string {
  const pointer = `${ATTACHMENTS_DIR}/${name}`;
  let out = '';
  let at = 0;

  for (const match of text.matchAll(ATTACHMENT_REFERENCE)) {
    const reference = match[1];
    if (reference.replace(/^\.\//, '') !== pointer) {
      continue;
    }

    // Swap the path alone, the label and the prose around it are the writer's
    const start = (match.index ?? 0) + match[0].lastIndexOf(reference);
    out += text.slice(at, start) + reference.slice(0, reference.length - name.length) + replacement;
    at = start + reference.length;
  }

  return out + text.slice(at);
}

// Bring one file over, copied when a note left behind still names it and moved when none does
async function carryOneAttachment(file: string, destination: string, leftBehindText: string): Promise<string> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(destination));

  const availableName = await freeName(destination, path.basename(file));
  const target = vscode.Uri.file(path.join(destination, availableName));
  if (isNamedIn(leftBehindText, file)) {
    await vscode.workspace.fs.copy(vscode.Uri.file(file), target);
  } else {
    await vscode.workspace.fs.rename(vscode.Uri.file(file), target);
  }

  return availableName;
}

// Drop the attachments folder once nothing is left in it
async function removeWhenEmpty(dir: string): Promise<void> {
  // Read it straight, so a folder that cannot be listed is never taken for an empty one
  try {
    if ((await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir))).length > 0) {
      return;
    }
  } catch {
    return;
  }

  await vscode.workspace.fs.delete(vscode.Uri.file(dir), { recursive: true });
}

// --- exports ---

// Name the folder a note's files sit in
export function attachmentsIn(noteDir: string): string {
  return path.join(noteDir, ATTACHMENTS_DIR);
}

// Test whether a file is an image, going on the extension since the bytes are never read
export function isImageAttachment(absPath: string): boolean {
  return IMAGE_EXTENSIONS.test(absPath);
}

// Resolve a path the editor sent, refusing anything outside the note's own attachments folder
export function resolveAttachment(notePath: string, reference: string): string | undefined {
  const noteDir = path.dirname(notePath);
  const target = resolveRelativePath(noteDir, reference);
  if (!target || !isWithin(target, attachmentsIn(noteDir))) {
    return undefined;
  }

  return target;
}

// List the files in the note's attachments folder that its text names, whether or not they are on disk
export function listNamedAttachments(notePath: string, text: string): string[] {
  const named = new Set<string>();
  for (const reference of attachmentReferences(text)) {
    const target = resolveAttachment(notePath, reference);
    if (target) {
      named.add(target);
    }
  }

  return [...named];
}

// Pick the spot an incoming file lands in beside the note
export async function reserveAttachment(
  notePath: string,
  fileName: string,
  mime?: string
): Promise<StoredAttachment> {
  const dir = attachmentsIn(path.dirname(notePath));
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));

  const name = await freeName(dir, attachmentName(fileName, mime));
  return { reference: `${ATTACHMENTS_DIR}/${name}`, absPath: path.join(dir, name) };
}

// Copy a file the user picked into the note's folder, so its bytes never travel through the editor
export async function copyIntoAttachments(notePath: string, sourcePath: string): Promise<StoredAttachment> {
  const stored = await reserveAttachment(notePath, path.basename(sourcePath));
  await vscode.workspace.fs.copy(vscode.Uri.file(sourcePath), vscode.Uri.file(stored.absPath));
  return stored;
}

// Take the attached files out of the note's text, so they travel to Claude beside it instead
export async function splitOutAttachments(notePath: string, text: string): Promise<NoteToSend> {
  const attachments: string[] = [];
  const references = new Set<string>();

  for (const reference of new Set(attachmentReferences(text))) {
    const target = resolveAttachment(notePath, reference);
    if (target && (await isFile(target))) {
      attachments.push(target);
      references.add(reference);
    }
  }

  return { text: withoutAttachments(text, references), attachments };
}

// Delete a stored file the editor has taken off the note, unless another note there names it
export async function dropAttachment(notePath: string, reference: string): Promise<void> {
  const target = resolveAttachment(notePath, reference);
  if (!target || !(await isFile(target))) {
    return;
  }

  const noteDir = path.dirname(notePath);
  const otherNotesText = await readNotesText(noteDir, path.basename(notePath));
  if (otherNotesText === undefined || isNamedIn(otherNotesText, target)) {
    return;
  }

  await vscode.workspace.fs.delete(vscode.Uri.file(target));
  await removeWhenEmpty(attachmentsIn(noteDir));
}

// Delete the files in a folder that no note there names any more
export async function pruneAttachments(noteDir: string): Promise<void> {
  const dir = attachmentsIn(noteDir);
  const storedFiles = await attachmentFiles(dir);
  if (storedFiles.length === 0) {
    return;
  }

  const notesText = await readNotesText(noteDir);
  if (notesText === undefined) {
    return;
  }

  for (const file of storedFiles) {
    if (!isNamedIn(notesText, file)) {
      await vscode.workspace.fs.delete(vscode.Uri.file(file));
    }
  }

  await removeWhenEmpty(dir);
}

// Delete the files only this note names. Call it while the note is still there to read
export async function dropNoteAttachments(notePath: string): Promise<void> {
  const noteDir = path.dirname(notePath);
  const dir = attachmentsIn(noteDir);
  const storedFiles = await attachmentFiles(dir);
  if (storedFiles.length === 0) {
    return;
  }

  const ownText = await readNote(notePath);
  const otherNotesText = await readNotesText(noteDir, path.basename(notePath));
  if (ownText === undefined || otherNotesText === undefined) {
    return;
  }

  const named = ownText.toLowerCase();
  for (const file of storedFiles) {
    if (isNamedIn(named, file) && !isNamedIn(otherNotesText, file)) {
      await vscode.workspace.fs.delete(vscode.Uri.file(file));
    }
  }

  await removeWhenEmpty(dir);
}

// Bring the files a moved or copied note names along to its new folder
export async function carryNoteAttachments(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceDir = path.dirname(sourcePath);
  const noteDir = path.dirname(destinationPath);

  // A folder brings its own attachments folder with it, and a note that stayed put keeps its paths
  if (!isNote(destinationPath) || sourceDir === noteDir) {
    return;
  }

  const source = attachmentsIn(sourceDir);
  const storedFiles = await attachmentFiles(source);
  if (storedFiles.length === 0) {
    return;
  }

  const text = await readNote(destinationPath);
  const leftBehindText = await readNotesText(sourceDir);
  if (text === undefined || leftBehindText === undefined) {
    return;
  }

  // Copy whatever a note still in the old folder names, and move the rest
  const destination = attachmentsIn(noteDir);
  const noteText = text.toLowerCase();
  let rewritten = text;

  for (const file of storedFiles) {
    const name = path.basename(file);
    if (!isNamedIn(noteText, file)) {
      continue;
    }

    // One file the disk refuses is left where it is, so the note still follows the rest
    try {
      const availableName = await carryOneAttachment(file, destination, leftBehindText);
      if (availableName !== name) {
        rewritten = repointReference(rewritten, name, availableName);
      }
    } catch {
      continue;
    }
  }

  // Save the note when a name had to change, and clear the old folder
  if (rewritten !== text) {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(destinationPath), new TextEncoder().encode(rewritten));
  }
  await removeWhenEmpty(source);
}
