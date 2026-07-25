// Handles tab at the start of a list bullet, nesting it or lifting it back out
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

// Measure the bullet the cursor sits at the start of, null anywhere else
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

  // Step past the marker and the spaces after it to the content column
  let contentStart = mark.to;
  while (contentStart < line.to && line.text[contentStart - line.from] === ' ') {
    contentStart++;
  }
  if (range.head > contentStart) {
    return null;
  }

  return { lineFrom: line.from, indentWidth: contentStart - mark.from, leadingSpaces };
}

// Indent by the marker and the spaces after it, the width a nested bullet has to reach
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

// Lift the bullet back out one level
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

export const listIndentKeymap: readonly KeyBinding[] = [
  { key: 'Tab', run: indentListItem, shift: outdentListItem }
];
