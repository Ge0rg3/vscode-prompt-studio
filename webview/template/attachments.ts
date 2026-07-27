// Takes a pasted, dropped, or picked file into the note and keeps the markdown that names it out of sight
import { EditorState, Extension, Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

// One file the note carries, as it is written and as the webview loads it
export interface Attachment {
  reference: string;
  uri: string;
  isImage: boolean;
  size: number;
  from: number;
  to: number;
}

// A stored file and the uri the webview loads it from
export interface ResolvedAttachment {
  reference: string;
  uri: string;
  isImage: boolean;
  size: number;
}

// What the editor asks the extension host for, since only the host can reach the disk
export interface AttachmentHost {
  storeAttachment(name: string, mime: string, base64: string): Promise<string | undefined>;
  reportTooLarge(name: string): void;
  resolveAttachments(references: string[]): void;
  showAttachments(attachments: readonly Attachment[]): void;
}

// Where a markdown reference sits in the note, before the host has said whether it is stored
interface AttachmentMatch {
  reference: string;
  from: number;
  to: number;
}

// What the note names, split by whether the host has placed it yet
interface AttachmentScan {
  attached: Attachment[];
  unresolved: string[];
}

// A whole markdown image or link with the path split out, in step with the twin in src/common/noteAttachments.ts
const ATTACHMENT_REFERENCE = /!?\[[^\]\n]*\]\([ \t]*<?([^)>\s]+)[^)\n]*\)/g;

// A path leading into the hidden folder beside the note
const ATTACHMENTS_PATH = /(^|\/)\.attachments\//;

// The files named with an image link, in step with the twin in src/common/noteAttachments.ts
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

// Skip a file this big rather than encode it, base64 makes it a third bigger again
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// Encode the bytes in chunks, a whole file at once overruns the argument list
const ENCODE_CHUNK_BYTES = 0x8000;

const hiddenReference = Decoration.replace({});

export const addResolvedAttachments = StateEffect.define<readonly ResolvedAttachment[]>();

export const dropResolvedAttachment = StateEffect.define<string>();

// What the host has handed back, keyed by the path written in the note
const resolvedAttachments = StateField.define<ReadonlyMap<string, ResolvedAttachment>>({
  create: () => new Map(),
  update(stored, tr) {
    let next: Map<string, ResolvedAttachment> | undefined;

    for (const effect of tr.effects) {
      if (effect.is(addResolvedAttachments)) {
        next = next ?? new Map(stored);
        for (const entry of effect.value) {
          next.set(entry.reference, entry);
        }
      }

      if (effect.is(dropResolvedAttachment)) {
        next = next ?? new Map(stored);
        next.delete(effect.value);
      }
    }

    return next ?? stored;
  }
});

// --- helpers ---

// Find every markdown reference pointing into the note's own attachments folder
function scanAttachments(state: EditorState): AttachmentMatch[] {
  const matches: AttachmentMatch[] = [];
  for (const match of state.doc.toString().matchAll(ATTACHMENT_REFERENCE)) {
    // Leave an ordinary link alone, only a stored file is worth asking the host about
    if (!ATTACHMENTS_PATH.test(match[1])) {
      continue;
    }

    const at = match.index ?? 0;
    matches.push({ reference: match[1], from: at, to: at + match[0].length });
  }

  return matches;
}

// Split the note's files into the ones the host has placed and the paths it has not answered on
function collectAttachments(state: EditorState): AttachmentScan {
  const stored = state.field(resolvedAttachments);
  const attached: Attachment[] = [];
  const unresolved: string[] = [];

  for (const match of scanAttachments(state)) {
    const resolved = stored.get(match.reference);
    if (resolved) {
      attached.push({ ...match, uri: resolved.uri, isImage: resolved.isImage, size: resolved.size });
      continue;
    }
    unresolved.push(match.reference);
  }

  return { attached, unresolved };
}

// Cover the markdown of every file the strip is already showing
function hideReferences(state: EditorState): DecorationSet {
  const covered: Range<Decoration>[] = [];
  for (const attachment of collectAttachments(state).attached) {
    covered.push(hiddenReference.range(attachment.from, attachment.to));
  }

  return Decoration.set(covered, true);
}

// Test whether the resolved files changed across an update
function hasResolvedChanged(update: ViewUpdate): boolean {
  return update.startState.field(resolvedAttachments) !== update.state.field(resolvedAttachments);
}

// Test whether a line holds nothing but stored files
function isAttachmentLine(text: string): boolean {
  let rest = '';
  let at = 0;

  for (const match of text.matchAll(ATTACHMENT_REFERENCE)) {
    if (!ATTACHMENTS_PATH.test(match[1])) {
      continue;
    }

    const start = match.index ?? 0;
    rest += text.slice(at, start);
    at = start + match[0].length;
  }

  return (rest + text.slice(at)).trim().length === 0;
}

