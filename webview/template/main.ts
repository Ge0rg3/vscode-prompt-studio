import { acceptCompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, tooltips } from '@codemirror/view';
import { GFM } from '@lezer/markdown';

import { codeHighlighting, codeLanguages } from './codeHighlight';
import { addVerifiedPaths, fileMentions, MentionEntry, setMentionEntries } from './fileMentions';
import { listIndentKeymap } from './listIndent';
import { livePreview } from './livePreview';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

interface ContentMessage {
  type: 'content';
  text: string;
  notePath: string;
  claudeCommand?: string;
}

interface MentionsMessage {
  type: 'mentions';
  entries: MentionEntry[];
}

interface DirEntriesMessage {
  type: 'dirEntries';
  id: number;
  entries: MentionEntry[];
}

interface VerifiedPathsMessage {
  type: 'verifiedPaths';
  entries: MentionEntry[];
}

type InboundMessage = ContentMessage | MentionsMessage | DirEntriesMessage | VerifiedPathsMessage;

// --- setup ---

const vscode = acquireVsCodeApi();

const pendingDirectories = new Map<number, (entries: MentionEntry[]) => void>();
const checkingPaths = new Set<string>();
let nextRequestId = 1;

const editorEl = document.getElementById('editor') as HTMLElement;
const toolbar = document.getElementById('toolbar') as HTMLElement;
const toggle = document.getElementById('toggle') as HTMLElement;
const toggleIcon = document.getElementById('toggle-icon') as HTMLElement;
const toggleLabel = document.getElementById('toggle-label') as HTMLElement;
const copy = document.getElementById('copy') as HTMLElement;
const send = document.getElementById('send') as HTMLElement;

const live = new Compartment();
let sourceMode = false;

const view = new EditorView({
  parent: editorEl,
  state: EditorState.create({
    doc: '',
    extensions: [
      EditorView.cspNonce.of(document.body.dataset.nonce ?? ''),
      history(),
      EditorView.lineWrapping,
      keymap.of([
        { key: 'Tab', run: acceptCompletion },
        ...listIndentKeymap,
        { key: 'Tab', run: insertTab, shift: indentLess },
        ...markdownKeymap,
        ...defaultKeymap,
        ...historyKeymap
      ]),
      // keep the popup clear of the toolbar
      tooltips({
        tooltipSpace: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: toolbar.getBoundingClientRect().top })
      }),
      markdown({ base: markdownLanguage, extensions: GFM, codeLanguages }),
      codeHighlighting,
      fileMentions({ listDirectory, verifyPaths }),
      live.of(livePreview())
    ]
  })
});

// --- helpers ---

// ask the host to list an absolute directory for the @ popup
function listDirectory(dirPath: string): Promise<MentionEntry[]> {
  const id = nextRequestId++;
  vscode.postMessage({ type: 'listDir', id, dirPath });
  return new Promise((resolve) => pendingDirectories.set(id, resolve));
}

// ask the host which absolute paths exist, skipping any already being checked
function verifyPaths(paths: string[]): void {
  const fresh: string[] = [];
  for (const path of paths) {
    if (!checkingPaths.has(path)) {
      checkingPaths.add(path);
      fresh.push(path);
    }
  }

  if (fresh.length > 0) {
    vscode.postMessage({ type: 'checkPaths', paths: fresh });
  }
}

// swap the note's text into the editor, kept out of the undo history
function setContent(text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: Transaction.addToHistory.of(false)
  });
}

// switch between the inline render and the raw markdown source, the button names the mode on screen
function setSourceMode(on: boolean): void {
  sourceMode = on;
  view.dispatch({ effects: live.reconfigure(on ? [] : livePreview()) });
  toggleIcon.className = on ? 'codicon codicon-code' : 'codicon codicon-eye';
  toggleLabel.textContent = on ? 'Source' : 'Rendered';
  view.focus();
}

// --- inbound messages ---

window.addEventListener('message', (event) => {
  const msg = event.data as InboundMessage | undefined;
  if (msg?.type === 'content') {
    vscode.setState({ notePath: msg.notePath, claudeCommand: msg.claudeCommand });
    setContent(msg.text);
    return;
  }

  if (msg?.type === 'mentions') {
    view.dispatch({ effects: setMentionEntries.of(msg.entries) });
    return;
  }

  // everything the host listed exists, so tint it without asking again
  if (msg?.type === 'dirEntries') {
    pendingDirectories.get(msg.id)?.(msg.entries);
    pendingDirectories.delete(msg.id);
    view.dispatch({ effects: addVerifiedPaths.of(msg.entries) });
    return;
  }

  // clear the guard, so a path that was missing is checked again after the next edit
  if (msg?.type === 'verifiedPaths') {
    checkingPaths.clear();
    view.dispatch({ effects: addVerifiedPaths.of(msg.entries) });
  }
});

// --- toolbar ---

// hold focus in the editor, the native selection only stays lit while the editor has it
toolbar.addEventListener('mousedown', (event) => event.preventDefault());

toggle.addEventListener('click', () => setSourceMode(!sourceMode));
copy.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: view.state.doc.toString() }));
send.addEventListener('click', () => vscode.postMessage({ type: 'sendToClaude', text: view.state.doc.toString() }));

vscode.postMessage({ type: 'ready' });
