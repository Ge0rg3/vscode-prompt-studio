// Builds the template editor's CodeMirror view and wires it to the host and the toolbar
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { closeSearchPanel } from '@codemirror/search';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, tooltips } from '@codemirror/view';
import { GFM } from '@lezer/markdown';

import { createAttachmentStrip } from './attachmentStrip';
import {
  addResolvedAttachments,
  appendAttachment,
  Attachment,
  AttachmentHost,
  dropResolvedAttachment,
  hideAttachmentMarkdown,
  noteAttachments,
  removeAttachment,
  ResolvedAttachment
} from './attachments';
import { codeHighlighting, codeLanguages } from './codeHighlight';
import { DirectoryCache } from './directoryCache';
import { addVerifiedPaths, fileMentions, MentionEntry, setMentionEntries } from './fileMentions';
import { findReplace, stepFindMatch, toggleFindWidget } from './findReplace';
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

interface SavedMessage {
  type: 'saved';
  text: string;
}

interface AttachedMessage {
  type: 'attached';
  id: number;
  reference?: string;
}

interface AttachedFromDiskMessage {
  type: 'attachedFromDisk';
  references: string[];
}

interface ResolvedAttachmentsMessage {
  type: 'resolvedAttachments';
  entries: ResolvedAttachment[];
}

type InboundMessage =
  | ContentMessage
  | MentionsMessage
  | DirEntriesMessage
  | VerifiedPathsMessage
  | SavedMessage
  | AttachedMessage
  | AttachedFromDiskMessage
  | ResolvedAttachmentsMessage;

// The webview state kept across a window reload, with any unsaved text
interface PersistedState {
  notePath: string;
  claudeCommand?: string;
  text: string;
}

// A folder listing request waiting for its reply, resolved with undefined when the timer fires first
interface PendingDirectory {
  resolve: (entries: MentionEntry[] | undefined) => void;
  timer: number;
}

const LIST_TIMEOUT_MS = 8000;
const VERIFY_DEBOUNCE_MS = 200;

// macOS uses cmd for shortcuts, and keeps ctrl+f and ctrl+h for moving and deleting a character
const isMac = navigator.userAgent.includes('Mac');

// --- setup ---

const vscode = acquireVsCodeApi();

const pendingDirectories = new Map<number, PendingDirectory>();
const directoryCache = new DirectoryCache(fetchDirectory);
const checkingPaths = new Set<string>();
const queuedPaths = new Set<string>();
const pendingAttachments = new Map<number, (reference: string | undefined) => void>();
const requestedAttachments = new Set<string>();
let nextRequestId = 1;
let verifyTimer: number | undefined;

const editorEl = document.getElementById('editor') as HTMLElement;
const toolbar = document.getElementById('toolbar') as HTMLElement;
const toggle = document.getElementById('toggle') as HTMLElement;
const toggleIcon = document.getElementById('toggle-icon') as HTMLElement;
const toggleLabel = document.getElementById('toggle-label') as HTMLElement;
const save = document.getElementById('save') as HTMLElement;
const copy = document.getElementById('copy') as HTMLElement;
const send = document.getElementById('send') as HTMLElement;
const attach = document.getElementById('attach') as HTMLElement;
const attachmentStrip = document.getElementById('attachments') as HTMLElement;

const persisted = vscode.getState() as PersistedState | undefined;

const live = new Compartment();
const drawAttachments = createAttachmentStrip(attachmentStrip, (attachment: Attachment) =>
  removeAttachment(view, attachment)
);
const attachmentHost: AttachmentHost = {
  storeAttachment,
  reportTooLarge,
  resolveAttachments: requestAttachments,
  showAttachments
};

// What the rendered mode adds on top of the plain source
const renderedMarkdown = [livePreview(), hideAttachmentMarkdown()];

let attachedReferences = new Set<string>();
let isSourceMode = false;
let isLoading = false;
let notePath = '';
let claudeCommand: string | undefined;
let savedText = '';
let isDirty = false;

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

      // Keep the popup clear of the toolbar
      tooltips({
        tooltipSpace: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: toolbar.getBoundingClientRect().top })
      }),
      markdown({ base: markdownLanguage, extensions: GFM, codeLanguages }),
      codeHighlighting,
      fileMentions({
        listDirectory: (dirPath) => directoryCache.list(dirPath),
        cachedDirectory: (dirPath) => directoryCache.cached(dirPath),
        prefetchDirectory: (dirPath) => directoryCache.prefetch(dirPath),
        verifyPaths,
        openMention: (mentionPath) => vscode.postMessage({ type: 'openMention', path: mentionPath })
      }),
      noteAttachments(attachmentHost),
      findReplace(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !isLoading) {
          onDocChanged();
        }
      }),
      live.of(renderedMarkdown)
    ]
  })
});

