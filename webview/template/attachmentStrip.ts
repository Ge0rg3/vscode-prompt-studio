// Lists the files the note carries as chips above the toolbar
import { Attachment } from './attachments';

// One codicon and the extensions drawn with it
interface FileIcon {
  icon: string;
  extensions: readonly string[];
}

// The extensions that read as source code
const CODE_EXTENSIONS: readonly string[] = [
  'ts', 'tsx', 'js', 'jsx', 'py', 'json', 'html', 'css', 'scss', 'yml',
  'yaml', 'sh', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'sql'
];

// The codicon each kind of file is drawn with, by extension
const FILE_ICONS: readonly FileIcon[] = [
  { icon: 'codicon-file-pdf', extensions: ['pdf'] },
  { icon: 'codicon-file-zip', extensions: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar'] },
  { icon: 'codicon-file-media', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'm4a', 'ogg', 'flac'] },
  { icon: 'codicon-file-code', extensions: CODE_EXTENSIONS },
  { icon: 'codicon-file-text', extensions: ['txt', 'md', 'rtf', 'log', 'csv'] }
];

const PLAIN_FILE_ICON = 'codicon-file';

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

// --- helpers ---

// Take the filename the chip is labelled with
function labelFor(attachment: Attachment): string {
  return attachment.reference.slice(attachment.reference.lastIndexOf('/') + 1);
}

// Pick the glyph that stands in for a file the webview cannot draw
function iconFor(filename: string): string {
  // A name with no dot past its first character has no extension to go on
  const dot = filename.lastIndexOf('.');
  if (dot < 1) {
    return PLAIN_FILE_ICON;
  }

  const extension = filename.slice(dot + 1).toLowerCase();
  for (const entry of FILE_ICONS) {
    if (entry.extensions.includes(extension)) {
      return entry.icon;
    }
  }

  return PLAIN_FILE_ICON;
}

// Write a byte count the way a file listing does
function formatSize(bytes: number): string {
  if (bytes < BYTES_PER_KB) {
    return `${bytes} B`;
  }
  if (bytes < BYTES_PER_MB) {
    return `${Math.round(bytes / BYTES_PER_KB)} KB`;
  }
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

// Build the picture or the icon at the head of a chip, and fill in the size beside it
function buildPreview(attachment: Attachment, sizeLabel: HTMLElement): HTMLElement {
  if (!attachment.isImage) {
    const icon = document.createElement('span');
    icon.className = `codicon ${iconFor(labelFor(attachment))} attachment-icon`;
    sizeLabel.textContent = formatSize(attachment.size);
    return icon;
  }

  const thumbnail = document.createElement('img');
  thumbnail.className = 'attachment-thumbnail';
  thumbnail.addEventListener('load', () => {
    sizeLabel.textContent = `${thumbnail.naturalWidth}\u00d7${thumbnail.naturalHeight}`;
  });
  thumbnail.src = attachment.uri;
  return thumbnail;
}

// Build one chip, from its preview through to the button that takes the file off
function buildChip(attachment: Attachment, onRemove: () => void): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'attachment';

  const sizeLabel = document.createElement('span');
  sizeLabel.className = 'attachment-size';
  const preview = buildPreview(attachment, sizeLabel);

  const label = document.createElement('span');
  label.className = 'attachment-name';
  label.textContent = labelFor(attachment);

  const removeButton = document.createElement('button');
  removeButton.className = 'attachment-remove';
  removeButton.type = 'button';
  removeButton.title = `Remove ${labelFor(attachment)}`;
  removeButton.addEventListener('click', onRemove);

  // The glyph goes on a span, a webview forces its own font on a control
  const glyph = document.createElement('span');
  glyph.className = 'codicon codicon-close';
  removeButton.appendChild(glyph);

  chip.append(preview, label, sizeLabel, removeButton);
  return chip;
}

// --- exports ---

// Draw the strip, redrawing only when the files themselves change so the thumbnails hold still
export function createAttachmentStrip(
  stripElement: HTMLElement,
  onRemove: (attachment: Attachment) => void
): (attachments: readonly Attachment[]) => void {
  let shownAttachments: readonly Attachment[] = [];
  let drawnSignature = '';

  function drawStrip(attachments: readonly Attachment[]): void {
    shownAttachments = attachments;

    // The size and the kind land with the host's answer, so a late chip has to redraw on them too
    const signature = attachments.map((entry) => `${entry.uri}\t${entry.size}\t${entry.isImage}`).join('\n');
    if (signature === drawnSignature) {
      return;
    }
    drawnSignature = signature;

    const chips: HTMLElement[] = [];
    for (const [index, attachment] of attachments.entries()) {
      // Take the file from the latest draw, its position moves with every edit
      chips.push(buildChip(attachment, () => onRemove(shownAttachments[index])));
    }
    stripElement.replaceChildren(...chips);
  }

  return drawStrip;
}
