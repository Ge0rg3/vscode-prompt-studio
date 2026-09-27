// Steps the template editor back and forward through the note's saved versions, showing each one read-only
import { unifiedMergeView } from '@codemirror/merge';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { markdownWithCode } from './codeHighlight';
import { livePreview } from './livePreview';

// One saved version as the host lists it, kept in sync with the matching type in src/template/panelHistory.ts
export interface VersionEntry {
  blobId: string;
  savedAt: number;
  ageLabel: string;
  dateLabel: string;
}

// The page parts that change while a saved version is on screen
export interface StepperElements {
  editor: HTMLElement;
  versionPane: HTMLElement;
  olderButton: HTMLButtonElement;
  newerButton: HTMLButtonElement;
  historyButton: HTMLElement;
  historyLabel: HTMLElement;
  restoreButton: HTMLButtonElement;
  hiddenWhileViewing: readonly HTMLElement[];
}

// The live editor the stepper steps away from and back to
export interface LiveEditor {
  readText(): string;
  isDirty(): boolean;
  focus(): void;
}

// The index of the note as it is now, one step newer than any saved version
const LIVE_INDEX = -1;

const HISTORY_LABEL = 'History';
const HISTORY_TITLE = 'Pick a saved version to compare with the note';
const RESTORE_TITLE = 'Put this version back as the note';
const RESTORE_BLOCKED_TITLE = 'Save or undo your edits to the note first';

export class VersionStepper {
  private versions: readonly VersionEntry[] = [];
  private viewedIndex = LIVE_INDEX;

  // The index last asked of the host, to tell its reply from a late one to an earlier step
  private requestedIndex: number | undefined;

  private hasHistory = false;
  private isListing = false;
  private isRendered = true;
  private versionView: EditorView | undefined;
  private readonly rendering = new Compartment();

  constructor(
    private readonly elements: StepperElements,
    private readonly liveEditor: LiveEditor,
    private readonly postMessage: (message: unknown) => void,
    private readonly nonce: string
  ) {
    elements.olderButton.addEventListener('click', () => this.stepOlder());
    elements.newerButton.addEventListener('click', () => this.stepNewer());
    elements.historyButton.addEventListener('click', () => this.postMessage({ type: 'showHistory' }));
    elements.restoreButton.addEventListener('click', () => this.restoreViewed());
    this.paintPage();
    this.paintBar();
  }

  // Count a step from the version still on its way, so quick clicks each move one version
  private findStepOrigin(): number {
    return this.requestedIndex ?? this.viewedIndex;
  }

  // Step one version back, fetching the list fresh when leaving the live note
  private stepOlder(): void {
    const origin = this.findStepOrigin();
    if (origin === LIVE_INDEX) {
      if (!this.isListing) {
        this.isListing = true;
        this.postMessage({ type: 'listVersions' });
      }
      return;
    }

    if (origin < this.versions.length - 1) {
      this.requestVersion(origin + 1);
    }
  }

  // Step one version forward, landing back on the live note after the newest one
  private stepNewer(): void {
    const origin = this.findStepOrigin();
    if (origin === 0) {
      this.exit();
      return;
    }

    if (origin > 0) {
      this.requestVersion(origin - 1);
    }
  }

  private requestVersion(index: number): void {
    this.requestedIndex = index;
    this.postMessage({ type: 'readVersion', blobId: this.versions[index].blobId });
  }

  private restoreViewed(): void {
    this.postMessage({ type: 'restoreVersion', blobId: this.versions[this.viewedIndex].blobId });
  }

  // Go back to the live note
  private exit(): void {
    const wasViewing = this.isViewing();
    this.viewedIndex = LIVE_INDEX;
    this.requestedIndex = undefined;
    this.isListing = false;
    this.paintPage();
    this.paintBar();
    if (wasViewing) {
      this.liveEditor.focus();
    }
  }

