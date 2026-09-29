// Wires the canvas page together, with card drags, updates from the host, the bottom bar, and the saved view
(function () {
  const vscode = acquireVsCodeApi();

  const breadcrumbsEl = document.getElementById('breadcrumbs');
  const surfaceEl = document.getElementById('surface');
  const emptyEl = document.getElementById('empty');
  const emptyLabelEl = document.getElementById('empty-label');
  const menuEl = document.getElementById('context-menu');
  const canvasEl = document.getElementById('canvas');
  const fadeEl = document.getElementById('fade');
  const editToggleEl = document.getElementById('edit-toggle');
  const zoomOutEl = document.getElementById('zoom-out');
  const zoomLevelEl = document.getElementById('zoom-level');
  const zoomInEl = document.getElementById('zoom-in');
  const zoomFitEl = document.getElementById('zoom-fit');

  const MIN_CARD_WIDTH = 160;
  const MIN_CARD_HEIGHT = 100;
  const DRAG_THRESHOLD = 3;
  const VIEW_SAVE_DEBOUNCE_MS = 300;

  const CARD_COLORS = JSON.parse(document.body.dataset.cardColors || '[]');
  const ALLOW_CRUD = document.body.dataset.allowCrud === 'true';

  // A canvas opens with its cards editable, and remembers the toggle from there
  let isEditMode = true;

  // The edit mode the drawn cards use, catching up with the toggle when the cards are rebuilt with the view still
  let isDrawnInEditMode = true;

  // The number on the last navigate message, taken from the host's first state so a reloaded page keeps counting
  let lastNavigateNumber = 0;

  // The percentage the bar last showed, so an unchanged frame writes nothing
  let shownZoomPercent = 0;

  // The view a reload has to come back to
  let restoredView = null;

  let viewSaveTimer;

  const { create: createViewport } = window.PromptStudioViewport;
  const { create: createCardBuilders } = window.PromptStudioCardBuilders;
  const { create: createLevels, levelDataOf, parentDataOf } = window.PromptStudioLevels;
  const { create: createLookPainter } = window.PromptStudioLookPainter;
  const { create: createAncestors } = window.PromptStudioAncestors;
  const { create: createFolderZoom } = window.PromptStudioFolderZoom;
  const { create: createNoteEditing } = window.PromptStudioNoteEditing;
  const { create: createHeldStates } = window.PromptStudioHeldStates;
  const { create: createColors } = window.PromptStudioColors;
  const { create: createMenus, serialize } = window.PromptStudioMenus;

  // Move the view over the surface, handing every frame to onFrame before it is drawn
  const camera = createViewport(canvasEl, surfaceEl, onFrame);

  // Own the text fields on the cards, writing what is typed into them back through the host
  const editing = createNoteEditing(
    (absPath, text) => {
      // Any state waiting to be drawn was read before this write, so it holds the older text
      heldStates.drop();
      levels.markMirrorStale();
      vscode.postMessage({ type: 'saveNote', path: absPath, text });
    },

    // Let the click that moved focus land before a held-back state redraws the cards
    () => setTimeout(() => heldStates.applyAtRest(), 0)
  );

  // Build the cards and previews in the drawn edit mode, showing any swatch being hovered.
  // Work out the fades again after a late preview fades in, since its folder card can open then
  const cardBuilders = createCardBuilders(editing.buildField, () => isDrawnInEditMode, displayColorOf, refreshLook);

  // Keep the open folder's cards live with the parent drawn around them, and paint the fades between the two
  const levels = createLevels(surfaceEl, cardBuilders, attachCardHandlers, displayColorOf);
  const painter = createLookPainter(canvasEl, fadeEl, emptyEl, emptyLabelEl, levels, displayColorOf);

  // Color the drawn cards, and build the right-click menus with their swatches
  const colors = createColors(levels, (message) => vscode.postMessage(message), repaint);
  const menus = createMenus(
    menuEl,
    CARD_COLORS,
    ALLOW_CRUD,
    camera,
    levels,
    colors,
    postAfterSave,
    (message) => vscode.postMessage(message)
  );

  // Move between the two levels as the view zooms, keeping the folders above the open one to draw the parent from
  const ancestors = createAncestors(levels, takeEditMode);
  const folderZoom = createFolderZoom(camera, levels, ancestors, releaseEdits, onLevelEnter);

  // Hold back host states that would redraw the open folder's cards while the view moves or a card is in use
  const heldStates = createHeldStates(levels, ancestors, folderZoom, editing, refreshLook);

  // --- helpers ---

  // Take the color a path is drawn in from the colors, which are built after the cards that ask for it
  function displayColorOf(absPath, savedColor) {
    return colors.displayColorOf(absPath, savedColor);
  }

  // Raise a card above every other so the most recently dragged one stays on top
  function bringToFront(card, el) {
    let topZ = 0;
    for (const other of levels.liveLevel().data.cards) {
      if (typeof other.z === 'number') {
        topZ = Math.max(topZ, other.z);
      }
    }
    card.z = topZ + 1;
    el.style.zIndex = String(card.z);
  }

  // Check whether a pointerdown landed on the element's scrollbar
  function isScrollbarPress(event) {
    const target = event.target;
    return event.offsetX > target.clientWidth || event.offsetY > target.clientHeight;
  }

  // Follow a press on a card until it ends, however it ends, running onEnd(isRelease) once.
  // The level stays still meanwhile, since a level change would move the card's element away
  function trackCardPress(el, pointerId, onMove, onEnd) {
    let isPressed = true;
    el.setPointerCapture(pointerId);
    folderZoom.setCardHeld(true);

    const endPress = (isRelease) => {
      if (!isPressed) {
        return;
      }

      isPressed = false;
      el.releasePointerCapture(pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onRelease);
      el.removeEventListener('pointercancel', onPressCancel);
      el.removeEventListener('lostpointercapture', onPressCancel);
      onEnd(isRelease);
    };
    const onRelease = () => endPress(true);
    const onPressCancel = () => endPress(false);

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onRelease);
    el.addEventListener('pointercancel', onPressCancel);
    el.addEventListener('lostpointercapture', onPressCancel);
  }

  // Let the level change again once a drag or resize lets go, then draw any state held back.
  // Keep that state, since the host sends no new one after a move or a resize
  function endInteraction(card, hasMoved) {
    folderZoom.setCardHeld(false);
    if (hasMoved) {
      heldStates.rememberMovedCard(card.absPath);
      levels.relayout();
    }
    refreshLook();
    heldStates.applyAtRest();
  }

  // Drag a card to a new spot, or run onClick when the pointer barely moved
  function attachDrag(el, card, onClick) {
    // The click count of the latest press, carried only by its mouse events
    let pressCount = 1;
    el.addEventListener('mousedown', (event) => {
      pressCount = event.detail;
    });

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

      // Count a press that sends no mouse events, such as a tap, as a single click
      pressCount = 1;

      // Hold the grab in surface coordinates, so a pan or a zoom mid-drag cannot shift the card
      const grabPoint = camera.toSurface(event.clientX, event.clientY);
      let dragging = false;

      // Follow the pointer once it has moved past the drag threshold
      const onMove = (move) => {
        if (!dragging && Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY) > DRAG_THRESHOLD) {
          dragging = true;
          el.classList.add('dragging');
          bringToFront(card, el);
        }
        if (dragging) {
          const point = camera.toSurface(move.clientX, move.clientY);
          card.x = Math.round(originX + point.x - grabPoint.x);
          card.y = Math.round(originY + point.y - grabPoint.y);
          el.style.left = card.x + 'px';
          el.style.top = card.y + 'px';
        }
      };

      // Save a drag, or run onClick for a single click that barely moved
      const onEnd = (isRelease) => {
        endInteraction(card, dragging);
        if (dragging) {
          el.classList.remove('dragging');
          vscode.postMessage({ type: 'moveCard', path: card.absPath, x: card.x, y: card.y, z: card.z });
        } else if (isRelease && pressCount < 2) {
          onClick(pressedEl);
        }
      };

      trackCardPress(el, event.pointerId, onMove, onEnd);
    });
  }

  // Drag the corner handle to resize the card, scaling a folder card's preview along with it
  function attachResize(el, card) {
    const handle = el.querySelector(':scope > .resize-handle');
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      event.stopPropagation();
      const originWidth = card.width;
      const originHeight = card.height;
      const grabPoint = camera.toSurface(event.clientX, event.clientY);

      // Resize the card as the pointer moves, measured on the surface rather than the screen
      const onMove = (move) => {
        const point = camera.toSurface(move.clientX, move.clientY);
        card.width = Math.max(MIN_CARD_WIDTH, Math.round(originWidth + point.x - grabPoint.x));
        card.height = Math.max(MIN_CARD_HEIGHT, Math.round(originHeight + point.y - grabPoint.y));
        el.style.width = card.width + 'px';
        el.style.height = card.height + 'px';
        cardBuilders.rescalePreview(el);
      };

      // Save the new size once the press ends, however it ends
      const onEnd = () => {
        endInteraction(card, card.width !== originWidth || card.height !== originHeight);
        vscode.postMessage({ type: 'resizeCard', path: card.absPath, width: card.width, height: card.height });
      };

      trackCardPress(handle, event.pointerId, onMove, onEnd);
    });
  }

  // --- editing notes ---

  // Send a message once the edits are on their way, since the host reads the note off disk
  function postAfterSave(message) {
    editing.flush();
    vscode.postMessage(message);
  }

  // Write what was typed and take the caret off its field before the level changes.
  // The host refuses saves for notes outside its folder
  function releaseEdits() {
    editing.flush();
    editing.blurActiveField();
    heldStates.drop();
  }

  // --- card handlers ---

  // Wire up a live card's drag, resize, menu, and click
  function attachCardHandlers(el, card) {
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      menus.showCardMenu(event, card);
    });

    if (card.kind === 'folder') {
      attachDrag(el, card, () => openFolderCard(card.absPath));
    } else {
      // The title row opens the note in either mode, the body takes the caret while editing
      attachDrag(el, card, (pressedEl) => {
        if (isDrawnInEditMode && !pressedEl.closest('.title')) {
          return;
        }

        postAfterSave({ type: 'openNote', node: serialize(card) });
      });
    }
    attachResize(el, card);
  }

  // --- rendering ---

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
        const isParent = index === crumbs.length - 2;
        el.addEventListener('click', () => openCrumb(crumb.path, isParent));
      }
      breadcrumbsEl.appendChild(el);
    }
  }

  // Draw the fades the folder zoom last worked out
  function repaint() {
    painter.paint(folderZoom.currentLook());
  }

  // Work out and draw the fades and the zoom readout outside a camera frame, since a level change shifts the zoom
  function refreshLook() {
    folderZoom.refresh();
    repaint();
    showZoomReadout();
  }

  // Show the live level's zoom on the bar, where 100% is its actual size
  function showZoomReadout() {
    const percent = Math.round(camera.getView().zoom * 100);
    if (percent !== shownZoomPercent) {
      shownZoomPercent = percent;
      zoomLevelEl.textContent = `${percent}%`;
    }
  }

  // Place the view over a folder the host opened, back where a reload left it or fitted to its cards
  function placeView(folder) {
    const restored = restoredView && restoredView.folder === folder ? restoredView : null;
    restoredView = null;
    if (restored) {
      if (restored.gates) {
        folderZoom.keepGatesForNextCut(restored.gates);
      }
      camera.setView(restored.zoom, restored.panX, restored.panY);
      return;
    }

    const view = folderZoom.fitLiveView();
    camera.setView(view.zoom, view.panX, view.panY);
  }

  // --- moving between folders ---

  // Hand each camera frame to the folder zoom, then draw the fades, the readout, and the saved view from it
  function onFrame(frame) {
    if (frame.kind === 'input' || frame.kind === 'flight') {
      menus.hideMenu();
    }

    // Redraw from a held state on the first frame the camera rests on
    heldStates.applyInFrame();

    // Let the folder zoom move between levels, then draw the fades, the readout, and the saved view
    const shouldRequestFrame = folderZoom.onFrame(frame);
    repaint();
    showZoomReadout();
    if (levels.liveLevel()) {
      queueViewSave();
    }

    // Ask for one more frame when this one ended a scripted move that a held state was waiting on
    return shouldRequestFrame || heldStates.isDue();
  }

  // Tell the host which folder is open, numbered so a state answering an older navigate can be told apart
  function postNavigate(folder, fromFolder) {
    lastNavigateNumber += 1;
    vscode.postMessage({ type: 'navigate', folder, fromFolder, navigateNumber: lastNavigateNumber });
  }

  // Follow a level change the zoom made on its own, on the trail and in the host
  function onLevelEnter(fromFolder) {
    const live = levels.liveLevel();
    renderBreadcrumbs(live.crumbs);
    postNavigate(live.data.folder, fromFolder);
    queueViewSave();
  }

  // Ask the host for another folder, and swap to it without animation when it answers
  function navigateTo(folder) {
    releaseEdits();
    postNavigate(folder, levels.liveLevel().data.folder);
  }

  // Open a folder card with a flight into it, or through the host when it cannot open in place
  function openFolderCard(absPath) {
    if (folderZoom.flyIntoCard(absPath)) {
      refreshLook();
    } else {
      navigateTo(absPath);
    }
  }

  // Fly out to the parent from its crumb, and go through the host for any other crumb or a parent not drawn yet
  function openCrumb(folder, isParent) {
    if (isParent && folderZoom.flyToParent()) {
      refreshLook();
    } else {
      navigateTo(folder);
    }
  }

  // --- host states ---

  // Pick the parent to draw around another folder, reusing the live level when the new folder is one of its cards,
  // since the host leaves that level out
  function jumpParentOf(next) {
    const live = levels.liveLevel();
    const crumbs = next.breadcrumbs;
    const isIntoLiveFolder = live !== null && crumbs.length > 1 && crumbs[crumbs.length - 2].path === live.data.folder;
    return !next.parent && isIntoLiveFolder ? live.data : parentDataOf(next);
  }

  // Draw a state for another folder with no animation, its parent around it and the view placed afresh
  function showState(next) {
    releaseEdits();
    renderBreadcrumbs(next.breadcrumbs);

    // Measure once the trail is drawn and before the cards change, so only the trail is laid out
    camera.measureView();
    const data = levelDataOf(next);
    ancestors.showLevel(data, next.breadcrumbs, jumpParentOf(next));
    placeView(data.folder);
    colors.reapplyPreview();
    saveViewState();
  }

  // Take a state from the host, drawing another folder, updating the open one, or dropping it when a newer navigate
  // overtook it
  function receiveState(next, navigateNumber) {
    const live = levels.liveLevel();
    if (!live) {
      lastNavigateNumber = navigateNumber;
      showState(next);
      return;
    }
    if (navigateNumber < lastNavigateNumber) {
      return;
    }

    if (levelDataOf(next).folder === live.data.folder) {
      heldStates.confirm(next);
    } else {
      showState(next);
    }
  }

  // --- saving and restoring the view ---

  // Remember the folder, the view over it, its fades, and the edit mode, so a window reload comes back to them
  function saveViewState() {
    clearTimeout(viewSaveTimer);
    const live = levels.liveLevel();
    if (!live) {
      return;
    }

    vscode.setState({
      folder: live.data.folder,
      root: live.crumbs[0].path,
      allowCrud: ALLOW_CRUD,
      isEditMode,
      view: camera.getView(),
      gates: folderZoom.gates()
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
      restoredView = { folder: saved.folder, ...saved.view, gates: saved.gates };
    }
  }

  // --- bottom bar ---

  // Show on the bar at once whether the cards take text, while the cards themselves wait for the view to hold still
  function paintEditToggle() {
    editToggleEl.classList.toggle('active', isEditMode);
    editToggleEl.setAttribute('aria-pressed', String(isEditMode));
  }

  // Adopt the toggle's edit mode for the cards and preview copies only while both levels are rebuilt, so a zoom never
  // swaps a card for a copy in the other mode
  function takeEditMode() {
    isDrawnInEditMode = isEditMode;
    surfaceEl.classList.toggle('editing', isDrawnInEditMode);
  }

  // Turn the cards' text fields on or off, writing back what was typed, and rebuild the cards once the view is still
  function setEditMode(isEnabled) {
    isEditMode = isEnabled;
    paintEditToggle();
    editing.flush();
    editing.blurActiveField();
    if (!levels.liveLevel()) {
      takeEditMode();
      return;
    }

    folderZoom.rebuildAtRest();
    repaint();
    queueViewSave();
  }

  // Fly to full size about the middle of the view
  function showActualSize() {
    if (levels.liveLevel()) {
      folderZoom.flyToView(camera.actualSizeView());
    }
  }

  // Fly to the view that frames every live card
  function fitToCards() {
    if (levels.liveLevel()) {
      folderZoom.flyToView(folderZoom.fitLiveView());
    }
  }

  editToggleEl.addEventListener('click', () => setEditMode(!isEditMode));
  zoomOutEl.addEventListener('click', () => camera.zoomStep(-1, false));
  zoomInEl.addEventListener('click', () => camera.zoomStep(1, false));
  zoomLevelEl.addEventListener('click', showActualSize);
  zoomFitEl.addEventListener('click', fitToCards);

  // Open the background menu on a right-click in empty canvas space, the parent's inert cards included
  canvasEl.addEventListener('contextmenu', (event) => {
    if (!levels.liveLevel()) {
      return;
    }

    event.preventDefault();
    menus.showBackgroundMenu(event);
  });

  // Escape drops the caret, and the zoom keys only work when no card holds it
  document.addEventListener('keydown', (event) => {
    if (editing.isEditing()) {
      if (event.key === 'Escape') {
        editing.blurActiveField();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key === '+' || event.key === '=') {
      camera.zoomStep(1, event.repeat);
    } else if (event.key === '-') {
      camera.zoomStep(-1, event.repeat);
    } else if (event.key === '0') {
      showActualSize();
    }
  });

  // Write pending edits before the panel loses the keyboard, goes to the background, or reloads.
  // Save the latest view as well before a reload
  window.addEventListener('blur', () => editing.flush());
  window.addEventListener('pagehide', () => {
    editing.flush();
    saveViewState();
  });
  document.addEventListener('visibilitychange', () => editing.flush());

  // Rescale the previews when a window zoom changes how far a card's preview sits in from its edges
  window.addEventListener('resize', () => {
    if (cardBuilders.measure() && levels.liveLevel()) {
      cardBuilders.rescalePreviews(surfaceEl);
      levels.remeasure();
      refreshLook();
    }

    // Put note scroll back on a panel that was drawn with no layout
    cardBuilders.restoreNoteScroll(surfaceEl);
  });

  // --- inbound state ---

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') {
      receiveState(message.state, message.navigateNumber);
    } else if (message && message.type === 'noteView') {
      menus.setNoteView(message.view);
    } else if (message && message.type === 'previewColor') {
      colors.receivePreview(message.path, message.color);
    }
  });

  readSavedState();
  paintEditToggle();
  takeEditMode();
  vscode.postMessage({ type: 'ready' });
})();
