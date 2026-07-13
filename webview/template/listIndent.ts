import { syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { Command, KeyBinding } from '@codemirror/view';
import { SyntaxNode } from '@lezer/common';

interface ListItemStart {
  lineFrom: number;
  indentWidth: number;
  leadingSpaces: number;
}

// --- helpers ---

// the list item the cursor sits at the start of, measured for indenting
function listItemStart(state: EditorState): ListItemStart | null {
  const range = state.selection.main;
  if (!range.empty) {
    return null;
  }

  const line = state.doc.lineAt(range.head);
  const leadingSpaces = line.text.length - line.text.trimStart().length;

  let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from + leadingSpaces, 1);
  while (node && node.name !== 'ListItem') {
    node = node.parent;
  }

  const mark = node?.getChild('ListMark');
  if (!mark) {
    return null;
  }

  // the content column, past the marker and the space after it
  let contentStart = mark.to;
  while (contentStart < line.to && line.text[contentStart - line.from] === ' ') {
    contentStart++;
  }
  if (range.head > contentStart) {
    return null;
  }

  return { lineFrom: line.from, indentWidth: contentStart - mark.from, leadingSpaces };
}

// indent by the marker width, the column a nested bullet has to reach to count as nested
const indentListItem: Command = (view) => {
  const item = listItemStart(view.state);
  if (!item) {
    return false;
  }

  const insert = ' '.repeat(item.indentWidth);
  view.dispatch({
    changes: { from: item.lineFrom, insert },
    selection: EditorSelection.cursor(view.state.selection.main.head + insert.length),
    scrollIntoView: true,
    userEvent: 'input.indent'
  });
  return true;
};

// lift the bullet back out one level
const outdentListItem: Command = (view) => {
  const item = listItemStart(view.state);
  if (!item || item.leadingSpaces === 0) {
    return false;
  }

  const removed = Math.min(item.indentWidth, item.leadingSpaces);
  const head = view.state.selection.main.head;
  view.dispatch({
    changes: { from: item.lineFrom, to: item.lineFrom + removed },
    selection: EditorSelection.cursor(Math.max(item.lineFrom, head - removed)),
    scrollIntoView: true,
    userEvent: 'delete.dedent'
  });
  return true;
};

// --- exports ---

// at the start of a bullet, tab nests it and shift-tab lifts it back out
export const listIndentKeymap: readonly KeyBinding[] = [
  { key: 'Tab', run: indentListItem, shift: outdentListItem }
];