  // Show a version read-only in place of the editor, marked against the note as it is now
  private showVersion(text: string): void {
    const state = EditorState.create({
      doc: text,
      extensions: [
        EditorView.cspNonce.of(this.nonce),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        markdownWithCode,
        this.rendering.of(this.isRendered ? livePreview() : []),
        unifiedMergeView({ original: this.liveEditor.readText(), mergeControls: false, gutter: false })
      ]
    });

    if (this.versionView) {
      this.versionView.setState(state);
    } else {
      this.versionView = new EditorView({ parent: this.elements.versionPane, state });
    }
    this.paintPage();
    this.paintBar();

    // Take focus off the hidden editor, so the keys scroll and select the version
    this.versionView.focus();
  }

  // Put the saved version in place of the editor while one is on screen, hiding what only the live note uses
  private paintPage(): void {
    const isViewing = this.isViewing();
    const { editor, versionPane, hiddenWhileViewing } = this.elements;

    editor.classList.toggle('hidden', isViewing);
    versionPane.classList.toggle('hidden', !isViewing);
    for (const element of hiddenWhileViewing) {
      element.classList.toggle('hidden', isViewing);
    }
  }

  // Set the bar's buttons and label for the live note or the saved version on screen
  private paintBar(): void {
    const isViewing = this.isViewing();
    const viewed = this.versions[this.viewedIndex];
    const { olderButton, newerButton, historyButton, historyLabel, restoreButton } = this.elements;

    for (const button of [olderButton, historyButton, newerButton]) {
      button.classList.toggle('hidden', !this.hasHistory);
    }
    olderButton.disabled = isViewing && this.viewedIndex >= this.versions.length - 1;
    newerButton.disabled = !isViewing;
    historyButton.classList.toggle('active', isViewing);
    historyLabel.textContent = viewed ? viewed.ageLabel : HISTORY_LABEL;
    historyButton.title = viewed ? `Saved ${viewed.dateLabel}` : HISTORY_TITLE;

    // Hold a restore back while the live note has unsaved edits, the host would refuse it
    const isRestoreBlocked = this.liveEditor.isDirty();
    restoreButton.classList.toggle('hidden', !isViewing);
    restoreButton.disabled = isRestoreBlocked;
    restoreButton.title = isRestoreBlocked ? RESTORE_BLOCKED_TITLE : RESTORE_TITLE;
  }

  isViewing(): boolean {
    return this.viewedIndex !== LIVE_INDEX;
  }

  // Read the text on screen, the saved version while one is shown
  readViewedText(): string {
    if (this.isViewing() && this.versionView) {
      return this.versionView.state.doc.toString();
    }
    return this.liveEditor.readText();
  }

  // Go back to the live note, showing the history buttons only for a note that keeps history
  reset(hasHistory: boolean): void {
    this.hasHistory = hasHistory;
    this.exit();
  }

  // Take the host's list and step onto its newest version, the host has already dropped any version matching the note now
  receiveVersions(versions: readonly VersionEntry[]): void {
    // Drop a list that lands after the stepper went back to the live note
    if (!this.isListing) {
      return;
    }

    this.isListing = false;
    this.versions = versions;
    if (versions.length > 0) {
      this.requestVersion(0);
    }
  }

  // Show a version's text, as long as it is still the one last asked for
  receiveVersionText(blobId: string, text: string): void {
    if (this.requestedIndex === undefined || this.versions[this.requestedIndex]?.blobId !== blobId) {
      return;
    }

    this.viewedIndex = this.requestedIndex;
    this.requestedIndex = undefined;
    this.showVersion(text);
  }

  // Follow the rendered or source toggle on the version being shown
  setRendered(isRendered: boolean): void {
    this.isRendered = isRendered;
    this.versionView?.dispatch({ effects: this.rendering.reconfigure(isRendered ? livePreview() : []) });
  }

  // Put focus on whichever editor is on screen
  focus(): void {
    if (this.isViewing() && this.versionView) {
      this.versionView.focus();
      return;
    }
    this.liveEditor.focus();
  }
}
