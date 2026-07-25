// Keeps the list of workspace files and folders an @ mention can name, refreshed as files come and go
import * as vscode from 'vscode';

// A file or folder an @ mention can name
export interface MentionEntry {
  path: string;
  isFolder: boolean;
}

const MAX_INDEXED_FILES = 20000;
const REBUILD_DELAY_MS = 500;

export class MentionIndex implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.emitter];
  private readonly folder = vscode.workspace.workspaceFolders?.[0];

  private pending: Promise<MentionEntry[]> | undefined;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;

  readonly onDidChange: vscode.Event<void> = this.emitter.event;

  constructor() {
    if (!this.folder) {
      return;
    }

    const pattern = new vscode.RelativePattern(this.folder, '**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => this.invalidate()),
      watcher.onDidDelete(() => this.invalidate())
    );

    // Scan now so the first @ mention has a list to show
    void this.entries();
  }

  // Share one scan between callers, starting it on the first call
  entries(): Promise<MentionEntry[]> {
    if (!this.pending) {
      this.pending = this.build();
    }
    return this.pending;
  }

  dispose(): void {
    clearTimeout(this.rebuildTimer);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  // Scan the workspace, keeping every path relative to the workspace root
  private async build(): Promise<MentionEntry[]> {
    const folder = this.folder;
    if (!folder) {
      return [];
    }

    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*'),
      this.excludeGlob(folder),
      MAX_INDEXED_FILES
    );

    // Skip paths that cannot appear in a mention, since @ starts one and a space ends it
    const root = `${folder.uri.path.replace(/\/$/, '')}/`;
    const filePaths: string[] = [];
    for (const uri of uris) {
      const relativePath = uri.path.slice(root.length);
      if (!/[\s@]/.test(relativePath)) {
        filePaths.push(relativePath);
      }
    }

    return this.withFolders(filePaths);
  }

  // Drop the scan now, fire the change event once file events stop arriving
  private invalidate(): void {
    this.pending = undefined;
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => this.emitter.fire(), REBUILD_DELAY_MS);
  }

  // Fold the enabled files.exclude and search.exclude patterns into one glob
  private excludeGlob(folder: vscode.WorkspaceFolder): string | undefined {
    const files = vscode.workspace.getConfiguration('files', folder.uri).get<Record<string, unknown>>('exclude') ?? {};
    const search = vscode.workspace.getConfiguration('search', folder.uri).get<Record<string, unknown>>('exclude') ?? {};

    const patterns = new Set<string>();
    for (const [pattern, enabled] of [...Object.entries(files), ...Object.entries(search)]) {
      if (enabled === true) {
        patterns.add(pattern);
      }
    }

    return patterns.size > 0 ? `{${[...patterns].join(',')}}` : undefined;
  }

  // List each file plus every folder above it, without repeats
  private withFolders(filePaths: string[]): MentionEntry[] {
    const entries: MentionEntry[] = [];
    const folders = new Set<string>();

    for (const filePath of filePaths) {
      entries.push({ path: filePath, isFolder: false });

      let slash = filePath.lastIndexOf('/');
      while (slash > 0) {
        const folder = filePath.slice(0, slash);
        if (folders.has(folder)) {
          break;
        }
        folders.add(folder);
        slash = folder.lastIndexOf('/');
      }
    }

    for (const folder of folders) {
      entries.push({ path: folder, isFolder: true });
    }

    return entries;
  }
}
