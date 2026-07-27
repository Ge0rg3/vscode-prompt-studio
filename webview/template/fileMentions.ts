// Runs the @ mention popup in the template editor and tints the mentions that resolve
import {
  autocompletion,
  Completion,
  CompletionContext,
  CompletionResult,
  pickedCompletion,
  selectedCompletion
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Extension, Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { SyntaxNode, Tree } from '@lezer/common';

// A file or folder an @ mention can name, relative to the workspace root or absolute
export interface MentionEntry {
  path: string;
  isFolder: boolean;
}

// What the editor asks the extension host for, since only the host can reach the disk
export interface MentionHost {
  listDirectory(dirPath: string): Promise<MentionEntry[]>;
  cachedDirectory(dirPath: string): MentionEntry[] | undefined;
  prefetchDirectory(dirPath: string): void;
  verifyPaths(paths: string[]): void;
  openMention(mentionPath: string): void;
}

interface MentionCandidate {
  path: string;
  isFolder: boolean;
  lowerPath: string;
  lowerBase: string;
  depth: number;
}

interface MentionCatalog {
  candidates: readonly MentionCandidate[];
  paths: ReadonlySet<string>;
}

interface ScoredCandidate {
  candidate: MentionCandidate;
  score: number;
}

interface MentionScan {
  marks: DecorationSet;
  unverified: string[];
}

// The @ token before the cursor and the range its options replace
interface MentionToken {
  typed: string;
  query: string;
  from: number;
  to: number;
}

// The @ token before the cursor, opened at a line start or after a space, a bracket, or an emphasis mark
const MENTION_AT_CURSOR = /(?:^|[\s([{<"'*_~])@([^\s@]*)$/;

// Every @ token on a line, same shape
const MENTION_SCAN = /(?:^|[\s([{<"'*_~])@([^\s@]+)/g;

// The rest of a token sitting after the caret
const TOKEN_TAIL = /^[^\s@]*/;

// Punctuation and emphasis marks that can trail a mention without belonging to the path
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"*_~`>]+$/;

// Nodes whose text is code, where an @ never names a file
const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'CodeText', 'CodeMark', 'CodeInfo', 'InlineCode']);

const MAX_OPTIONS = 50;

// How long the popup highlight rests on a folder before its listing is fetched
const PREFETCH_SETTLE_MS = 150;

const EMPTY_CATALOG: MentionCatalog = { candidates: [], paths: new Set() };

const mentionMark = Decoration.mark({ class: 'cm-mention' });

// The workspace paths the popup offers, pushed in by the extension host
export const setMentionEntries = StateEffect.define<readonly MentionEntry[]>();

// Absolute paths the host has confirmed exist
export const addVerifiedPaths = StateEffect.define<readonly MentionEntry[]>();

const mentionCatalog = StateField.define<MentionCatalog>({
  create: () => EMPTY_CATALOG,
  update(catalog, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMentionEntries)) {
        return buildCatalog(effect.value);
      }
    }
    return catalog;
  }
});

const verifiedPaths = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update(paths, tr) {
    for (const effect of tr.effects) {
      if (effect.is(addVerifiedPaths) && effect.value.length > 0) {
        const next = new Set(paths);
        for (const entry of effect.value) {
          addLookupForms(next, entry);
        }
        return next;
      }
    }
    return paths;
  }
});

// --- helpers ---

// Record every path, plus the trailing-slash form so a folder answers to both
function addLookupForms(paths: Set<string>, entry: MentionEntry): void {
  paths.add(entry.path);
  if (entry.isFolder) {
    paths.add(`${entry.path}/`);
  }
}

// Work out the lowercase forms the ranking compares against
function toCandidate(entry: MentionEntry): MentionCandidate {
  const lowerPath = entry.path.toLowerCase();
  return {
    path: entry.path,
    isFolder: entry.isFolder,
    lowerPath,
    lowerBase: lowerPath.slice(lowerPath.lastIndexOf('/') + 1),
    depth: entry.path.split('/').length - 1
  };
}

// Build the list the popup ranks and the set the tinting checks against
function buildCatalog(entries: readonly MentionEntry[]): MentionCatalog {
  const candidates: MentionCandidate[] = [];
  const paths = new Set<string>();

  for (const entry of entries) {
    candidates.push(toCandidate(entry));
    addLookupForms(paths, entry);
  }

  return { candidates, paths };
}

// Check whether the position sits inside a fenced block or a backtick span
function insideCode(tree: Tree, pos: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) {
      return true;
    }
  }
  return false;
}

// Match the query's characters in order, anywhere in the path
function isSubsequence(query: string, path: string): boolean {
  let at = 0;
  for (const char of path) {
    if (char === query[at] && ++at === query.length) {
      return true;
    }
  }
  return false;
}

// Score a workspace path against the query, lower is better and -1 rejects it
function scoreCandidate(candidate: MentionCandidate, query: string): number {
  if (query.length === 0) {
    return candidate.depth === 0 ? 0 : -1;
  }

  // Keep only the direct children of the folder a trailing slash browses
  if (query.endsWith('/')) {
    const childDepth = query.split('/').length - 1;
    return candidate.lowerPath.startsWith(query) && candidate.depth === childDepth ? 0 : -1;
  }

  if (candidate.lowerBase.startsWith(query)) {
    return 0;
  }
  if (candidate.lowerPath.startsWith(query)) {
    return 1;
  }
  if (candidate.lowerBase.includes(query)) {
    return 2;
  }
  if (candidate.lowerPath.includes(query)) {
    return 3;
  }
  return isSubsequence(query, candidate.lowerPath) ? 4 : -1;
}

// Score a listed child against what is typed after the last slash
function scoreChild(candidate: MentionCandidate, prefix: string): number {
  if (prefix.length === 0 || candidate.lowerBase.startsWith(prefix)) {
    return 0;
  }
  if (candidate.lowerBase.includes(prefix)) {
    return 1;
  }
  return isSubsequence(prefix, candidate.lowerBase) ? 2 : -1;
}

// Order by score, then by shallow paths, then folders, then alphabetically
function compareScored(first: ScoredCandidate, second: ScoredCandidate): number {
  return (
    first.score - second.score ||
    first.candidate.depth - second.candidate.depth ||
    Number(second.candidate.isFolder) - Number(first.candidate.isFolder) ||
    first.candidate.lowerPath.localeCompare(second.candidate.lowerPath)
  );
}

// Pick the best candidates for a query, capped at what the popup shows
function bestMatches(candidates: readonly MentionCandidate[], score: (candidate: MentionCandidate) => number): MentionCandidate[] {
  const scored: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    const rank = score(candidate);
    if (rank >= 0) {
      scored.push({ candidate, score: rank });
    }
  }

  scored.sort(compareScored);

  const matches: MentionCandidate[] = [];
  for (const entry of scored.slice(0, MAX_OPTIONS)) {
    matches.push(entry.candidate);
  }
  return matches;
}

// Insert the path and leave the caret one space past it
function applyFilePath(view: EditorView, completion: Completion, from: number, to: number): void {
  const nextChar = view.state.sliceDoc(to, to + 1);
  const spacer = nextChar === ' ' || nextChar === '\t' ? '' : ' ';

  view.dispatch({
    changes: { from, to, insert: completion.label + spacer },
    selection: { anchor: from + completion.label.length + 1 },
    annotations: pickedCompletion.of(completion),
    userEvent: 'input.complete'
  });
}

// Build one popup row, the name up front and the folder it sits in dimmed beside it
function toCompletion(candidate: MentionCandidate): Completion {
  const slash = candidate.path.lastIndexOf('/');
  const name = candidate.path.slice(slash + 1);

  return {
    label: candidate.path,
    displayLabel: candidate.isFolder ? `${name}/` : name,
    detail: slash < 0 ? undefined : candidate.path.slice(0, slash),
    type: candidate.isFolder ? 'folder' : 'file',
    apply: candidate.isFolder ? `${candidate.path}/` : applyFilePath
  };
}

// Find the part of the row name the last query segment matched
function matchRange(name: string, query: string): readonly number[] {
  const segment = query.slice(query.lastIndexOf('/') + 1);
  if (segment.length === 0) {
    return [];
  }

  const at = name.toLowerCase().indexOf(segment);
  return at < 0 ? [] : [at, at + segment.length];
}

// Turn the ranked candidates into a popup result over the token
function toResult(matches: readonly MentionCandidate[], token: MentionToken, host: MentionHost): CompletionResult | null {
  if (matches.length === 0) {
    return null;
  }

  const options: Completion[] = [];
  for (const candidate of matches) {
    options.push(toCompletion(candidate));
  }

  return {
    from: token.from,
    to: token.to,
    options,
    filter: false,
    getMatch: (completion) => matchRange(completion.displayLabel ?? completion.label, token.query),

    // Re-rank in place as keys arrive, returning null asks the source for fresh options
    update: (_current, _from, _to, context) => {
      const next = mentionToken(context);
      return next ? syncOptions(context, next, host) : null;
    }
  };
}

// Find the @ token before the cursor, null when there is none or it sits in code
function mentionToken(context: CompletionContext): MentionToken | null {
  const line = context.state.doc.lineAt(context.pos);
  const caret = context.pos - line.from;
  const token = MENTION_AT_CURSOR.exec(line.text.slice(0, caret));
  if (!token) {
    return null;
  }

  const from = context.pos - token[1].length;
  if (insideCode(syntaxTree(context.state), from - 1)) {
    return null;
  }

  // Reach past the caret so the options replace the whole token
  const tail = TOKEN_TAIL.exec(line.text.slice(caret))?.[0].length ?? 0;
  return { typed: token[1], query: token[1].toLowerCase(), from, to: context.pos + tail };
}

// Take the directory the token names, everything up to its last slash
function directoryOf(typed: string): string {
  return typed.slice(0, typed.lastIndexOf('/') + 1);
}

// Rank a directory listing against what is typed after the last slash
function childResult(children: readonly MentionEntry[], token: MentionToken, host: MentionHost): CompletionResult | null {
  const prefix = token.query.slice(token.query.lastIndexOf('/') + 1);
  const candidates: MentionCandidate[] = [];
  for (const child of children) {
    candidates.push(toCandidate(child));
  }

  return toResult(bestMatches(candidates, (candidate) => scoreChild(candidate, prefix)), token, host);
}

// Build the options answerable without the host, from the workspace list or a cached directory
function syncOptions(context: CompletionContext, token: MentionToken, host: MentionHost): CompletionResult | null {
  if (token.typed.startsWith('/')) {
    const cached = host.cachedDirectory(directoryOf(token.typed));
    return cached ? childResult(cached, token, host) : null;
  }

  const catalog = context.state.field(mentionCatalog);
  return toResult(bestMatches(catalog.candidates, (candidate) => scoreCandidate(candidate, token.query)), token, host);
}

// Offer the file and folder options for the @ token before the cursor
function mentionSource(context: CompletionContext, host: MentionHost): CompletionResult | Promise<CompletionResult | null> | null {
  const token = mentionToken(context);
  if (!token) {
    return null;
  }

  const sync = syncOptions(context, token, host);
  if (sync || !token.typed.startsWith('/')) {
    return sync;
  }

  return host.listDirectory(directoryOf(token.typed)).then((children) => childResult(children, token, host));
}

// Fetch a disk folder's listing once the highlight rests on it, so stepping in is instant
function prefetchHighlighted(host: MentionHost): Extension {
  let settleTimer: number | undefined;
  return EditorView.updateListener.of((update) => {
    const selected = selectedCompletion(update.state);
    if (selected === selectedCompletion(update.startState)) {
      return;
    }

    clearTimeout(settleTimer);
    if (selected?.type === 'folder' && selected.label.startsWith('/')) {
      settleTimer = setTimeout(() => host.prefetchDirectory(`${selected.label}/`), PREFETCH_SETTLE_MS);
    }
  });
}

// Resolve the path an @ token names, trailing punctuation trimmed off
function resolveMention(token: string, catalog: MentionCatalog, verified: ReadonlySet<string>): string | undefined {
  if (catalog.paths.has(token) || verified.has(token)) {
    return token;
  }

  const trimmed = token.replace(TRAILING_PUNCTUATION, '');
  return catalog.paths.has(trimmed) || verified.has(trimmed) ? trimmed : undefined;
}

// Take the absolute path an @ token points at, undefined when the token names none
function absoluteTarget(token: string): string | undefined {
  if (!token.startsWith('/')) {
    return undefined;
  }

  const trimmed = token.replace(TRAILING_PUNCTUATION, '').replace(/\/$/, '');
  return trimmed.length > 1 ? trimmed : undefined;
}

// Test a click for the open gesture: ctrl on Windows and Linux, cmd on macOS
function isOpenClick(event: MouseEvent): boolean {
  return event.button === 0 && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}

// Take the path of the tinted mention covering a position, the mark spans the @ and the path
function mentionPathAt(marks: DecorationSet, state: EditorState, pos: number): string | undefined {
  let mentionPath: string | undefined;

  marks.between(pos, pos, (from, to) => {
    if (pos < to) {
      mentionPath = state.sliceDoc(from + 1, to);
      return false;
    }
  });

  return mentionPath;
}

// Mark every @ mention in the visible lines that names a real file or folder
function scanMentions(state: EditorState, ranges: readonly { from: number; to: number }[]): MentionScan {
  const catalog = state.field(mentionCatalog);
  const verified = state.field(verifiedPaths);
  const tree = syntaxTree(state);

  const marks: Range<Decoration>[] = [];
  const unverified: string[] = [];
  let scannedTo = 0;

  for (const range of ranges) {
    const from = Math.max(scannedTo, state.doc.lineAt(range.from).from);
    const to = state.doc.lineAt(range.to).to;
    if (to <= from) {
      continue;
    }
    scannedTo = to;

    const text = state.doc.sliceString(from, to);
    for (const match of text.matchAll(MENTION_SCAN)) {
      const at = from + (match.index ?? 0) + match[0].length - match[1].length - 1;
      if (insideCode(tree, at)) {
        continue;
      }

      const resolved = resolveMention(match[1], catalog, verified);
      if (resolved) {
        marks.push(mentionMark.range(at, at + 1 + resolved.length));
        continue;
      }

      const target = absoluteTarget(match[1]);
      if (target) {
        unverified.push(target);
      }
    }
  }

  return { marks: Decoration.set(marks, true), unverified };
}

// --- exports ---

// Complete @ mentions from the workspace, or from disk past a leading slash, and tint what resolves
export function fileMentions(host: MentionHost): Extension {
  return [
    mentionCatalog,
    verifiedPaths,
    autocompletion({
      override: [(context) => mentionSource(context, host)],
      activateOnCompletion: (completion) => completion.type === 'folder',

      // Skip the type-ahead delay, every keystroke is answered locally
      activateOnTypingDelay: 0
    }),
    prefetchHighlighted(host),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = this.scan(view.state, view.visibleRanges);
        }

        update(update: ViewUpdate): void {
          const pathsChanged =
            update.startState.field(mentionCatalog) !== update.state.field(mentionCatalog) ||
            update.startState.field(verifiedPaths) !== update.state.field(verifiedPaths);

          // Rescan when the background markdown parse lands, since skipping code blocks needs its tree
          const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);

          if (update.docChanged || update.viewportChanged || pathsChanged || treeChanged) {
            this.decorations = this.scan(update.state, update.view.visibleRanges);
          }
        }

        // Send the mention under a ctrl+click to the host
        openClickedMention(event: MouseEvent, view: EditorView): boolean {
          if (!isOpenClick(event)) {
            return false;
          }

          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const mentionPath = pos === null ? undefined : mentionPathAt(this.decorations, view.state, pos);
          if (mentionPath === undefined) {
            return false;
          }

          host.openMention(mentionPath);
          return true;
        }

        private scan(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
          const { marks, unverified } = scanMentions(state, ranges);
          if (unverified.length > 0) {
            host.verifyPaths(unverified);
          }
          return marks;
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
        eventHandlers: {
          mousedown(event, view) {
            return this.openClickedMention(event, view);
          }
        }
      }
    )
  ];
}
