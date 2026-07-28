// Runs the find and replace widget over the template editor, drawn the way the VSCode one is
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search';
import { EditorState, Extension, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Panel, ViewUpdate } from '@codemirror/view';

import { AttachmentRange, attachmentRanges } from './attachments';

// Stop counting here, a long note searched for one letter would otherwise walk every match
const MAX_COUNTED_MATCHES = 999;

// The attribute CodeMirror's search panel looks for when ctrl+f reaches a widget already open
const MAIN_FIELD_ATTRIBUTE = 'main-field';

// Open or close the replace row
const setReplaceShown = StateEffect.define<boolean>();

const isReplaceShown = StateField.define<boolean>({
  create: () => false,
  update(shown, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setReplaceShown)) {
        return effect.value;
      }
    }
    return shown;
  }
});

// --- helpers ---

// Keep the attachment spans from the last scan, beside the state they were taken from
let scannedState: EditorState | undefined;
let scannedAttachmentRanges: readonly AttachmentRange[] = [];

// Leave the markdown naming a stored file alone, rewriting the path deletes the file off disk
function isOutsideAttachments(_match: string, state: EditorState, from: number, to: number): boolean {
  if (state !== scannedState) {
    scannedState = state;
    scannedAttachmentRanges = attachmentRanges(state);
  }

  for (const range of scannedAttachmentRanges) {
    if (from < range.to && to > range.from) {
      return false;
    }
  }

  return true;
}

// Read whether a toggle button is lit
function isPressed(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-pressed') === 'true';
}

// Light a toggle button, or put it out
function setPressed(button: HTMLButtonElement, on: boolean): void {
  button.setAttribute('aria-pressed', String(on));
}

// Build the codicon a button carries, on a span since a webview forces its own font on a control
function glyph(icon: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `codicon ${icon}`;
  return span;
}

// Build one of the small square buttons the widget is made of
function iconButton(icon: HTMLElement, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'find-button';
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  button.appendChild(icon);
  return button;
}

// Build a button that stays lit while its search option is on
function toggleButton(icon: HTMLElement, title: string, onToggle: () => void): HTMLButtonElement {
  const button = iconButton(icon, title, () => {
    setPressed(button, !isPressed(button));
    onToggle();
  });

  button.classList.add('find-toggle');
  setPressed(button, false);
  return button;
}

// Build one of the widget's text fields
function textField(label: string): HTMLInputElement {
  const field = document.createElement('input');
  field.className = 'find-field';
  field.type = 'text';
  field.placeholder = label;
  field.setAttribute('aria-label', label);
  return field;
}

// Build a box holding the given parts
function container(className: string, parts: readonly HTMLElement[]): HTMLElement {
  const box = document.createElement('div');
  box.className = className;
  box.append(...parts);
  return box;
}

// --- exports ---

// Move to the next or previous match, putting the caret in the find field back where it was
export function stepFindMatch(view: EditorView, forward: boolean): boolean {
  const field = view.dom.querySelector<HTMLInputElement>(`[${MAIN_FIELD_ATTRIBUTE}]`);
  const caret = field?.selectionEnd ?? 0;

  const moved = forward ? findNext(view) : findPrevious(view);

  // Stepping selects the whole query, and the next keystroke would then wipe what was typed
  field?.setSelectionRange(caret, caret);
  return moved;
}

