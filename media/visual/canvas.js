// Renders the card canvas and posts moves, colors, and commands back to the host
(function () {
  const vscode = acquireVsCodeApi();

  const breadcrumbsEl = document.getElementById('breadcrumbs');
  const surfaceEl = document.getElementById('surface');
  const emptyEl = document.getElementById('empty');
  const menuEl = document.getElementById('context-menu');
  const canvasEl = document.getElementById('canvas');

  const DEFAULT_CARD_WIDTH = 240;
  const DEFAULT_CARD_HEIGHT = 170;
  const MIN_CARD_WIDTH = 160;
  const MIN_CARD_HEIGHT = 100;
  const SURFACE_MARGIN = 80;
  const DRAG_THRESHOLD = 3;
  const CARD_COLORS = JSON.parse(document.body.dataset.cardColors || '[]');
  const ALLOW_CRUD = document.body.dataset.allowCrud === 'true';

  let state = null;
  let cards = [];
  let cardEls = new Map();
  let activePreview = null;
  let noteView = window.PromptStudioNoteOpen.INITIAL_NOTE_VIEW;

  const { create, COPY_PATH_ITEM } = window.PromptStudioContextMenu;
  const { applyTint } = window.PromptStudioPalette;
  const { alternateOpen } = window.PromptStudioNoteOpen;

  // Build the context menu shared by the cards and the background
  const menu = create(menuEl, (command, node) => vscode.postMessage({ type: 'command', command, node: serialize(node) }), CARD_COLORS);

  // --- helpers ---

  // Grow the surface to hold every card plus room to drag into
  function resizeSurface() {
    let maxX = 0;
    let maxY = 0;
    for (const card of cards) {
      maxX = Math.max(maxX, card.x + card.width);
      maxY = Math.max(maxY, card.y + card.height);
    }
    surfaceEl.style.width = maxX + SURFACE_MARGIN + 'px';
    surfaceEl.style.height = maxY + SURFACE_MARGIN + 'px';
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

  // Check whether a pointerdown landed on the element's scrollbar
  function isScrollbarPress(event) {
    const target = event.target;
    return event.offsetX > target.clientWidth || event.offsetY > target.clientHeight;
  }

  // Drag a card to a new spot, or run onClick when the pointer barely moved
  function attachDrag(el, card, onClick) {
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      if (isScrollbarPress(event)) {
        return;
      }

      const startX = event.clientX;
      const startY = event.clientY;
      const originX = card.x;
      const originY = card.y;
      let dragging = false;
      el.setPointerCapture(event.pointerId);

      // Follow the pointer once it has moved past the drag threshold
      const onMove = (move) => {
        const dx = move.clientX - startX;
        const dy = move.clientY - startY;
        if (!dragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
          dragging = true;
          el.classList.add('dragging');
          bringToFront(card, el);
        }
        if (dragging) {
          card.x = Math.max(0, Math.round(originX + dx));
          card.y = Math.max(0, Math.round(originY + dy));
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
          resizeSurface();
          vscode.postMessage({ type: 'moveCard', path: card.absPath, x: card.x, y: card.y, z: card.z });
        } else {
          onClick();
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
      const startX = event.clientX;
      const startY = event.clientY;
      const originWidth = card.width;
      const originHeight = card.height;
      handle.setPointerCapture(event.pointerId);

      // Resize the card as the pointer moves
      const onMove = (move) => {
        card.width = Math.max(MIN_CARD_WIDTH, Math.round(originWidth + move.clientX - startX));
        card.height = Math.max(MIN_CARD_HEIGHT, Math.round(originHeight + move.clientY - startY));
        el.style.width = card.width + 'px';
        el.style.height = card.height + 'px';
      };

      // Save the new size on release
      const onUp = () => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        resizeSurface();
        vscode.postMessage({ type: 'resizeCard', path: card.absPath, width: card.width, height: card.height });
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
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

  // Build a note card that shows the note body and opens the note when clicked
  function noteCard(card) {
    const el = baseCard(card, 'codicon-note');
    applyCardColor(el, card.color);
    const text = (card.preview || '').trim();

    const preview = document.createElement('pre');
    preview.className = text ? 'preview' : 'preview empty';
    preview.textContent = text || '(empty)';
    el.appendChild(preview);

    attachDrag(el, card, () => {
      vscode.postMessage({ type: 'openNote', node: serialize(card) });
    });
    attachResize(el, card);
    return el;
  }

  // Build a copy of one child card for a folder preview, with no dragging or menus
  function miniCard(child) {
    const el = document.createElement('div');
    el.className = 'mini-card';
    el.style.left = child.x + 'px';
    el.style.top = child.y + 'px';
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
      preview.className = 'mini-preview';
      preview.textContent = (child.preview || '').trim();
      el.appendChild(preview);
    } else {
      el.appendChild(folderPreview(child.children || [], child.width, child.height));
    }
    return el;
  }

  // Draw the children at their real canvas positions, scaled down for the preview
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

    // Measure how far the children reach from the (0, 0) origin
    let canvasWidth = 0;
    let canvasHeight = 0;
    for (const child of children) {
      canvasWidth = Math.max(canvasWidth, child.x + child.width);
      canvasHeight = Math.max(canvasHeight, child.y + child.height);
    }

    const miniSurface = document.createElement('div');
    miniSurface.className = 'mini-surface';
    miniSurface.style.width = canvasWidth + 'px';
    miniSurface.style.height = canvasHeight + 'px';
    for (const child of children) {
      miniSurface.appendChild(miniCard(child));
    }
    previewBox.appendChild(miniSurface);

    // Scale against the default card size, so a bigger card reveals more of the preview
    const observer = new ResizeObserver(() => {
      if (previewBox.clientWidth === 0 || previewBox.clientHeight === 0) {
        return;
      }
      const boxWidth = previewBox.clientWidth - (containerWidth - DEFAULT_CARD_WIDTH);
      const boxHeight = previewBox.clientHeight - (containerHeight - DEFAULT_CARD_HEIGHT);
      const scale = Math.min(boxWidth / canvasWidth, boxHeight / canvasHeight);
      miniSurface.style.transform = `scale(${scale})`;
      observer.disconnect();
    });
    observer.observe(previewBox);
    return previewBox;
  }

  // Build a folder card with a small preview of its contents, opening the folder when clicked
  function folderCard(card) {
    const el = baseCard(card, 'codicon-folder');
    applyCardColor(el, card.color);
    el.appendChild(folderPreview(card.children || [], card.width, card.height));

    attachDrag(el, card, () => {
      vscode.postMessage({ type: 'navigate', folder: card.absPath });
    });
    attachResize(el, card);
    return el;
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
        el.addEventListener('click', () => {
          vscode.postMessage({ type: 'navigate', folder: crumb.path });
        });
      }
      breadcrumbsEl.appendChild(el);
    }
  }

  // Redraw the whole canvas from a new state
  function render(next) {
    state = next;
    cards = state.cards;
    cardEls = new Map();
    renderBreadcrumbs(state.breadcrumbs);
    applyFolderTint(state.folderColor);
    surfaceEl.replaceChildren();
    emptyEl.classList.toggle('hidden', cards.length > 0);
    for (const card of cards) {
      const el = card.kind === 'folder' ? folderCard(card) : noteCard(card);
      cardEls.set(card.absPath, el);
      surfaceEl.appendChild(el);
    }
    resizeSurface();
    reapplyPreview();
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
        { label: 'Open', icon: 'go-to-file', action: () => vscode.postMessage({ type: 'openNote', node: serialize(card) }) },
        { label: alternate.label, icon: alternate.icon, action: () => vscode.postMessage(alternate.message) },
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
    const rect = surfaceEl.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(event.clientX - rect.left - DEFAULT_CARD_WIDTH / 2)),
      y: Math.max(0, Math.round(event.clientY - rect.top - DEFAULT_CARD_HEIGHT / 2))
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

  // --- inbound state ---

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') {
      render(message.state);

      // Save what VSCode needs to restore the canvas after a reload
      vscode.setState({ folder: currentFolderNode().absPath, root: state.breadcrumbs[0].path, allowCrud: ALLOW_CRUD });
    } else if (message && message.type === 'noteView') {
      noteView = message.view;
    } else if (message && message.type === 'previewColor') {
      applyIncomingPreview(message.path, message.color);
      trackPreview(message.path, message.color);
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
