// Reads and writes a root's config.yml, where each entry's card layout and color are saved
import * as path from 'node:path';

import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';

import { CardLayoutStore, CardSize, NotePosition } from './cardLayoutStore';
import { compareCaseInsensitive } from './utils/compare';
import { pathExists } from './utils/fs';
import { isWithin } from './utils/paths';

type NoteMetadata = Record<string, unknown>;

export const CONFIG_FILENAME = 'config.yml';
const WRITE_DEBOUNCE_MS = 200;
// Ignore the file change this write just caused for this long
const SELF_WRITE_GRACE_MS = 1000;
const BANNER = '# Prompt Studio per-entry metadata. Safe to edit and commit.\n';

// Per-entry metadata from <root>/config.yml, an entry's unknown keys survive a rewrite
export class VaultConfig implements vscode.Disposable, CardLayoutStore {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly watcherSubs: vscode.Disposable[] = [];
  private readonly rootSub: vscode.Disposable;
  private watcher: vscode.FileSystemWatcher | undefined;
  private entries = new Map<string, NoteMetadata>();
  private vaultRoot: string | undefined;
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSelfWrite = 0;

  readonly onDidChange: vscode.Event<void> = this.emitter.event;

  constructor(
    private readonly resolveRoot: () => string | undefined,
    onRootChange: vscode.Event<unknown>
  ) {
    this.rootSub = onRootChange(() => this.reload());
    this.reload();
  }

  getPosition(absPath: string): NotePosition | undefined {
    const key = this.configKeyOf(absPath);
    return key === undefined ? undefined : this.positionOf(this.entries.get(key));
  }

  setPosition(absPath: string, position: NotePosition): void {
    this.mutateVisual(absPath, (visual) => {
      visual.x = Math.round(position.x);
      visual.y = Math.round(position.y);
    });
  }

  getSize(absPath: string): CardSize | undefined {
    const key = this.configKeyOf(absPath);
    return key === undefined ? undefined : this.sizeOf(this.entries.get(key));
  }

  setSize(absPath: string, size: CardSize): void {
    this.mutateVisual(absPath, (visual) => {
      visual.width = Math.round(size.width);
      visual.height = Math.round(size.height);
    });
  }

  getZ(absPath: string): number | undefined {
    const key = this.configKeyOf(absPath);
    return key === undefined ? undefined : this.zOf(this.entries.get(key));
  }

  // Save a card's stacking order, a higher number sits in front
  setZ(absPath: string, z: number): void {
    this.mutateVisual(absPath, (visual) => {
      visual.z = Math.round(z);
    });
  }

  getColor(absPath: string): string | undefined {
    const key = this.configKeyOf(absPath);
    return key === undefined ? undefined : this.colorOf(this.entries.get(key));
  }

  // Set a palette color, undefined clears it back to the theme default
  setColor(absPath: string, color: string | undefined): void {
    const applied = this.mutateVisual(absPath, (visual) => {
      if (color === undefined) {
        delete visual.color;
      } else {
        visual.color = color;
      }
    });

    if (applied) {
      this.emitter.fire();
    }
  }

  // Follow a renamed or moved entry, remapping its own key and any below it
  relocate(oldAbsPath: string, newAbsPath: string): void {
    const oldKey = this.configKeyOf(oldAbsPath);
    const newKey = this.configKeyOf(newAbsPath);
    if (oldKey === undefined || newKey === undefined || oldKey === newKey) {
      return;
    }

    let changed = false;
    for (const key of [...this.entries.keys()]) {
      let nextKey: string | undefined;
      if (key === oldKey) {
        nextKey = newKey;
      } else if (key.startsWith(`${oldKey}/`)) {
        nextKey = newKey + key.slice(oldKey.length);
      }
      if (nextKey !== undefined) {
        const meta = this.entries.get(key)!;
        this.entries.delete(key);
        this.entries.set(nextKey, meta);
        changed = true;
      }
    }

    if (changed) {
      this.scheduleWrite();
      this.emitter.fire();
    }
  }

