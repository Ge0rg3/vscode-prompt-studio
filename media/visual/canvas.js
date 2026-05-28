(function () {
  const vscode = acquireVsCodeApi();

  const breadcrumbsEl = document.getElementById('breadcrumbs');
  const surfaceEl = document.getElementById('surface');
  const emptyEl = document.getElementById('empty');

  const CARD_W = 240;
  const CARD_H = 170;
  const SURFACE_MARGIN = 80;
  const DRAG_THRESHOLD = 3;

  let cards = [];

  // --- helpers ---

  // grow the surface to hold every card plus room to drag into
  function resizeSurface() {
    let maxX = 0;
    let maxY = 0;
    for (const card of cards) {
      maxX = Math.max(maxX, card.x + CARD_W);
      maxY = Math.max(maxY, card.y + CARD_H);
    }
    surfaceEl.style.width = maxX + SURFACE_MARGIN + 'px';
    surfaceEl.style.height = maxY + SURFACE_MARGIN + 'px';
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
          vscode.postMessage({ type: 'moveCard', path: card.absPath, x: card.x, y: card.y });
        } else {
          onClick();
        }
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  // --- card builders ---

  // shared card shell with an icon + title row, positioned at the card's saved spot
  function baseCard(card, iconName) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.left = card.x + 'px';
    el.style.top = card.y + 'px';

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

    return el;
  }

  function noteCard(card) {
    const el = baseCard(card, 'codicon-note');
    const text = (card.preview || '').trim();

    const preview = document.createElement('pre');
    preview.className = text ? 'preview' : 'preview empty';
    preview.textContent = text || '(empty)';
    el.appendChild(preview);

    attachDrag(el, card, () => {
      vscode.postMessage({ type: 'openNote', path: card.absPath });
    });
    return el;
  }

  function folderCard(card) {
    const el = baseCard(card, 'codicon-folder');

    const thumb = document.createElement('div');
    thumb.className = 'folder-thumb';
    const glyph = document.createElement('span');
    glyph.className = 'codicon codicon-folder';
    thumb.appendChild(glyph);
    el.appendChild(thumb);

    attachDrag(el, card, () => {
      vscode.postMessage({ type: 'navigate', folder: card.absPath });
    });
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

  function render(state) {
    cards = state.cards;
    renderBreadcrumbs(state.breadcrumbs);
    surfaceEl.replaceChildren();
    emptyEl.classList.toggle('hidden', cards.length > 0);
    for (const card of cards) {
      surfaceEl.appendChild(card.kind === 'folder' ? folderCard(card) : noteCard(card));
    }
    resizeSurface();
  }

  // --- inbound state ---

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'state') {
      render(msg.state);
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
