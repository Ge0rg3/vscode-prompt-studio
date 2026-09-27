// Renders the card canvas, edits note text in place, and posts moves, colors, and commands back to the host
(function () {
  const vscode = acquireVsCodeApi();

  const breadcrumbsEl = document.getElementById('breadcrumbs');
  const surfaceEl = document.getElementById('surface');
  const emptyEl = document.getElementById('empty');
  const menuEl = document.getElementById('context-menu');
  const canvasEl = document.getElementById('canvas');
  const fadeEl = document.getElementById('fade');
  const editToggleEl = document.getElementById('edit-toggle');
  const zoomOutEl = document.getElementById('zoom-out');
  const zoomLevelEl = document.getElementById('zoom-level');
  const zoomInEl = document.getElementById('zoom-in');
  const zoomFitEl = document.getElementById('zoom-fit');

  const DEFAULT_CARD_WIDTH = 240;
  const DEFAULT_CARD_HEIGHT = 170;
  const MIN_CARD_WIDTH = 160;
  const MIN_CARD_HEIGHT = 100;
  const DRAG_THRESHOLD = 3;
  const VIEW_SAVE_DEBOUNCE_MS = 300;

  const EMPTY_NOTE_LABEL = '(empty)';
  const CARD_COLORS = JSON.parse(document.body.dataset.cardColors || '[]');
  const ALLOW_CRUD = document.body.dataset.allowCrud === 'true';

  let state = null;
  let cards = [];
  let cardEls = new Map();
  let unmeasuredPreviews = [];
  let activePreview = null;
  let noteView = window.PromptStudioNoteOpen.INITIAL_NOTE_VIEW;

  // A canvas opens with its cards editable, and remembers the toggle from there
  let isEditMode = true;

  // Hold a state push that lands mid-edit, so the field under the caret survives
  let pendingState = null;

  // The percentage the bar last showed, so an unchanged frame writes nothing
  let shownZoomPercent = 0;

  // The folder card fading into the canvas, its title, and the color on the fade layer
  let openingCardEl = null;
  let openingTitleEl = null;
  let shownFadeColor = null;

  // The view a reload has to come back to
  let restoredView = null;

  let viewSaveTimer;

  const { create: createContextMenu, COPY_PATH_ITEM } = window.PromptStudioContextMenu;
  const { applyTint } = window.PromptStudioPalette;
  const { alternateOpen } = window.PromptStudioNoteOpen;
  const { create: createViewport, boundsOf, rectOf } = window.PromptStudioViewport;
  const { create: createFolderZoom } = window.PromptStudioFolderZoom;
  const { create: createNoteEditing } = window.PromptStudioNoteEditing;

  // Build the context menu shared by the cards and the background
  const menu = createContextMenu(menuEl, (command, node) => postAfterSave({ type: 'command', command, node: serialize(node) }), CARD_COLORS);

  const viewport = createViewport(canvasEl, surfaceEl, onViewChange);
  const folderZoom = createFolderZoom(viewport, canvasEl, () => ({ state, cards, cardEls }), navigateTo);

  // Own the text fields on the cards, writing what is typed into them back through the host
  const editing = createNoteEditing(
    (absPath, text) => {
      // Any state waiting to be drawn was read before this write, so it holds the older text
      pendingState = null;
      vscode.postMessage({ type: 'saveNote', path: absPath, text });
    },

    // Let the click that moved focus land before a held-back state redraws the cards
    () => setTimeout(applyPendingState, 0)
  );

  // --- helpers ---

  // Take the folder a state is showing
  function folderOf(shownState) {
    return shownState.breadcrumbs[shownState.breadcrumbs.length - 1].path;
  }

  // Tint the canvas background with the open folder's color
  function applyFolderTint(color) {
    applyTint(canvasEl, color, 'surface-tinted');
  }

  // Set the color classes on a card element
  function applyCardColor(el, color) {
    applyTint(el, color, 'colored');
  }

  // Raise a card above every other so the most recently dragged one stays on top
  function bringToFront(card, el) {
    let topZ = 0;
    for (const other of cards) {
      if (typeof other.z === 'number') {
        topZ = Math.max(topZ, other.z);
      }
    }
    card.z = topZ + 1;
    el.style.zIndex = String(card.z);
  }

  // Fill an element with a note's text, standing a word in for an empty one
  function fillNoteText(el, baseClass, text) {
    const noteText = text || '';
    const isEmpty = !noteText.trim();
    el.className = isEmpty ? `${baseClass} empty` : baseClass;
    el.textContent = isEmpty ? EMPTY_NOTE_LABEL : noteText;
  }

  // Check whether a pointerdown landed on the element's scrollbar
  function isScrollbarPress(event) {
    const target = event.target;
    return event.offsetX > target.clientWidth || event.offsetY > target.clientHeight;
  }

  // Drag a card to a new spot, or run onClick when the pointer barely moved
  function attachDrag(el, card, onClick) {
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.classList.contains('note-text')) {
        return;
      }

      if (isScrollbarPress(event)) {
        return;
      }

      const pressedEl = event.target;
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = card.x;
      const originY = card.y;

      // Hold the grab in surface coordinates, so a pan or a zoom mid-drag cannot shift the card
      const grabPoint = viewport.toSurface(event.clientX, event.clientY);
      let dragging = false;
      el.setPointerCapture(event.pointerId);

      // Follow the pointer once it has moved past the drag threshold
      const onMove = (move) => {
        if (!dragging && Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY) > DRAG_THRESHOLD) {
          dragging = true;
          el.classList.add('dragging');
          bringToFront(card, el);
        }
        if (dragging) {
          const point = viewport.toSurface(move.clientX, move.clientY);
          card.x = Math.round(originX + point.x - grabPoint.x);
          card.y = Math.round(originY + point.y - grabPoint.y);
          el.style.left = card.x + 'px';
          el.style.top = card.y + 'px';
        }
      };

      // Save the new position on release, or run onClick when nothing moved
      const onUp = () => {
        el.releasePointerCapture(event.pointerId);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        if (dragging) {
          el.classList.remove('dragging');
          vscode.postMessage({ type: 'moveCard', path: card.absPath, x: card.x, y: card.y, z: card.z });
        } else {
          onClick(pressedEl);
        }
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  // Drag the corner handle to resize the card
  function attachResize(el, card) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    el.appendChild(handle);

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      event.stopPropagation();
      const originWidth = card.width;
      const originHeight = card.height;
      const grabPoint = viewport.toSurface(event.clientX, event.clientY);
      handle.setPointerCapture(event.pointerId);

      // Resize the card as the pointer moves, measured on the surface rather than the screen
      const onMove = (move) => {
        const point = viewport.toSurface(move.clientX, move.clientY);
        card.width = Math.max(MIN_CARD_WIDTH, Math.round(originWidth + point.x - grabPoint.x));
        card.height = Math.max(MIN_CARD_HEIGHT, Math.round(originHeight + point.y - grabPoint.y));
        el.style.width = card.width + 'px';
        el.style.height = card.height + 'px';
      };

      // Save the new size on release
      const onUp = () => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        vscode.postMessage({ type: 'resizeCard', path: card.absPath, width: card.width, height: card.height });
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  // --- editing notes ---

  // Send a message once the edits are on their way, since the host reads the note off disk
  function postAfterSave(message) {
    editing.flush();
    vscode.postMessage(message);
  }

  // Draw a state that was held back while a card was being typed into
  function applyPendingState() {
    if (!pendingState || editing.isEditing()) {
      return;
    }

    const next = pendingState;
    pendingState = null;
    render(next);
  }

  // --- card builders ---

  // Build the card shell shared by notes and folders, placed at its saved spot
  function baseCard(card, iconName) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.left = card.x + 'px';
    el.style.top = card.y + 'px';
    el.style.width = card.width + 'px';
    el.style.height = card.height + 'px';
    if (typeof card.z === 'number') {
      el.style.zIndex = String(card.z);
    }

    const title = document.createElement('div');
    title.className = 'title';

    const icon = document.createElement('span');
    icon.className = 'codicon ' + iconName;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = card.title;
    title.appendChild(icon);
    title.appendChild(label);
    el.appendChild(title);

    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      menu.show(event.clientX, event.clientY, menuFor(card), card);
    });

    return el;
  }

  // Draw the note as it sits on disk, headings and all, so nothing shifts when a card is zoomed into
  function notePreview(card) {
    const preview = document.createElement('pre');
    fillNoteText(preview, 'preview', card.text);
    return preview;
  }

  // Build a note card, editable in place while the bar's Edit toggle is on
  function noteCard(card) {
    const el = baseCard(card, 'codicon-note');
    applyCardColor(el, card.color);
    el.appendChild(isEditMode ? editing.buildField(card) : notePreview(card));

    // The title row opens the note in either mode, the body takes the caret while editing
    attachDrag(el, card, (pressedEl) => {
      if (isEditMode && !pressedEl.closest('.title')) {
        return;
      }

      postAfterSave({ type: 'openNote', node: serialize(card) });
    });
    attachResize(el, card);
    return el;
  }

  // Build a copy of one child card for a folder preview, with no dragging or menus
  function miniCard(child, bounds) {
    const el = document.createElement('div');
    el.className = 'mini-card';
    el.style.left = (child.x - bounds.left) + 'px';
    el.style.top = (child.y - bounds.top) + 'px';
    el.style.width = child.width + 'px';
    el.style.height = child.height + 'px';
    applyCardColor(el, child.color);

    const title = document.createElement('div');
    title.className = 'mini-title';
    const icon = document.createElement('span');
    icon.className = 'codicon ' + (child.kind === 'folder' ? 'codicon-folder' : 'codicon-note');
    const label = document.createElement('span');
    label.className = 'mini-label';
    label.textContent = child.title;
    title.appendChild(icon);
    title.appendChild(label);
    el.appendChild(title);

    if (child.kind === 'note') {
      const preview = document.createElement('div');
      fillNoteText(preview, 'mini-preview', child.text);
      el.appendChild(preview);
    } else {
      el.appendChild(folderPreview(child.children || [], child.width, child.height));
    }
    return el;
  }

  // Draw the children at their real canvas positions
  function folderPreview(children, containerWidth, containerHeight) {
    const previewBox = document.createElement('div');
    previewBox.className = 'folder-preview';
    if (!children.length) {
      previewBox.classList.add('empty');
      const glyph = document.createElement('span');
      glyph.className = 'codicon codicon-folder';
      previewBox.appendChild(glyph);
      return previewBox;
    }

    // Frame the box the children fill, since a card can sit above or left of the canvas origin
    const bounds = boundsOf(children);
    const miniSurface = document.createElement('div');
    miniSurface.className = 'mini-surface';
    miniSurface.style.width = bounds.width + 'px';
    miniSurface.style.height = bounds.height + 'px';

    // Record the canvas point the preview starts at, so a zoom into the card can line the cards up
    miniSurface.dataset.originX = String(bounds.left);
    miniSurface.dataset.originY = String(bounds.top);
    for (const child of children) {
      miniSurface.appendChild(miniCard(child, bounds));
    }
    previewBox.appendChild(miniSurface);

    unmeasuredPreviews.push({
      previewBox,
      miniSurface,
      canvasWidth: bounds.width,
      canvasHeight: bounds.height,
      containerWidth,
      containerHeight
    });
    return previewBox;
  }

  // Build a folder card with a small preview of its contents, opening the folder when clicked
  function folderCard(card) {
    const el = baseCard(card, 'codicon-folder');
    applyCardColor(el, card.color);
    el.appendChild(folderPreview(card.children || [], card.width, card.height));

    attachDrag(el, card, () => navigateTo(card.absPath));
    attachResize(el, card);
    return el;
  }

  // --- rendering ---

  // Scale a preview against the default card size, so a bigger card reveals more of it
  function measurePreview(preview) {
    // A panel in a background tab has no layout, so there is nothing to measure yet
    if (!preview.previewBox.clientWidth || !preview.previewBox.clientHeight) {
      return false;
    }

    const boxWidth = preview.previewBox.clientWidth - (preview.containerWidth - DEFAULT_CARD_WIDTH);
    const boxHeight = preview.previewBox.clientHeight - (preview.containerHeight - DEFAULT_CARD_HEIGHT);
    if (boxWidth <= 0 || boxHeight <= 0) {
      return false;
    }

    const scale = Math.min(boxWidth / preview.canvasWidth, boxHeight / preview.canvasHeight);
    preview.miniSurface.style.transform = `scale(${scale})`;
    return true;
  }

  // Scale every preview now the cards are laid out, waiting on the ones with no size yet
  function measurePreviews() {
    for (const preview of unmeasuredPreviews) {
      if (measurePreview(preview)) {
        continue;
      }

      const observer = new ResizeObserver(() => {
        if (measurePreview(preview)) {
          observer.disconnect();
        }
      });
      observer.observe(preview.previewBox);
    }
    unmeasuredPreviews = [];
  }

  // Draw the breadcrumb trail, every crumb but the last one navigates on click
  function renderBreadcrumbs(crumbs) {
    breadcrumbsEl.replaceChildren();
    for (const [index, crumb] of crumbs.entries()) {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '>';
        breadcrumbsEl.appendChild(sep);
      }

      const isCurrent = index === crumbs.length - 1;
      const el = document.createElement('span');
      el.className = isCurrent ? 'crumb current' : 'crumb';
      el.textContent = crumb.name;
      el.title = crumb.path;
      if (!isCurrent) {
        el.addEventListener('click', () => navigateTo(crumb.path));
      }
      breadcrumbsEl.appendChild(el);
    }
  }

  // Redraw the whole canvas from a new state
  function render(next) {
    const isSameFolder = Boolean(state) && folderOf(next) === folderOf(state);

    // Swap the new state in
    editing.onCardsReplaced();
    state = next;
    cards = state.cards;
    cardEls = new Map();
    unmeasuredPreviews = [];

    // Draw the trail and the surface the cards go on
    renderBreadcrumbs(state.breadcrumbs);
    applyFolderTint(state.folderColor);
    surfaceEl.replaceChildren();
    emptyEl.classList.toggle('hidden', cards.length > 0);
    for (const card of cards) {
      const el = card.kind === 'folder' ? folderCard(card) : noteCard(card);
      cardEls.set(card.absPath, el);
      surfaceEl.appendChild(el);
    }

    measurePreviews();

    // Place the view this folder comes back to
    const restored = restoredView;
    restoredView = null;
    folderZoom.placeView(folderOf(state), isSameFolder, restored);
    reapplyPreview();
    saveViewState();
  }

  // --- moving between folders ---

  // Fade the canvas toward the folder the zoom is closing in on
  function paintFade(fade) {
    const opening = fade && fade.absPath ? cardEls.get(fade.absPath) : null;
    if (openingCardEl !== opening) {
      if (openingCardEl) {
        openingCardEl.classList.remove('opening');
        openingCardEl.style.removeProperty('--ps-open-progress');
        openingTitleEl.style.opacity = '';
      }

      openingCardEl = opening;
      openingTitleEl = opening ? opening.querySelector('.title') : null;
      if (opening) {
        opening.classList.add('opening');
      }
    }

    if (!fade) {
      fadeEl.style.opacity = '0';
      return;
    }

    const color = fade.color || null;
    if (color !== shownFadeColor) {
      shownFadeColor = color;
      applyTint(fadeEl, color, 'tinted');
    }

    fadeEl.style.opacity = String(fade.progress);
    if (openingCardEl) {
      openingCardEl.style.setProperty('--ps-open-progress', String(fade.progress));
      openingTitleEl.style.opacity = String(1 - fade.progress);
    }
  }

  // Report every pan and zoom to the bar, the saved view, and the folder zoom
  function onViewChange(zoom, isGesture, anchor) {
    const percent = Math.round(zoom * 100);
    if (percent !== shownZoomPercent) {
      shownZoomPercent = percent;
      zoomLevelEl.textContent = `${percent}%`;
    }

    if (isGesture && !menuEl.classList.contains('hidden')) {
      menu.hide();
    }
    if (state) {
      queueViewSave();
    }

    paintFade(folderZoom.onViewChanged(zoom, isGesture, anchor));
  }

  // Ask the host for a different folder, writing anything typed first
  function navigateTo(folder) {
    pendingState = null;
    postAfterSave({ type: 'navigate', folder });
  }

  // --- saving and restoring the view ---

  // Remember the folder, the view over it, and the edit mode, so a window reload comes back to them
  function saveViewState() {
    clearTimeout(viewSaveTimer);
    if (!state) {
      return;
    }

    vscode.setState({
      folder: folderOf(state),
      root: state.breadcrumbs[0].path,
      allowCrud: ALLOW_CRUD,
      isEditMode,
      view: viewport.getView()
    });
  }

  // Collapse a run of pans and zooms into one saved view
  function queueViewSave() {
    clearTimeout(viewSaveTimer);
    viewSaveTimer = setTimeout(saveViewState, VIEW_SAVE_DEBOUNCE_MS);
  }

  // Pick the edit mode and the view up from the state VSCode kept over a reload
  function readSavedState() {
    const saved = vscode.getState();
    if (!saved) {
      return;
    }

    isEditMode = saved.isEditMode !== false;
    if (saved.view) {
      restoredView = { folder: saved.folder, ...saved.view };
    }
  }

  // --- context menu ---

  // Build a node for the open folder out of the last breadcrumb
  function currentFolderNode() {
    const crumb = state.breadcrumbs[state.breadcrumbs.length - 1];
    return { kind: 'folder', absPath: crumb.path, name: crumb.name };
  }

  // Find the saved color for a card path
  function cardColorOf(absPath) {
    const card = cards.find((entry) => entry.absPath === absPath);
    return card ? card.color : undefined;
  }

  // Tint the card element at a path without saving the color
  function tintCard(absPath, color) {
    const el = cardEls.get(absPath);
    if (el) {
      applyCardColor(el, color);
    }
  }

  // Tint the matching card, or the canvas background when the path is the open folder
  function applyIncomingPreview(absPath, color) {
    if (state && absPath === currentFolderNode().absPath) {
      applyFolderTint(color || undefined);
    } else {
      tintCard(absPath, color);
    }
  }

  // Tint this canvas, then have the host mirror it in the sidebar and other canvases
  function previewColor(absPath, color) {
    applyIncomingPreview(absPath, color);
    vscode.postMessage({ type: 'previewColor', path: absPath, color: color || null });
  }

  // Look up the saved color for a path, the folder's own color when it is the open folder
  function savedColorOf(absPath) {
    if (state && absPath === currentFolderNode().absPath) {
      return state.folderColor;
    }
    return cardColorOf(absPath);
  }

  // Remember the live preview, drop it once it matches the saved color
  function trackPreview(absPath, color) {
    activePreview = (savedColorOf(absPath) || null) === (color || null) ? null : { path: absPath, color };
  }

  // Re-apply the preview if it still differs from the saved color
  function reapplyPreview() {
    if (!activePreview) {
      return;
    }
    trackPreview(activePreview.path, activePreview.color);
    if (activePreview) {
      applyIncomingPreview(activePreview.path, activePreview.color);
    }
  }

  // Set the color on the card, then save it
  function recolor(absPath, color) {
    const card = cards.find((entry) => entry.absPath === absPath);
    if (card) {
      card.color = color || undefined;
    }
    tintCard(absPath, color);
    vscode.postMessage({ type: 'setColor', path: absPath, color: color || null });
  }

  // Set the color on the canvas background, then save it on the open folder
  function recolorFolder(absPath, color) {
    state.folderColor = color || undefined;
    applyFolderTint(state.folderColor);
    vscode.postMessage({ type: 'setColor', path: absPath, color: color || null });
  }

  // Build the swatch target that recolors a card
  function cardColorTarget(card) {
    return {
      currentColor: () => cardColorOf(card.absPath),
      preview: (color) => previewColor(card.absPath, color),
      commit: (color) => recolor(card.absPath, color)
    };
  }

  // Build the swatch target that recolors the open folder and its canvas background
  function folderColorTarget() {
    const folder = currentFolderNode();
    return {
      currentColor: () => state.folderColor,
      preview: (color) => previewColor(folder.absPath, color),
      commit: (color) => recolorFolder(folder.absPath, color)
    };
  }

  // Drop empty entries, then leading, trailing, and doubled separators
  function compactMenu(items) {
    const out = [];
    for (const entry of items) {
      if (!entry) {
        continue;
      }
      if (entry === 'sep' && (out.length === 0 || out[out.length - 1] === 'sep')) {
        continue;
      }
      out.push(entry);
    }
    while (out.length && out[out.length - 1] === 'sep') {
      out.pop();
    }
    return out;
  }

  // Build the right-click menu for a card, without Rename and Delete on a read-only canvas
  function menuFor(card) {
    if (card.kind === 'note') {
      const alternate = alternateOpen(noteView, serialize(card));
      return compactMenu([
        { kind: 'swatches', target: cardColorTarget(card) },
        'sep',
        { label: 'Open', icon: 'go-to-file', action: () => postAfterSave({ type: 'openNote', node: serialize(card) }) },
        { label: alternate.label, icon: alternate.icon, action: () => postAfterSave(alternate.message) },
        // Only a skills canvas is read-only, and skills keep no history
        ALLOW_CRUD ? { label: 'Show History', icon: 'history', cmd: 'promptStudio.showHistory' } : null,
        'sep',
        { label: 'Send to Claude', icon: 'claude', cmd: 'promptStudio.sendToClaude' },
        'sep',
        ALLOW_CRUD ? { label: 'Rename', icon: 'edit', cmd: 'promptStudio.rename' } : null,
        { label: 'Copy Contents', icon: 'copy', cmd: 'promptStudio.copyContents' },
        'sep',
        { label: 'Reveal in File Manager', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
        COPY_PATH_ITEM,
        'sep',
        ALLOW_CRUD ? { label: 'Delete', icon: 'trash', cmd: 'promptStudio.delete' } : null
      ]);
    }
    return compactMenu([
      { kind: 'swatches', target: cardColorTarget(card) },
      'sep',
      ALLOW_CRUD ? { label: 'Rename', icon: 'edit', cmd: 'promptStudio.rename' } : null,
      'sep',
      { label: 'Reveal in File Manager', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
      COPY_PATH_ITEM,
      'sep',
      ALLOW_CRUD ? { label: 'Delete', icon: 'trash', cmd: 'promptStudio.delete' } : null
    ]);
  }

  // Work out the surface point that centers a new card on the click
  function dropPoint(event) {
    const point = viewport.toSurface(event.clientX, event.clientY);
    return {
      x: Math.round(point.x - DEFAULT_CARD_WIDTH / 2),
      y: Math.round(point.y - DEFAULT_CARD_HEIGHT / 2)
    };
  }

  // Build the right-click menu for empty canvas space, acting on the open folder
  function backgroundMenu(dropPos) {
    return compactMenu([
      { kind: 'swatches', target: folderColorTarget() },
      'sep',
      ALLOW_CRUD ? { label: 'New Note', icon: 'new-file', action: () => vscode.postMessage({ type: 'newEntry', kind: 'note', x: dropPos.x, y: dropPos.y }) } : null,
      ALLOW_CRUD ? { label: 'New Folder', icon: 'new-folder', action: () => vscode.postMessage({ type: 'newEntry', kind: 'folder', x: dropPos.x, y: dropPos.y }) } : null,
      'sep',
      { label: 'Reveal in File Manager', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
      COPY_PATH_ITEM
    ]);
  }

  // Cut a node down to the fields sent with a command
  function serialize(node) {
    return { kind: node.kind, absPath: node.absPath, name: node.name };
  }

  // Open the background menu on a right-click in empty canvas space
  canvasEl.addEventListener('contextmenu', (event) => {
    if (!state) {
      return;
    }

    event.preventDefault();
    menu.show(event.clientX, event.clientY, backgroundMenu(dropPoint(event)), currentFolderNode());
  });

  // --- bottom bar ---

  // Show whether the cards are taking text
  function paintEditToggle() {
    editToggleEl.classList.toggle('active', isEditMode);
    editToggleEl.setAttribute('aria-pressed', String(isEditMode));
  }

  // Turn the cards' text fields on or off, writing back whatever was typed
  function setEditMode(isEnabled) {
    isEditMode = isEnabled;
    paintEditToggle();
    editing.flush();
    if (state) {
      render(state);
    }
  }

  editToggleEl.addEventListener('click', () => setEditMode(!isEditMode));
  zoomOutEl.addEventListener('click', () => viewport.zoomOut());
  zoomInEl.addEventListener('click', () => viewport.zoomIn());
  zoomLevelEl.addEventListener('click', () => viewport.resetZoom());
  zoomFitEl.addEventListener('click', () => viewport.fit(cards.map(rectOf)));

  // Escape drops the caret, and the zoom keys only work when no card holds it
  document.addEventListener('keydown', (event) => {
    if (editing.isEditing()) {
      if (event.key === 'Escape') {
        document.activeElement.blur();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key === '+' || event.key === '=') {
      viewport.zoomIn();
    } else if (event.key === '-') {
      viewport.zoomOut();
    } else if (event.key === '0') {
      viewport.resetZoom();
    }
  });

  // Write pending edits before the panel loses the keyboard, goes to the background, or reloads
  window.addEventListener('blur', () => editing.flush());
  window.addEventListener('pagehide', () => editing.flush());
  document.addEventListener('visibilitychange', () => editing.flush());

  // --- inbound state ---

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') {
      // Hold the redraw while a card has the caret, or the caret is lost with the old field
      if (editing.isEditing() && state && folderOf(message.state) === folderOf(state)) {
        pendingState = message.state;
        return;
      }

      render(message.state);
    } else if (message && message.type === 'noteView') {
      noteView = message.view;
    } else if (message && message.type === 'previewColor') {
      applyIncomingPreview(message.path, message.color);
      trackPreview(message.path, message.color);
    }
  });

  readSavedState();
  paintEditToggle();
  vscode.postMessage({ type: 'ready' });
})();