// --- helpers ---

// Ask the host to list an absolute directory, undefined when the reply never lands
function fetchDirectory(dirPath: string): Promise<MentionEntry[] | undefined> {
  const id = nextRequestId++;
  vscode.postMessage({ type: 'listDir', id, dirPath });
  return new Promise((resolve) => {
    const timer = setTimeout(() => settleDirectory(id, undefined), LIST_TIMEOUT_MS);
    pendingDirectories.set(id, { resolve, timer });
  });
}

// Finish a waiting folder listing request, with undefined when it timed out
function settleDirectory(id: number, entries: MentionEntry[] | undefined): void {
  const pending = pendingDirectories.get(id);
  if (!pending) {
    return;
  }

  pendingDirectories.delete(id);
  clearTimeout(pending.timer);
  pending.resolve(entries);
}

// Queue paths for one existence check once the scans settle
function verifyPaths(paths: string[]): void {
  let hasQueued = false;
  for (const path of paths) {
    if (!checkingPaths.has(path)) {
      checkingPaths.add(path);
      queuedPaths.add(path);
      hasQueued = true;
    }
  }

  if (!hasQueued) {
    return;
  }

  clearTimeout(verifyTimer);
  verifyTimer = setTimeout(() => {
    vscode.postMessage({ type: 'checkPaths', paths: [...queuedPaths] });
    queuedPaths.clear();
  }, VERIFY_DEBOUNCE_MS);
}

// Ask the host to store a file beside the note, undefined when it could not be written
function storeAttachment(name: string, mime: string, base64: string): Promise<string | undefined> {
  const id = nextRequestId++;
  vscode.postMessage({ type: 'attachFile', id, name, mime, base64 });
  return new Promise((resolve) => pendingAttachments.set(id, resolve));
}

// Report a file the editor skipped for its size
function reportTooLarge(name: string): void {
  vscode.postMessage({ type: 'attachmentTooLarge', name });
}

// Ask the host where a file sits, once per reference so a broken one is not asked about again
function requestAttachments(references: string[]): void {
  const unrequested: string[] = [];
  for (const reference of references) {
    if (!requestedAttachments.has(reference)) {
      requestedAttachments.add(reference);
      unrequested.push(reference);
    }
  }

  if (unrequested.length > 0) {
    vscode.postMessage({ type: 'resolveAttachments', references: unrequested });
  }
}

// Forget where a file sat, so putting its reference back asks the host about it again
function forgetAttachment(reference: string): void {
  requestedAttachments.delete(reference);

  // The strip is drawn mid-update, so the effect waits for that update to finish
  setTimeout(() => view.dispatch({ effects: dropResolvedAttachment.of(reference) }), 0);
}

// Draw the strip, and tell the host to bin whatever the note has stopped naming
function showAttachments(attached: readonly Attachment[]): void {
  const references = new Set(attached.map((attachment) => attachment.reference));

  // Only an edit takes a file off, a fresh load just brings the note in
  if (!isLoading) {
    for (const removed of attachedReferences) {
      if (references.has(removed)) {
        continue;
      }

      vscode.postMessage({ type: 'dropAttachment', reference: removed });
      forgetAttachment(removed);
    }
  }

  attachedReferences = references;
  drawAttachments(attached);
}

// Swap the note's text into the editor, kept out of the undo history and the modified check
function setContent(text: string): void {
  isLoading = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: Transaction.addToHistory.of(false)
  });
  isLoading = false;
}

// Ask the host to write the editor's text over the note
function saveNote(): void {
  vscode.postMessage({ type: 'save', text: view.state.doc.toString() });
}

