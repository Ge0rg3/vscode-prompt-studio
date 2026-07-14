import { autocompletion, Completion, CompletionContext, CompletionResult, pickedCompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Extension, Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { SyntaxNode, Tree } from '@lezer/common';

// a file or folder an @mention can name, relative to the workspace root or absolute
export interface MentionEntry {
  path: string;
  isFolder: boolean;
}

// what the editor asks the extension host for, since only the host can read the disk
export interface MentionHost {
  listDirectory(dirPath: string): Promise<MentionEntry[]>;
  verifyPaths(paths: string[]): void;
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

// the @ token before the cursor, opened at a line start or after a space, a bracket, or an emphasis mark
const MENTION_AT_CURSOR = /(?:^|[\s([{<"'*_~])@([^\s@]*)$/;

// every @ token on a line, same shape
const MENTION_SCAN = /(?:^|[\s([{<"'*_~])@([^\s@]+)/g;

// the rest of a token sitting after the caret
const TOKEN_TAIL = /^[^\s@]*/;

// punctuation and emphasis marks that can trail a mention without belonging to the path
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"*_~`>]+$/;

// nodes whose text is code, where an @ never names a file
const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'CodeText', 'CodeMark', 'CodeInfo', 'InlineCode']);

const MAX_OPTIONS = 50;

const EMPTY_CATALOG: MentionCatalog = { candidates: [], paths: new Set() };

const mentionMark = Decoration.mark({ class: 'cm-mention' });

// the workspace paths the popup offers, pushed in by the extension host
export const setMentionEntries = StateEffect.define<readonly MentionEntry[]>();

// absolute paths the host has confirmed exist
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

// a folder answers to its bare path and to the same path with a trailing slash
function addLookupForms(paths: Set<string>, entry: MentionEntry): void {
  paths.add(entry.path);
  if (entry.isFolder) {
    paths.add(`${entry.path}/`);
  }
}

// precompute the lowercase forms the ranking compares against
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

// the list the popup ranks and the set the tint checks against
function buildCatalog(entries: readonly MentionEntry[]): MentionCatalog {
  const candidates: MentionCandidate[] = [];
  const paths = new Set<string>();

  for (const entry of entries) {
    candidates.push(toCandidate(entry));
    addLookupForms(paths, entry);
  }

  return { candidates, paths };
}

// true when the position sits inside a fenced block or a backtick span
function insideCode(tree: Tree, pos: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) {
      return true;
    }
  }
  return false;
}

// the query characters in order, anywhere in the path
function isSubsequence(query: string, path: string): boolean {
  let at = 0;
  for (const char of path) {
    if (char === query[at] && ++at === query.length) {
      return true;
    }
  }
  return false;
}

// how well a workspace path answers the query, lower is better, -1 rejects it
function scoreCandidate(candidate: MentionCandidate, query: string): number {
  if (query.length === 0) {
    return candidate.depth === 0 ? 0 : -1;
  }

  // a trailing slash browses that folder, so only its direct children qualify
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

// how well a listed child answers what is typed after the last slash
function scoreChild(candidate: MentionCandidate, prefix: string): number {
  if (prefix.length === 0 || candidate.lowerBase.startsWith(prefix)) {
    return 0;
  }
  if (candidate.lowerBase.includes(prefix)) {
    return 1;
  }
  return isSubsequence(prefix, candidate.lowerBase) ? 2 : -1;
}

// score first, then shallow paths, then folders, then alphabetical
function compareScored(first: ScoredCandidate, second: ScoredCandidate): number {
  return (
    first.score - second.score ||
    first.candidate.depth - second.candidate.depth ||
    Number(second.candidate.isFolder) - Number(first.candidate.isFolder) ||
    first.candidate.lowerPath.localeCompare(second.candidate.lowerPath)
  );
}

// the best candidates for a query, capped at what the popup shows
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

// insert the path and leave the caret one space past it
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

// one popup row, the name up front and the folder it sits in dimmed beside it
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

// the part of the row name the last query segment matched
function matchRange(name: string, query: string): readonly number[] {
  const segment = query.slice(query.lastIndexOf('/') + 1);
  if (segment.length === 0) {
    return [];
  }

  const at = name.toLowerCase().indexOf(segment);
  return at < 0 ? [] : [at, at + segment.length];
}

// turn the ranked candidates into a popup result over the token
function toResult(matches: readonly MentionCandidate[], from: number, to: number, query: string): CompletionResult | null {
  if (matches.length === 0) {
    return null;
  }

  const options: Completion[] = [];
  for (const candidate of matches) {
    options.push(toCompletion(candidate));
  }

  return {
    from,
    to,
    options,
    filter: false,
    getMatch: (completion) => matchRange(completion.displayLabel ?? completion.label, query)
  };
}

// browse the disk itself, the directory named by everything up to the last slash
async function absoluteOptions(
  host: MentionHost,
  typed: string,
  query: string,
  from: number,
  to: number
): Promise<CompletionResult | null> {
  const dirPath = typed.slice(0, typed.lastIndexOf('/') + 1);
  const children = await host.listDirectory(dirPath);

  const prefix = query.slice(dirPath.length);
  const candidates: MentionCandidate[] = [];
  for (const child of children) {
    candidates.push(toCandidate(child));
  }

  return toResult(bestMatches(candidates, (candidate) => scoreChild(candidate, prefix)), from, to, query);
}

// the file and folder options for the @ token before the cursor
function mentionSource(context: CompletionContext, host: MentionHost): CompletionResult | Promise<CompletionResult | null> | null {
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

  // replace the whole token, not just the part before the caret
  const tail = TOKEN_TAIL.exec(line.text.slice(caret))?.[0].length ?? 0;
  const to = context.pos + tail;

  const typed = token[1];
  const query = typed.toLowerCase();
  if (typed.startsWith('/')) {
    return absoluteOptions(host, typed, query, from, to);
  }

  const catalog = context.state.field(mentionCatalog);
  return toResult(bestMatches(catalog.candidates, (candidate) => scoreCandidate(candidate, query)), from, to, query);
}

// the path an @ token names, trailing punctuation trimmed off
function resolveMention(token: string, catalog: MentionCatalog, verified: ReadonlySet<string>): string | undefined {
  if (catalog.paths.has(token) || verified.has(token)) {
    return token;
  }

  const trimmed = token.replace(TRAILING_PUNCTUATION, '');
  return catalog.paths.has(trimmed) || verified.has(trimmed) ? trimmed : undefined;
}

// the absolute path an @ token points at, for the host to confirm
function absoluteTarget(token: string): string | undefined {
  if (!token.startsWith('/')) {
    return undefined;
  }

  const trimmed = token.replace(TRAILING_PUNCTUATION, '').replace(/\/$/, '');
  return trimmed.length > 1 ? trimmed : undefined;
}

// mark every @ mention in the visible lines that names a real file or folder
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

// complete @ against the workspace or, from a leading slash, the disk, and tint what resolves
export function fileMentions(host: MentionHost): Extension {
  return [
    mentionCatalog,
    verifiedPaths,
    autocompletion({
      override: [(context) => mentionSource(context, host)],
      activateOnCompletion: (completion) => completion.type === 'folder'
    }),
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
          // markdown parses in the background, and skipping code blocks depends on it
          const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);

          if (update.docChanged || update.viewportChanged || pathsChanged || treeChanged) {
            this.decorations = this.scan(update.state, update.view.visibleRanges);
          }
        }

        private scan(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
          const { marks, unverified } = scanMentions(state, ranges);
          if (unverified.length > 0) {
            host.verifyPaths(unverified);
          }
          return marks;
        }
      },
      { decorations: (plugin) => plugin.decorations }
    )
  ];
}