  // Copy an entry's metadata, and anything below it, onto a duplicated path
  duplicate(sourceAbsPath: string, copyAbsPath: string): void {
    const sourceKey = this.configKeyOf(sourceAbsPath);
    const copyKey = this.configKeyOf(copyAbsPath);
    if (sourceKey === undefined || copyKey === undefined || sourceKey === copyKey) {
      return;
    }

    let changed = false;
    for (const key of [...this.entries.keys()]) {
      let nextKey: string | undefined;
      if (key === sourceKey) {
        nextKey = copyKey;
      } else if (key.startsWith(`${sourceKey}/`)) {
        nextKey = copyKey + key.slice(sourceKey.length);
      }
      if (nextKey !== undefined) {
        this.entries.set(nextKey, structuredClone(this.entries.get(key)!));
        changed = true;
      }
    }

    if (changed) {
      this.scheduleWrite();
      this.emitter.fire();
    }
  }

  // Drop a deleted entry, and anything below it, from the metadata
  remove(absPath: string): void {
    const key = this.configKeyOf(absPath);
    if (key === undefined) {
      return;
    }

    let changed = false;
    for (const existing of [...this.entries.keys()]) {
      if (existing === key || existing.startsWith(`${key}/`)) {
        this.entries.delete(existing);
        changed = true;
      }
    }

    if (changed) {
      this.scheduleWrite();
      this.emitter.fire();
    }
  }

