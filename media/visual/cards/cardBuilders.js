// Builds the note and folder cards, and the scaled-down copies of cards inside a folder's preview
(function () {
  const DEFAULT_CARD_WIDTH = 240;
  const DEFAULT_CARD_HEIGHT = 170;

  // Draw previews this many levels below the cards being built. Keep it no deeper than PREVIEW_DEPTH in
  // src/visual/folderContents.ts, and in step with the three .mini-card levels canvas.css styles
  const PREVIEW_DEPTH = 3;

  // Frame an empty folder as if it held one default card in the first grid slot, placed at GRID_MARGIN from
  // src/visual/folderContents.ts
  const GRID_MARGIN = 24;
  const EMPTY_FOLDER_BOUNDS = {
    left: GRID_MARGIN,
    top: GRID_MARGIN,
    width: DEFAULT_CARD_WIDTH,
    height: DEFAULT_CARD_HEIGHT
  };

  const EMPTY_NOTE_LABEL = '(empty)';
  const LATE_CONTENT_CLASS = 'late-content';
  const PREVIEW_CLASS = 'folder-preview';
  const FOLDER_ICON = 'codicon-folder';
  const NOTE_ICON = 'codicon-note';

  const { applyTint } = window.PromptStudioPalette;
  const { boundsOf } = window.PromptStudioViewport;

  // --- helpers ---

  // Fill an element with a note's text, standing a word in for an empty one
  function fillNoteText(el, baseClass, text) {
    const noteText = text || '';
    const isEmpty = !noteText.trim();
    el.className = isEmpty ? `${baseClass} empty` : baseClass;
    el.textContent = isEmpty ? EMPTY_NOTE_LABEL : noteText;
  }

  // Draw the note as it sits on disk, headings and all, so nothing shifts when a card is zoomed into
  function notePreview(card) {
    const preview = document.createElement('pre');
    fillNoteText(preview, 'preview', card.text);
    return preview;
  }

  function iconOf(card) {
    return card.kind === 'folder' ? FOLDER_ICON : NOTE_ICON;
  }

  // Find the preview a folder card holds directly, leaving out the previews nested inside it
  function previewOf(el) {
    return el.querySelector(`:scope > .${PREVIEW_CLASS}`);
  }

  // Build the row that heads a card, an icon beside a label that cuts off with an ellipsis
  function titleRow(rowClass, labelClass, iconName, text) {
    const title = document.createElement('div');
    title.className = rowClass;
    const icon = document.createElement('span');
    icon.className = 'codicon ' + iconName;
    const label = document.createElement('span');
    label.className = labelClass;
    label.textContent = text;

    title.appendChild(icon);
    title.appendChild(label);
    return title;
  }

  // Work out the room a card of this size leaves for its folder preview
  function previewBoxOf(width, height, insets) {
    return {
      width: width - 2 * insets.x,
      height: height - 2 * insets.y - insets.title
    };
  }

  // Fit the children into the default card's box, or a smaller card's own, so a bigger card shows more room around them
  function previewScale(bounds, width, height, insets) {
    const box = previewBoxOf(width, height, insets);
    const defaultBox = previewBoxOf(DEFAULT_CARD_WIDTH, DEFAULT_CARD_HEIGHT, insets);
    return Math.min(
      Math.min(defaultBox.width, box.width) / bounds.width,
      Math.min(defaultBox.height, box.height) / bounds.height
    );
  }

  // --- exports ---

  // Build cards and their previews from the canvas's callbacks, running onLateContentShown() each time a preview
  // filled in late has faded in
  function create(buildField, isEditMode, displayColorOf, onLateContentShown) {
    // How far each note's text is scrolled, so a redraw or a level change puts it back
    const noteScrollTops = new Map();

    // Each preview's child bounds and owning card, kept so a resize can rescale it
    const previewLayouts = new WeakMap();

    // How far a card's preview sits in from its edges, measured off a stand-in card: its border and padding on each
    // side, and its title row with the margin under it on top
    let insets = { x: 0, y: 0, title: 0 };

    // Fade in content that arrived after its card was drawn, then drop the class so moving the card cannot replay it
    function markLateContent(el) {
      el.classList.add(LATE_CONTENT_CLASS);
      el.addEventListener('animationend', (event) => {
        if (event.target === el) {
          el.classList.remove(LATE_CONTENT_CLASS);
          onLateContentShown();
        }
      });
    }

    // Build the shell a card and its copies share, placed, stacked by z, and tinted
    function cardShell(className, card, left, top) {
      const el = document.createElement('div');
      el.className = className;
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.width = card.width + 'px';
      el.style.height = card.height + 'px';
      if (typeof card.z === 'number') {
        el.style.zIndex = String(card.z);
      }
      applyTint(el, displayColorOf(card.absPath, card.color), 'colored');
      return el;
    }

    // Build the text field for a note, remembering how far it is scrolled
    function noteField(card) {
      const field = buildField(card);
      field.dataset.path = card.absPath;
      field.addEventListener('scroll', () => {
        // A scroll event can arrive after a redraw took the field away, when it reads 0
        if (field.isConnected) {
          noteScrollTops.set(card.absPath, field.scrollTop);
        }
      });
      return field;
    }

    // Draw a note's text the way its live card does in the current mode, raw like the field while editing
    function miniNoteBody(child) {
      const body = document.createElement('div');
      body.dataset.path = child.absPath;
      if (isEditMode()) {
        body.className = 'mini-preview';
        body.textContent = child.text || '';
      } else {
        fillNoteText(body, 'mini-preview', child.text);
      }
      return body;
    }

    // Build a copy of one child card for a folder preview, tagged with its path so a color preview reaches it
    function miniCard(child, bounds, depth) {
      const isFolder = child.kind === 'folder';
      const el = cardShell('mini-card', child, child.x - bounds.left, child.y - bounds.top);
      el.dataset.path = child.absPath;
      el.appendChild(titleRow('mini-title', 'mini-label', iconOf(child), child.title));
      el.appendChild(isFolder ? folderPreview(child.children, child, depth - 1) : miniNoteBody(child));
      return el;
    }

    // Scale a preview's copies to fit the card it sits in, at the size the card has now
    function applyPreviewScale(miniSurface) {
      const { bounds, card } = previewLayouts.get(miniSurface);
      miniSurface.style.transform = `scale(${previewScale(bounds, card.width, card.height, insets)})`;
    }

    // Draw the children at their real canvas positions inside their card, nesting copies at most depth levels down
    function folderPreview(children, card, depth) {
      const previewEl = document.createElement('div');
      previewEl.className = PREVIEW_CLASS;

      // Leave the box blank when the children are unknown or past the depth, since the empty glyph means there are none
      if (!children || depth < 1) {
        return previewEl;
      }

      if (!children.length) {
        previewEl.classList.add('empty');
        const glyph = document.createElement('span');
        glyph.className = 'codicon codicon-folder';
        previewEl.appendChild(glyph);
        return previewEl;
      }

      // Frame the box the children fill, since a card can sit above or left of the canvas origin
      const bounds = boundsOf(children);
      const miniSurface = document.createElement('div');
      miniSurface.className = 'mini-surface';

      // Keep the copies out of tab order and hit testing, since a scrolling copy would otherwise take focus
      miniSurface.inert = true;
      miniSurface.style.width = bounds.width + 'px';
      miniSurface.style.height = bounds.height + 'px';
      previewLayouts.set(miniSurface, { bounds, card });
      applyPreviewScale(miniSurface);
      for (const child of children) {
        miniSurface.appendChild(miniCard(child, bounds, depth));
      }
      previewEl.appendChild(miniSurface);
      return previewEl;
    }

    // Walk a drawn preview beside newer data for the same folder, building each part that was drawn blank
    function fillPreview(previewEl, card, depth) {
      if (card.kind !== 'folder' || !card.children || depth < 1) {
        return;
      }

      const miniSurface = previewEl.querySelector(':scope > .mini-surface');
      if (miniSurface) {
        for (const [index, child] of card.children.entries()) {
          fillPreview(previewOf(miniSurface.children[index]), child, depth - 1);
        }
        return;
      }

      if (previewEl.classList.contains('empty')) {
        return;
      }

      const filledEl = folderPreview(card.children, card, depth);
      markLateContent(filledEl);
      previewEl.replaceWith(filledEl);
    }

    // Build a card for a note or a folder, its preview previewDepth levels deep, leaving its handlers to the caller
    function buildCard(card, previewDepth) {
      const isFolder = card.kind === 'folder';
      const el = cardShell('card', card, card.x, card.y);
      el.appendChild(titleRow('title', 'label', iconOf(card), card.title));
      if (isFolder) {
        el.appendChild(folderPreview(card.children, card, previewDepth));
      } else {
        el.appendChild(isEditMode() ? noteField(card) : notePreview(card));
      }

      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      el.appendChild(handle);
      return el;
    }

    // Build a folder card's preview from any list of children, such as the cards of the level it opens onto
    function buildPreview(children, card) {
      return folderPreview(children, card, PREVIEW_DEPTH);
    }

    // Fill the previews a card drew blank, down to the preview depth, from data that adds children it left out
    function fillBlankPreviews(el, card) {
      fillPreview(previewOf(el), card, PREVIEW_DEPTH);
    }

    // Check whether a card's preview is still fading in content that arrived late
    function isFadingIn(el) {
      return el.querySelector('.' + LATE_CONTENT_CLASS) !== null;
    }

    // Find where a folder card draws its children, so child point p lands at (x, y) + scale * p in the level.
    // Returns null while the children are unknown
    function previewFrame(card, children) {
      if (!children) {
        return null;
      }

      const bounds = children.length ? boundsOf(children) : EMPTY_FOLDER_BOUNDS;
      const scale = previewScale(bounds, card.width, card.height, insets);
      return {
        x: card.x + insets.x - bounds.left * scale,
        y: card.y + insets.y + insets.title - bounds.top * scale,
        scale
      };
    }

    // Put every note's text back where it was scrolled to, the copies in previews included
    function restoreNoteScroll(rootEl) {
      if (!isEditMode()) {
        return;
      }

      for (const body of rootEl.querySelectorAll('.note-text, .mini-preview')) {
        const scrollTop = noteScrollTops.get(body.dataset.path);
        if (scrollTop) {
          body.scrollTop = scrollTop;
        }
      }
    }

    // Scale a card's own preview to its size now, keeping it true to what opening the card shows while it resizes
    function rescalePreview(el) {
      const miniSurface = el.querySelector(`:scope > .${PREVIEW_CLASS} > .mini-surface`);
      if (miniSurface) {
        applyPreviewScale(miniSurface);
      }
    }

    // Scale every preview under an element again, after the card's insets changed
    function rescalePreviews(rootEl) {
      for (const miniSurface of rootEl.querySelectorAll('.mini-surface')) {
        applyPreviewScale(miniSurface);
      }
    }

    // Measure the card's insets and the text field's scrollbar on stand-ins, returning true when the insets changed
    function measure() {
      const cardProbe = document.createElement('div');
      cardProbe.className = 'card metrics-probe';
      cardProbe.appendChild(titleRow('title', 'label', FOLDER_ICON, 'Folder'));
      const gutterProbe = document.createElement('div');
      gutterProbe.className = 'gutter-probe metrics-probe';

      document.body.append(cardProbe, gutterProbe);
      const titleEl = cardProbe.firstChild;
      const measuredTitleHeight = titleEl.getBoundingClientRect().height;
      const cardStyle = getComputedStyle(cardProbe);
      const measuredInsets = {
        x: parseFloat(cardStyle.borderLeftWidth) + parseFloat(cardStyle.paddingLeft),
        y: parseFloat(cardStyle.borderTopWidth) + parseFloat(cardStyle.paddingTop),
        title: measuredTitleHeight + parseFloat(getComputedStyle(titleEl).marginBottom)
      };
      const gutterWidth = gutterProbe.offsetWidth - gutterProbe.clientWidth;

      cardProbe.remove();
      gutterProbe.remove();

      // A panel in a background tab has no layout, so keep what was measured last
      if (!measuredTitleHeight) {
        return false;
      }

      document.documentElement.style.setProperty('--ps-field-gutter', gutterWidth + 'px');
      const hasChanged = measuredInsets.x !== insets.x || measuredInsets.y !== insets.y ||
        measuredInsets.title !== insets.title;
      insets = measuredInsets;
      return hasChanged;
    }

    measure();
    return {
      buildCard, buildPreview, fillBlankPreviews, isFadingIn, previewFrame, restoreNoteScroll, rescalePreview,
      rescalePreviews, measure
    };
  }

  window.PromptStudioCardBuilders = { create, previewOf, DEFAULT_CARD_WIDTH, DEFAULT_CARD_HEIGHT, PREVIEW_DEPTH };
})();
