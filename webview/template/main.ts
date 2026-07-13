import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { GFM } from '@lezer/markdown';

import { codeHighlighting, codeLanguages } from './codeHighlight';
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

// --- setup ---

const vscode = acquireVsCodeApi();

const editorEl = document.getElementById('editor') as HTMLElement;
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
      drawSelection(),
      EditorView.lineWrapping,
      keymap.of([
        ...listIndentKeymap,
        { key: 'Tab', run: insertTab, shift: indentLess },
        ...markdownKeymap,
        ...defaultKeymap,
        ...historyKeymap
      ]),
      markdown({ base: markdownLanguage, extensions: GFM, codeLanguages }),
      codeHighlighting,
      live.of(livePreview())
    ]
  })
});

// --- helpers ---

// swap the note's text into the editor, kept out of the undo history
function setContent(text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: Transaction.addToHistory.of(false)
  });
}

// switch between the inline render and the raw markdown source
function setSourceMode(on: boolean): void {
  sourceMode = on;
  view.dispatch({ effects: live.reconfigure(on ? [] : livePreview()) });
  toggleIcon.className = on ? 'codicon codicon-eye' : 'codicon codicon-code';
  toggleLabel.textContent = on ? 'Rendered' : 'Source';
  view.focus();
}

// --- inbound messages ---

window.addEventListener('message', (event) => {
  const msg = event.data as ContentMessage | undefined;
  if (msg?.type === 'content') {
    vscode.setState({ notePath: msg.notePath, claudeCommand: msg.claudeCommand });
    setContent(msg.text);
  }
});

// --- toolbar ---

toggle.addEventListener('click', () => setSourceMode(!sourceMode));
copy.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: view.state.doc.toString() }));
send.addEventListener('click', () => vscode.postMessage({ type: 'sendToClaude', text: view.state.doc.toString() }));

vscode.postMessage({ type: 'ready' });