  dispose(): void {
    this.teardownWatcher();
    this.rootSub.dispose();
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }
    this.emitter.dispose();
  }

  // Turn an absolute path into its vault-relative config.yml key, undefined for a path outside the vault
  private configKeyOf(absPath: string): string | undefined {
    if (this.vaultRoot === undefined || !isWithin(absPath, this.vaultRoot)) {
      return undefined;
    }
    return this.toConfigKey(path.relative(this.vaultRoot, absPath));
  }

  // Switch to the current vault root, reading its config.yml and watching it again
  private reload(): void {
    this.flushPending();
    this.teardownWatcher();
    this.entries = new Map();
    this.vaultRoot = this.resolveRoot();
    if (!this.vaultRoot) {
      this.emitter.fire();
      return;
    }

    // Watch config.yml so an outside edit is picked up
    const pattern = new vscode.RelativePattern(this.vaultRoot, CONFIG_FILENAME);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcherSubs.push(
      this.watcher.onDidCreate(() => this.handleExternalChange()),
      this.watcher.onDidChange(() => this.handleExternalChange()),
      this.watcher.onDidDelete(() => this.handleExternalChange())
    );

    void this.loadFromDisk(this.vaultRoot).then(() => this.emitter.fire());
  }

  // Dispose the config.yml watcher and its subscriptions
  private teardownWatcher(): void {
    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcherSubs.length = 0;
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  // Read config.yml into the entries map, doing nothing when there is no file
  private async loadFromDisk(root: string): Promise<void> {
    const configUri = vscode.Uri.file(path.join(root, CONFIG_FILENAME));
    let raw: string;
    try {
      raw = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(configUri));
    } catch {
      return;
    }

    try {
      this.entries = this.notesFrom(parse(raw));
    } catch (err) {
      void vscode.window.showWarningMessage(
        `Prompt Studio: could not parse ${CONFIG_FILENAME} - ${(err as Error).message}`
      );
    }
  }

  // Read config.yml again when someone else edits it
  private handleExternalChange(): void {
    if (Date.now() - this.lastSelfWrite < SELF_WRITE_GRACE_MS) {
      return;
    }
    const root = this.vaultRoot;
    if (!root) {
      return;
    }
    void (async () => {
      this.entries = new Map();
      await this.loadFromDisk(root);
      this.emitter.fire();
    })();
  }

  // Wait for a burst of edits to settle, then write once
  private scheduleWrite(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }

    const root = this.vaultRoot;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.flush(root);
    }, WRITE_DEBOUNCE_MS);
  }

  // Write any waiting save now, before the switch to another vault clears the entries
  private flushPending(): void {
    if (!this.writeTimer) {
      return;
    }

    clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
    void this.flush(this.vaultRoot);
  }

  // Write the entries map back to the config.yml in the vault the edits were made in
  private async flush(root: string | undefined): Promise<void> {
    if (!root) {
      return;
    }

    // Collect the entries in a stable order, dropping any with no metadata left
    const notes: Record<string, NoteMetadata> = {};
    const keys = [...this.entries.keys()].sort(compareCaseInsensitive);
    for (const key of keys) {
      const meta = this.entries.get(key)!;
      if (Object.keys(meta).length > 0) {
        notes[key] = meta;
      }
    }

    // Don't create a config.yml for a vault with nothing to store
    const configUri = vscode.Uri.file(path.join(root, CONFIG_FILENAME));
    if (Object.keys(notes).length === 0 && !(await pathExists(configUri))) {
      return;
    }

    // Write the file, noting the time so the watcher skips the change it fires
    const body = BANNER + stringify({ notes });
    try {
      this.lastSelfWrite = Date.now();
      await vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(body));
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Prompt Studio: could not write ${CONFIG_FILENAME} - ${(err as Error).message}`
      );
    }
  }

  // Swap in forward slashes so a key reads the same on every platform
  private toConfigKey(relPath: string): string {
    return relPath.split(path.sep).join('/');
  }

  // Change a card's visual block and save it, false when no vault is set
  private mutateVisual(absPath: string, mutate: (visual: Record<string, unknown>) => void): boolean {
    const key = this.configKeyOf(absPath);
    if (key === undefined) {
      return false;
    }

    const meta = this.entries.get(key) ?? {};
    const visual = this.cloneVisual(meta);
    mutate(visual);
    meta.visual = visual;
    this.entries.set(key, meta);

    this.scheduleWrite();
    return true;
  }

  // Read the visual block out of an entry's metadata, undefined when it is missing or broken
  private visualOf(meta: NoteMetadata | undefined): Record<string, unknown> | undefined {
    const visual = meta?.visual;
    if (!visual || typeof visual !== 'object' || Array.isArray(visual)) {
      return undefined;
    }
    return visual as Record<string, unknown>;
  }

  // Copy an entry's visual block, empty when it has none
  private cloneVisual(meta: NoteMetadata): Record<string, unknown> {
    const visual = this.visualOf(meta);
    return visual ? { ...visual } : {};
  }

  // Read the x/y position saved in an entry's metadata
  private positionOf(meta: NoteMetadata | undefined): NotePosition | undefined {
    const visual = this.visualOf(meta);
    if (!visual) {
      return undefined;
    }
    const { x, y } = visual;
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      return { x, y };
    }
    return undefined;
  }

  // Read the width/height saved in an entry's metadata
  private sizeOf(meta: NoteMetadata | undefined): CardSize | undefined {
    const visual = this.visualOf(meta);
    if (!visual) {
      return undefined;
    }
    const { width, height } = visual;
    if (
      typeof width === 'number' &&
      Number.isFinite(width) &&
      typeof height === 'number' &&
      Number.isFinite(height)
    ) {
      return { width, height };
    }
    return undefined;
  }

  // Read the palette color saved in an entry's metadata
  private colorOf(meta: NoteMetadata | undefined): string | undefined {
    const color = this.visualOf(meta)?.color;
    return typeof color === 'string' ? color : undefined;
  }

  // Read the stacking order saved in an entry's metadata
  private zOf(meta: NoteMetadata | undefined): number | undefined {
    const z = this.visualOf(meta)?.z;
    return typeof z === 'number' && Number.isFinite(z) ? z : undefined;
  }

  // Read the notes map out of a parsed config.yml, skipping any broken entry
  private notesFrom(parsed: unknown): Map<string, NoteMetadata> {
    const out = new Map<string, NoteMetadata>();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return out;
    }
    const notes = (parsed as Record<string, unknown>).notes;
    if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
      return out;
    }
    for (const [relPath, meta] of Object.entries(notes as Record<string, unknown>)) {
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        out.set(this.toConfigKey(relPath), meta as NoteMetadata);
      }
    }
    return out;
  }
}
