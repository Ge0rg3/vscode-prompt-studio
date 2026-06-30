import * as path from 'node:path';

import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';

import { CardLayoutStore, CardSize, NotePosition } from './cardLayoutStore';
import { compareCaseInsensitive } from './utils/compare';
import { pathExists } from './utils/fs';

type NoteMetadata = Record<string, unknown>;

export const CONFIG_FILENAME = 'config.yml';
const WRITE_DEBOUNCE_MS = 200;
// grace window after a self-write to skip the watcher event it triggers
const SELF_WRITE_GRACE_MS = 1000;
const BANNER = '# Prompt Studio per-entry metadata. Safe to edit and commit.\n';

// per-entry metadata stored in <root>/config.yml, keeps any keys it does not use when rewriting
export class VaultConfig implements vscode.Disposable, CardLayoutStore {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly watcherSubs: vscode.Disposable[] = [];
  private readonly rootSub: vscode.Disposable;
  private watcher: vscode.FileSystemWatcher | undefined;
  private entries = new Map<string, NoteMetadata>();
  private vaultRoot: string | undefined;
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  // time of the last self-write, checked against SELF_WRITE_GRACE_MS
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
    const key = this.configKeyOf(absPath);
    if (key === undefined) {
      return;
    }

    const meta = this.entries.get(key) ?? {};
    const visual = this.cloneVisual(meta);
    visual.x = Math.round(position.x);
    visual.y = Math.round(position.y);
    meta.visual = visual;
    this.entries.set(key, meta);

    this.scheduleWrite();
  }

  getSize(absPath: string): CardSize | undefined {
    const key = this.configKeyOf(absPath);
    return key === undefined ? undefined : this.sizeOf(this.entries.get(key));
  }

  setSize(absPath: string, size: CardSize): void {
    const key = this.configKeyOf(absPath);
    if (key === undefined) {
      return;
    }

    const meta = this.entries.get(key) ?? {};
    const visual = this.cloneVisual(meta);
    visual.width = Math.round(size.width);
    visual.height = Math.round(size.height);
    meta.visual = visual;
    this.entries.set(key, meta);

    this.scheduleWrite();
  }

  getZ(absPath: string): number | undefined {
    const key = this.configKeyOf(absPath);
    return key === undefined ? undefined : this.zOf(this.entries.get(key));
  }

  // raise a card's stacking order so it sits in front of overlapping cards
  setZ(absPath: string, z: number): void {
    const key = this.configKeyOf(absPath);
    if (key === undefined) {
      return;
    }

    const meta = this.entries.get(key) ?? {};
    const visual = this.cloneVisual(meta);
    visual.z = Math.round(z);
    meta.visual = visual;
    this.entries.set(key, meta);

    this.scheduleWrite();
  }

  getColor(absPath: string): string | undefined {
    const key = this.configKeyOf(absPath);
    return key === undefined ? undefined : this.colorOf(this.entries.get(key));
  }

  // set a palette color, or pass undefined to clear it back to the theme default
  setColor(absPath: string, color: string | undefined): void {
    const key = this.configKeyOf(absPath);
    if (key === undefined) {
      return;
    }

    const meta = this.entries.get(key) ?? {};
    const visual = this.cloneVisual(meta);
    if (color === undefined) {
      delete visual.color;
    } else {
      visual.color = color;
    }
    meta.visual = visual;
    this.entries.set(key, meta);

    this.scheduleWrite();
    this.emitter.fire();
  }

  // follow a renamed or moved entry, remapping its own key and any descendants
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

  // drop a deleted entry and any descendants from the metadata
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

  // vault-relative config.yml key for an absolute path
  private configKeyOf(absPath: string): string | undefined {
    return this.vaultRoot === undefined
      ? undefined
      : this.toConfigKey(path.relative(this.vaultRoot, absPath));
  }

  // re-point at the current root, reloading config.yml and rearming its watcher
  private reload(): void {
    this.teardownWatcher();
    this.entries = new Map();
    this.vaultRoot = this.resolveRoot();
    if (!this.vaultRoot) {
      this.emitter.fire();
      return;
    }

    const pattern = new vscode.RelativePattern(this.vaultRoot, CONFIG_FILENAME);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcherSubs.push(
      this.watcher.onDidCreate(() => this.handleExternalChange()),
      this.watcher.onDidChange(() => this.handleExternalChange()),
      this.watcher.onDidDelete(() => this.handleExternalChange())
    );

    void this.loadFromDisk(this.vaultRoot).then(() => this.emitter.fire());
  }

  // dispose the config.yml watcher and its subscriptions
  private teardownWatcher(): void {
    for (const sub of this.watcherSubs) {
      sub.dispose();
    }
    this.watcherSubs.length = 0;
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  // read and parse config.yml into entries, skip silently when the file is absent
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

  // an external edit landed, drop the in-memory copy and re-read
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

  // debounce a flush so a burst of edits collapses into one write
  private scheduleWrite(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.flush();
    }, WRITE_DEBOUNCE_MS);
  }

  // write the entries map back to config.yml
  private async flush(): Promise<void> {
    const root = this.vaultRoot;
    if (!root) {
      return;
    }

    // collect entries in stable order, dropping any that have no metadata left
    const notes: Record<string, NoteMetadata> = {};
    const keys = [...this.entries.keys()].sort(compareCaseInsensitive);
    for (const key of keys) {
      const meta = this.entries.get(key)!;
      if (Object.keys(meta).length > 0) {
        notes[key] = meta;
      }
    }

    // a fresh vault with nothing to store gets no config.yml
    const configUri = vscode.Uri.file(path.join(root, CONFIG_FILENAME));
    if (Object.keys(notes).length === 0 && !(await pathExists(configUri))) {
      return;
    }

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

  // config.yml keys are vault-relative with forward slashes on every platform
  private toConfigKey(relPath: string): string {
    return relPath.split(path.sep).join('/');
  }

  // the visual block within an entry's metadata, or undefined if absent or malformed
  private visualOf(meta: NoteMetadata | undefined): Record<string, unknown> | undefined {
    const visual = meta?.visual;
    if (!visual || typeof visual !== 'object' || Array.isArray(visual)) {
      return undefined;
    }
    return visual as Record<string, unknown>;
  }

  // a mutable copy of the visual block
  private cloneVisual(meta: NoteMetadata): Record<string, unknown> {
    const visual = this.visualOf(meta);
    return visual ? { ...visual } : {};
  }

  // the x/y position saved in an entry's metadata
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

  // the width/height saved in an entry's metadata
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

  // the palette color saved in an entry's metadata
  private colorOf(meta: NoteMetadata | undefined): string | undefined {
    const color = this.visualOf(meta)?.color;
    return typeof color === 'string' ? color : undefined;
  }

  // the stacking order saved in an entry's metadata
  private zOf(meta: NoteMetadata | undefined): number | undefined {
    const z = this.visualOf(meta)?.z;
    return typeof z === 'number' && Number.isFinite(z) ? z : undefined;
  }

  // read the `notes` map out of parsed config.yml, skipping malformed entries
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