// Take the files out of a paste or a drop, reporting whatever is too big to carry
function takeAttachableFiles(pasteOrDrop: DataTransfer | null, host: AttachmentHost): File[] {
  const files: File[] = [];
  if (!pasteOrDrop) {
    return files;
  }

  // Step the list by index, the webview's DOM lib gives a FileList no iterator
  for (let at = 0; at < pasteOrDrop.files.length; at++) {
    const file = pasteOrDrop.files[at];
    if (file.size > MAX_ATTACHMENT_BYTES) {
      host.reportTooLarge(file.name);
      continue;
    }
    files.push(file);
  }

  return files;
}

// Turn a file into the base64 the host decodes, since a message carries no bytes
async function encodeFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += ENCODE_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(at, at + ENCODE_CHUNK_BYTES));
  }

  return btoa(binary);
}

// Store each file the host accepts, in the order they arrived
async function attachFiles(view: EditorView, files: readonly File[], host: AttachmentHost): Promise<void> {
  for (const file of files) {
    // A folder dragged in reads as a file the browser then refuses, so it is skipped
    try {
      const reference = await host.storeAttachment(file.name, file.type, await encodeFile(file));
      if (reference) {
        appendAttachment(view, reference);
      }
    } catch {
      continue;
    }
  }
}

// Take a pasted or dropped file in before CodeMirror reads it as text
function attachmentDropHandlers(host: AttachmentHost): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = takeAttachableFiles(event.clipboardData, host);
      if (files.length === 0) {
        return false;
      }

      void attachFiles(view, files, host);
      return true;
    },

    // Take the drag, so the drop lands in the editor
    dragover(event) {
      if (!event.dataTransfer?.types.includes('Files')) {
        return false;
      }

      event.preventDefault();
      return true;
    },

    // Claim every file drop, since CodeMirror otherwise reads the file in as text
    drop(event, view) {
      if (!event.dataTransfer?.files.length) {
        return false;
      }

      const files = takeAttachableFiles(event.dataTransfer, host);
      if (files.length > 0) {
        void attachFiles(view, files, host);
      }
      return true;
    }
  });
}

// Hand the host what the note names, so the strip and the stored files keep up with the text
function attachmentPublisher(host: AttachmentHost): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.reportAttachments(view.state);
      }

      private reportAttachments(state: EditorState): void {
        const { attached, unresolved } = collectAttachments(state);
        if (unresolved.length > 0) {
          host.resolveAttachments(unresolved);
        }
        host.showAttachments(attached);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || hasResolvedChanged(update)) {
          this.reportAttachments(update.state);
        }
      }
    }
  );
}

// --- exports ---

// Name a stored file at the end of the note, clear of whatever is being written
export function appendAttachment(view: EditorView, reference: string): void {
  const name = reference.slice(reference.lastIndexOf('/') + 1);
  const stem = name.replace(/\.[^.]*$/, '');
  const markdown = IMAGE_EXTENSIONS.test(name) ? `![${stem}](${reference})` : `[${name}](${reference})`;

  const doc = view.state.doc;
  const lastLine = doc.line(doc.lines);
  let spacer = '\n';
  if (lastLine.length === 0) {
    spacer = '';
  } else if (isAttachmentLine(lastLine.text)) {
    spacer = ' ';
  }

  // Hold the cursor where the writer left it, the reference is not theirs to type around
  view.dispatch({
    changes: { from: doc.length, insert: `${spacer}${markdown}` },
    selection: view.state.selection
  });
}

// Hold what the host resolves, take pasted files in, and keep the strip in step with the note
export function noteAttachments(host: AttachmentHost): Extension {
  return [resolvedAttachments, attachmentDropHandlers(host), attachmentPublisher(host)];
}

// Cover the markdown naming each stored file, so the note reads as the text around it
export function hideAttachmentMarkdown(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = hideReferences(view.state);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || hasResolvedChanged(update)) {
          this.decorations = hideReferences(update.state);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,

      // Step the cursor over the hidden markdown rather than through it
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none)
    }
  );
}

// Take a file out of the note, and the line with it when nothing else is on it
export function removeAttachment(view: EditorView, attachment: Attachment): void {
  const line = view.state.doc.lineAt(attachment.from);
  const isOnOwnLine = line.from === attachment.from && line.to === attachment.to && line.from > 0;

  view.dispatch({
    changes: { from: isOnOwnLine ? line.from - 1 : attachment.from, to: attachment.to, insert: '' }
  });
}