// The widget itself, a row holding the query and a second holding the replacement
class FindPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;

  private readonly view: EditorView;
  private readonly findField = textField('Find');
  private readonly replaceField = textField('Replace');
  private readonly caseToggle: HTMLButtonElement;
  private readonly wordToggle: HTMLButtonElement;
  private readonly regexpToggle: HTMLButtonElement;
  private readonly findBox: HTMLElement;
  private readonly countLabel: HTMLElement;
  private readonly expandButton: HTMLButtonElement;
  private readonly expandIcon: HTMLElement;
  private query: SearchQuery;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);

    // Build the find row, its options inside the box and the count and the arrows beside it
    this.caseToggle = toggleButton(glyph('codicon-case-sensitive'), 'Match Case', () => this.searchAgain());
    this.wordToggle = toggleButton(glyph('codicon-whole-word'), 'Match Whole Word', () => this.searchAgain());
    this.regexpToggle = toggleButton(glyph('codicon-regex'), 'Use Regular Expression', () => this.searchAgain());
    this.findField.setAttribute(MAIN_FIELD_ATTRIBUTE, 'true');
    this.findField.addEventListener('input', () => this.searchAgain());
    this.findBox = container('find-box', [this.findField, this.caseToggle, this.wordToggle, this.regexpToggle]);

    this.countLabel = document.createElement('span');
    this.countLabel.className = 'find-count';
    const findRow = container('find-row', [
      this.findBox,
      this.countLabel,
      iconButton(glyph('codicon-arrow-up'), 'Previous Match', () => stepFindMatch(view, false)),
      iconButton(glyph('codicon-arrow-down'), 'Next Match', () => stepFindMatch(view, true)),
      iconButton(glyph('codicon-close'), 'Close', () => closeSearchPanel(view))
    ]);

    // Build the replace row, hidden until the chevron opens it
    this.replaceField.addEventListener('input', () => this.pushQuery());
    const replaceRow = container('find-row find-replace-row', [
      container('find-box', [this.replaceField]),
      iconButton(glyph('codicon-replace'), 'Replace', () => replaceNext(view)),
      iconButton(glyph('codicon-replace-all'), 'Replace All', () => replaceAll(view))
    ]);

    // Build the chevron standing beside both rows
    this.expandIcon = glyph('codicon-chevron-right');
    this.expandButton = iconButton(this.expandIcon, 'Toggle Replace', () => this.toggleReplaceRow());
    this.expandButton.classList.add('find-expand');

    this.dom = container('find-widget', [this.expandButton, container('find-rows', [findRow, replaceRow])]);
    this.dom.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  // Push what the fields hold into the search state, false when nothing changed
  private pushQuery(): boolean {
    const query = new SearchQuery({
      search: this.findField.value,
      replace: this.replaceField.value,
      caseSensitive: isPressed(this.caseToggle),
      wholeWord: isPressed(this.wordToggle),
      regexp: isPressed(this.regexpToggle),
      test: isOutsideAttachments
    });

    if (query.eq(this.query)) {
      return false;
    }

    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
    return true;
  }

  // Look again from where the caret sits, or a query growing a letter at a time walks down the note
  private searchAgain(): void {
    if (!this.pushQuery() || !this.query.valid) {
      return;
    }

    this.view.dispatch({ selection: { anchor: this.view.state.selection.main.from } });
    stepFindMatch(this.view, true);
  }

  private toggleReplaceRow(): void {
    this.view.dispatch({ effects: setReplaceShown.of(!this.view.state.field(isReplaceShown)) });
  }

  // Step through the matches on enter, and replace on enter in the replacement field
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return;
    }

    if (event.target === this.findField) {
      event.preventDefault();
      stepFindMatch(this.view, !event.shiftKey);
      return;
    }

    if (event.target === this.replaceField) {
      event.preventDefault();
      const replace = event.ctrlKey || event.metaKey ? replaceAll : replaceNext;
      replace(this.view);
    }
  }

  // Write a query set outside the widget into the fields
  private showQuery(query: SearchQuery): void {
    this.query = query;
    this.findField.value = query.search;
    setPressed(this.caseToggle, query.caseSensitive);
    setPressed(this.wordToggle, query.wholeWord);
    setPressed(this.regexpToggle, query.regexp);

    // Wait for the seeded query to land, then put the widget's own back with its filter and replacement
    setTimeout(() => this.pushQuery(), 0);
  }

  // Count what the query matches and say which one the selection sits on
  private matchCountLabel(state: EditorState, query: SearchQuery): string {
    if (!query.valid) {
      return '';
    }

    const selectedRange = state.selection.main;
    const cursor = query.getCursor(state);
    let total = 0;
    let currentIndex = 0;

    for (let match = cursor.next(); !match.done; match = cursor.next()) {
      total++;
      if (match.value.from === selectedRange.from && match.value.to === selectedRange.to) {
        currentIndex = total;
      }
      if (total > MAX_COUNTED_MATCHES) {
        break;
      }
    }

    if (total === 0) {
      return 'No results';
    }

    const totalLabel = total > MAX_COUNTED_MATCHES ? `${MAX_COUNTED_MATCHES}+` : `${total}`;
    return currentIndex === 0 ? `${totalLabel} results` : `${currentIndex} of ${totalLabel}`;
  }

  // Show the match count, and put the red box on a regular expression that will not parse
  private showMatchCount(state: EditorState, query: SearchQuery): void {
    this.countLabel.textContent = this.matchCountLabel(state, query);
    this.findBox.classList.toggle('find-invalid', query.search.length > 0 && !query.valid);
  }

  // Open or close the replace row, turning the chevron with it
  private showReplaceRow(shown: boolean): void {
    this.dom.classList.toggle('find-expanded', shown);
    this.expandIcon.className = `codicon codicon-chevron-${shown ? 'down' : 'right'}`;
    this.expandButton.setAttribute('aria-expanded', String(shown));
  }

  mount(): void {
    const query = getSearchQuery(this.view.state);
    this.showQuery(query);
    this.showReplaceRow(this.view.state.field(isReplaceShown));
    this.showMatchCount(this.view.state, query);

    this.findField.focus();
    this.findField.select();
  }

  update(update: ViewUpdate): void {
    const query = getSearchQuery(update.state);

    // Ctrl+F seeds the query from the selection, so a query can arrive from outside the fields
    if (!query.eq(this.query)) {
      this.showQuery(query);
    }

    const shown = update.state.field(isReplaceShown);
    if (shown !== update.startState.field(isReplaceShown)) {
      this.showReplaceRow(shown);
    }

    if (!query.eq(getSearchQuery(update.startState)) || update.docChanged || update.selectionSet) {
      this.showMatchCount(update.state, query);
    }
  }
}

// Put the widget up with or without the replace row, or take it down when it is already up
export function toggleFindWidget(view: EditorView, withReplace: boolean): boolean {
  if (searchPanelOpen(view.state)) {
    return closeSearchPanel(view);
  }

  view.dispatch({ effects: setReplaceShown.of(withReplace) });
  return openSearchPanel(view);
}

// Search the note from a widget over the editor, every match tinted while it is open
export function findReplace(): Extension {
  return [isReplaceShown, search({ createPanel: (view) => new FindPanel(view) })];
}