// Match a ctrl or cmd shortcut on key and on code, so any keyboard layout reaches it
function isCtrlOrCmdShortcut(event: KeyboardEvent, letter: string): boolean {
  const held = (isMac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey;
  return held && (event.key.toLowerCase() === letter || event.code === `Key${letter.toUpperCase()}`);
}

// Match the replace shortcut, cmd+alt+f on macOS and ctrl+h everywhere else
function isReplaceShortcut(event: KeyboardEvent): boolean {
  if (!isMac) {
    return isCtrlOrCmdShortcut(event, 'h');
  }

  // Alt rewrites the key on macOS, so only the physical key says which one was pressed
  return event.metaKey && event.altKey && !event.shiftKey && event.code === 'KeyF';
}

// Run the find shortcut the event names, false when it names none
function runFindShortcut(event: KeyboardEvent): boolean {
  if (isCtrlOrCmdShortcut(event, 'f')) {
    return toggleFindWidget(view, false);
  }

  if (isReplaceShortcut(event)) {
    return toggleFindWidget(view, true);
  }

  // Take the key even with nothing to step to, or it carries on out of the webview
  if (event.key === 'F3') {
    stepFindMatch(view, !event.shiftKey);
    return true;
  }

  // The mention popup is the innermost thing open, so escape closes that one first
  if (event.key === 'Escape') {
    return completionStatus(view.state) === null && closeSearchPanel(view);
  }

  return false;
}

// Refresh the modified marker and store the text after each edit
function onDocChanged(): void {
  setDirty(view.state.doc.toString() !== savedText);
  persist();
}

// Tell the host to add or drop the tab's modified marker
function setDirty(next: boolean): void {
  if (next === isDirty) {
    return;
  }

  isDirty = next;
  vscode.postMessage({ type: 'dirty', dirty: isDirty });
}

// Keep the current text in webview state so a reload restores unsaved edits
function persist(): void {
  vscode.setState({ notePath, claudeCommand, text: view.state.doc.toString() });
}

// Switch between the rendered markdown and the raw source, the button names the mode on screen
function setSourceMode(on: boolean): void {
  isSourceMode = on;
  view.dispatch({ effects: live.reconfigure(on ? [] : renderedMarkdown) });
  toggleIcon.className = on ? 'codicon codicon-code' : 'codicon codicon-eye';
  toggleLabel.textContent = on ? 'Source' : 'Rendered';
  view.focus();
}

// --- inbound messages ---

// Act on one message from the extension host
function handleHostMessage(msg: InboundMessage | undefined): void {
  if (msg?.type === 'content') {
    notePath = msg.notePath;
    claudeCommand = msg.claudeCommand;

    // Take the baseline from the editor, CodeMirror can normalize the text on load
    setContent(msg.text);
    savedText = view.state.doc.toString();

    // Put back the unsaved text from before the reload
    const buffer = typeof persisted?.text === 'string' ? persisted.text : undefined;
    if (buffer !== undefined && buffer !== savedText) {
      setContent(buffer);
    }

    setDirty(view.state.doc.toString() !== savedText);
    persist();
    return;
  }

  // Reset the baseline to what actually reached disk once the write lands
  if (msg?.type === 'saved') {
    savedText = msg.text;
    setDirty(view.state.doc.toString() !== savedText);
    return;
  }

  if (msg?.type === 'mentions') {
    view.dispatch({ effects: setMentionEntries.of(msg.entries) });
    return;
  }

  if (msg?.type === 'dirEntries') {
    settleDirectory(msg.id, msg.entries);
    return;
  }

  // Forget which paths were checked, so a missing one is checked again after the next edit
  if (msg?.type === 'verifiedPaths') {
    checkingPaths.clear();
    view.dispatch({ effects: addVerifiedPaths.of(msg.entries) });
    return;
  }

  if (msg?.type === 'attached') {
    pendingAttachments.get(msg.id)?.(msg.reference);
    pendingAttachments.delete(msg.id);
    return;
  }

  // A picked file is named the way a pasted one is, so it goes on the end the same way
  if (msg?.type === 'attachedFromDisk') {
    for (const reference of msg.references) {
      appendAttachment(view, reference);
    }

    // The dialog took focus off the editor, and the caret only shows while it holds it
    view.focus();
    return;
  }

  // An answer with nothing in it changes no decoration, and dispatching it would ask again
  if (msg?.type === 'resolvedAttachments' && msg.entries.length > 0) {
    view.dispatch({ effects: addResolvedAttachments.of(msg.entries) });
  }
}

window.addEventListener('message', (event) => handleHostMessage(event.data as InboundMessage | undefined));

// --- toolbar ---

// Hold focus in the editor, the selection only stays lit while the editor has it
toolbar.addEventListener('mousedown', (event) => event.preventDefault());
attachmentStrip.addEventListener('mousedown', (event) => event.preventDefault());

toggle.addEventListener('click', () => setSourceMode(!isSourceMode));
attach.addEventListener('click', () => vscode.postMessage({ type: 'attachFromDisk' }));
save.addEventListener('click', saveNote);
copy.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: view.state.doc.toString() }));
send.addEventListener('click', () => vscode.postMessage({ type: 'sendToClaude', text: view.state.doc.toString() }));

// Catch keys on the way down, the editor only holds focus once the note has been clicked
window.addEventListener(
  'keydown',
  (event) => {
    if (isCtrlOrCmdShortcut(event, 's')) {
      event.preventDefault();
      saveNote();
      return;
    }

    // Stop the key here, VSCode's own find shortcuts pick it up otherwise
    if (runFindShortcut(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true
);

vscode.postMessage({ type: 'ready' });
