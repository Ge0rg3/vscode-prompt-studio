// Styles the markdown in the editor so it reads as rendered text while it is edited
import { syntaxTree } from '@codemirror/language';
import { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

// A mark class for the styled content of each inline node
const CONTENT_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-strong',
  Emphasis: 'cm-em',
  Strikethrough: 'cm-strike',
  InlineCode: 'cm-inline-code',
  Link: 'cm-link',
  Autolink: 'cm-link',
  URL: 'cm-link'
};

// The punctuation tokens dimmed but left visible
const SYNTAX_MARK = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'QuoteMark', 'ListMark']);

// --- helpers ---

// Tag every line a block node spans, not just the line it starts on
function lineClasses(state: EditorState, from: number, to: number, className: string): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(Math.max(from, to - 1)).number;
  for (let n = first; n <= last; n++) {
    out.push(Decoration.line({ class: className }).range(state.doc.line(n).from));
  }
  return out;
}

// Style every markdown node the given ranges cover
function computeDecorations(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (SYNTAX_MARK.has(node.name)) {
          decorations.push(Decoration.mark({ class: 'cm-syntax' }).range(node.from, node.to));
          return;
        }

        const content = CONTENT_CLASS[node.name];
        if (content) {
          decorations.push(Decoration.mark({ class: content }).range(node.from, node.to));
          return;
        }

        switch (node.name) {
          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6': {
            const line = state.doc.lineAt(node.from);
            decorations.push(Decoration.line({ class: `cm-heading cm-h${node.name.slice(-1)}` }).range(line.from));
            return;
          }
          case 'ListItem':
            decorations.push(Decoration.line({ class: 'cm-list' }).range(state.doc.lineAt(node.from).from));
            return;
          case 'Blockquote':
            decorations.push(...lineClasses(state, node.from, node.to, 'cm-blockquote'));
            return;
          case 'FencedCode':
            decorations.push(...lineClasses(state, node.from, node.to, 'cm-code-block'));
            return false;
          case 'HorizontalRule':
            decorations.push(Decoration.line({ class: 'cm-hr' }).range(state.doc.lineAt(node.from).from));
            return;
          case 'Image':
          case 'Table':
            return false;
        }
      }
    });
  }

  return Decoration.set(decorations, true);
}

// --- exports ---

// Style the markdown inline while leaving every syntax mark visible
export function livePreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = computeDecorations(view.state, view.visibleRanges);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = computeDecorations(update.view.state, update.view.visibleRanges);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}
