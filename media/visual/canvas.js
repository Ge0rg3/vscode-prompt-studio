(function () {
  const vscode = acquireVsCodeApi();

  const breadcrumbsEl = document.getElementById('breadcrumbs');
  const boardEl = document.getElementById('board');
  const emptyEl = document.getElementById('empty');

  // --- card builders ---

  // shared card shell with an icon + title row
  function baseCard(card, iconName) {
    const el = document.createElement('div');
    el.className = 'card';

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

    el.addEventListener('click', () => {
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

    el.addEventListener('click', () => {
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
    renderBreadcrumbs(state.breadcrumbs);
    boardEl.replaceChildren();
    emptyEl.classList.toggle('hidden', state.cards.length > 0);
    for (const card of state.cards) {
      boardEl.appendChild(card.kind === 'folder' ? folderCard(card) : noteCard(card));
    }
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
