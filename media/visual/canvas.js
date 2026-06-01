(function () {
  const vscode = acquireVsCodeApi();

  const breadcrumbsEl = document.getElementById('breadcrumbs');
  const surfaceEl = document.getElementById('surface');
  const emptyEl = document.getElementById('empty');
  const menuEl = document.getElementById('context-menu');
  const canvasEl = document.getElementById('canvas');

  const DEFAULT_CARD_W = 240;
  const DEFAULT_CARD_H = 170;
  const MIN_CARD_W = 160;
  const MIN_CARD_H = 100;
  const SURFACE_MARGIN = 80;
  const DRAG_THRESHOLD = 3;
  const CARD_COLORS = JSON.parse(document.body.dataset.cardColors || '[]');

  let state = null;
  let cards = [];
  let cardEls = new Map();
  let menuCardPath = null;

  // --- helpers ---

  // grow the surface to hold every card plus room to drag into
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

  // tint the canvas backdrop with the open folder's color, clearing any previous tint
  function applyFolderTint(color) {
    for (const cls of [...canvasEl.classList]) {
      if (cls === 'surface-tinted' || cls.startsWith('color-')) {
        canvasEl.classList.remove(cls);
      }
    }
    if (color) {
      canvasEl.classList.add('surface-tinted', 'color-' + color);
    }
  }

  // set a card element's color classes, clearing any previous tint
  function applyCardColor(el, color) {
    for (const cls of [...el.classList]) {
      if (cls === 'colored' || cls.startsWith('color-')) {
        el.classList.remove(cls);
      }
    }
    if (color) {
      el.classList.add('colored', 'color-' + color);
    }
  }

  // raise a card above every other so the most recently dragged one stays on top
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

  // drag to reposition, or run onClick when the pointer barely moved
  function attachDrag(el, card, onClick) {
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      const startX = event.clientX;
      const startY = event.clientY;
      const originX = card.x;
      const originY = card.y;
      let dragging = false;
      el.setPointerCapture(event.pointerId);

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

  // drag the corner handle to resize the card
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
      const originW = card.width;
      const originH = card.height;
      handle.setPointerCapture(event.pointerId);

      const onMove = (move) => {
        card.width = Math.max(MIN_CARD_W, Math.round(originW + move.clientX - startX));
        card.height = Math.max(MIN_CARD_H, Math.round(originH + move.clientY - startY));
        el.style.width = card.width + 'px';
        el.style.height = card.height + 'px';
      };

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

  // shared card shell with an icon + title row, placed and sized at the card's saved spot
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
      showMenu(event.clientX, event.clientY, menuFor(card), card);
    });

    return el;
  }

  // a note card showing a text snippet, opens the note when clicked
  function noteCard(card) {
    const el = baseCard(card, 'codicon-note');
    applyCardColor(el, card.color);
    const text = (card.preview || '').trim();

    const preview = document.createElement('pre');
    preview.className = text ? 'preview' : 'preview empty';
    preview.textContent = text || '(empty)';
    el.appendChild(preview);

    attachDrag(el, card, () => {
      vscode.postMessage({ type: 'openNote', path: card.absPath });
    });
    attachResize(el, card);
    return el;
  }

  // a scaled-down, non-interactive copy of one child card for a folder preview
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

  // render the children at their real canvas positions, scaled down for the preview
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

    // the canvas extent measured from its (0, 0) origin, so cards keep their place in the preview
    let canvasW = 0;
    let canvasH = 0;
    for (const child of children) {
      canvasW = Math.max(canvasW, child.x + child.width);
      canvasH = Math.max(canvasH, child.y + child.height);
    }

    const miniSurface = document.createElement('div');
    miniSurface.className = 'mini-surface';
    miniSurface.style.width = canvasW + 'px';
    miniSurface.style.height = canvasH + 'px';
    for (const child of children) {
      miniSurface.appendChild(miniCard(child));
    }
    previewBox.appendChild(miniSurface);

    // scale against the box at the container's default size
    const observer = new ResizeObserver(() => {
      if (previewBox.clientWidth === 0 || previewBox.clientHeight === 0) {
        return;
      }
      const boxW = previewBox.clientWidth - (containerWidth - DEFAULT_CARD_W);
      const boxH = previewBox.clientHeight - (containerHeight - DEFAULT_CARD_H);
      const scale = Math.min(boxW / canvasW, boxH / canvasH);
      miniSurface.style.transform = `scale(${scale})`;
      observer.disconnect();
    });
    observer.observe(previewBox);
    return previewBox;
  }

  // a folder card showing a mini preview of its contents, drills in when clicked
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
  }

  // --- context menu ---

  // swatch row plus rename for both notes and folders
  function menuFor(card) {
    return [
      { kind: 'swatches', card },
      'sep',
      { label: 'Rename', cmd: 'promptStudio.rename' }
    ];
  }

  // the color currently saved for a card path
  function cardColorOf(absPath) {
    const card = cards.find((entry) => entry.absPath === absPath);
    return card ? card.color : undefined;
  }

  // tint the live card element for a path, without persisting
  function tintCard(absPath, color) {
    const el = cardEls.get(absPath);
    if (el) {
      applyCardColor(el, color);
    }
  }

  // apply the color to the live card, then persist it
  function recolor(absPath, color) {
    const card = cards.find((entry) => entry.absPath === absPath);
    if (card) {
      card.color = color || undefined;
    }
    tintCard(absPath, color);
    vscode.postMessage({ type: 'setColor', path: absPath, color: color || null });
  }

  // color dots with a leading clear-color swatch, hover previews the card and click commits
  function swatchRow(card) {
    const row = document.createElement('div');
    row.className = 'swatch-row';

    for (const color of [null, ...CARD_COLORS]) {
      const dot = document.createElement('span');
      dot.className = color ? 'swatch color-' + color : 'swatch none';
      dot.title = color || 'No color';
      if ((card.color || null) === color) {
        dot.classList.add('selected');
      }

      dot.addEventListener('mouseenter', () => tintCard(card.absPath, color));
      dot.addEventListener('mouseleave', () => tintCard(card.absPath, cardColorOf(card.absPath)));
      dot.addEventListener('click', () => {
        if (dot.classList.contains('selected')) {
          hideMenu();
          return;
        }

        for (const other of row.children) {
          other.classList.remove('selected');
        }
        dot.classList.add('selected');
        recolor(card.absPath, color);
      });
      row.appendChild(dot);
    }
    return row;
  }

  function showMenu(x, y, items, card) {
    menuCardPath = card.absPath;
    menuEl.replaceChildren();
    for (const entry of items) {
      if (entry === 'sep') {
        const sep = document.createElement('div');
        sep.className = 'menu-sep';
        menuEl.appendChild(sep);
        continue;
      }
      if (entry.kind === 'swatches') {
        menuEl.appendChild(swatchRow(entry.card));
        continue;
      }

      const item = document.createElement('div');
      item.className = 'menu-item';
      item.textContent = entry.label;
      item.addEventListener('click', () => {
        hideMenu();
        vscode.postMessage({ type: 'command', command: entry.cmd, node: serialize(card) });
      });
      menuEl.appendChild(item);
    }
    menuEl.classList.remove('hidden');

    const maxX = Math.max(0, window.innerWidth - menuEl.offsetWidth - 4);
    const maxY = Math.max(0, window.innerHeight - menuEl.offsetHeight - 4);
    menuEl.style.left = `${Math.min(x, maxX)}px`;
    menuEl.style.top = `${Math.min(y, maxY)}px`;
  }

  // close the menu, dropping any uncommitted hover preview back to the saved color
  function hideMenu() {
    if (menuCardPath !== null) {
      tintCard(menuCardPath, cardColorOf(menuCardPath));
      menuCardPath = null;
    }
    menuEl.classList.add('hidden');
  }

  function serialize(card) {
    return { kind: card.kind, absPath: card.absPath, name: card.name };
  }

  document.addEventListener('mousedown', (event) => {
    if (!menuEl.contains(event.target)) hideMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideMenu();
  });
  window.addEventListener('blur', hideMenu);
  canvasEl.addEventListener('scroll', hideMenu, true);

  // --- inbound state ---

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'state') {
      render(msg.state);
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
