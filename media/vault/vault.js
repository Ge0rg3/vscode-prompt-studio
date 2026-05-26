(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('tree-root');

  const expanded = new Set();
  let tree = null;
  let selectedPath = null;
  let didAutoExpandRoot = false;
  let draggingPath = null;

  // track window focus so active vs inactive selection styling stays in sync
  document.addEventListener('focusin', () => document.body.classList.add('focused'));
  document.addEventListener('focusout', () => document.body.classList.remove('focused'));
  window.addEventListener('focus', () => document.body.classList.add('focused'));
  window.addEventListener('blur', () => document.body.classList.remove('focused'));

  root.addEventListener('dragover', (e) => {
    if (!draggingPath) return;
    const targetDir = resolveDropTarget(e.target);
    if (!targetDir) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    highlightDropTarget(targetDir);
  });
  root.addEventListener('dragleave', (e) => {
    if (e.target === root) clearDropTargets();
  });
  root.addEventListener('drop', (e) => {
    if (!draggingPath) return;
    const targetDir = resolveDropTarget(e.target);
    if (!targetDir) return;
    e.preventDefault();
    const source = draggingPath;
    draggingPath = null;
    clearDropTargets();
    vscode.postMessage({ type: 'moveEntry', source: source, targetDir: targetDir });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'tree') {
      tree = msg.tree;
      if (tree && !didAutoExpandRoot) {
        expanded.add(tree.absPath);
        didAutoExpandRoot = true;
      }
      render();
    } else if (msg.type === 'noVault') {
      tree = null;
      renderEmptyState();
    }
  });

  // rebuild the whole tree on every state change, fresh top-down
  function render() {
    root.replaceChildren();
    if (!tree) return;
    renderNode(tree, 0, true);
  }

  // empty-state placeholder with a button into the configure flow
  function renderEmptyState() {
    root.replaceChildren();

    const wrap = document.createElement('div');
    wrap.className = 'empty-state';

    const message = document.createElement('p');
    message.className = 'empty-message';
    message.textContent = 'No vault is configured.';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'empty-button';
    button.textContent = 'Configure Vault';
    button.addEventListener('click', () => {
      vscode.postMessage({ type: 'configureVault' });
    });

    wrap.appendChild(message);
    wrap.appendChild(button);
    root.appendChild(wrap);
  }

  // append one row plus its visible descendants
  function renderNode(node, depth, isRoot) {
    const row = document.createElement('div');
    row.className = 'row ' + node.kind + (isRoot ? ' root' : '');
    row.style.paddingLeft = (6 + depth * 14) + 'px';
    row.dataset.path = node.absPath;
    row.dataset.kind = node.kind;
    row.tabIndex = 0;
    row.draggable = !isRoot;
    row.setAttribute('role', 'treeitem');
    if (node.kind === 'folder') {
      row.setAttribute('aria-expanded', expanded.has(node.absPath) ? 'true' : 'false');
    }
    if (node.absPath === selectedPath) row.classList.add('selected');

    row.appendChild(makeChevron(node));
    row.appendChild(makeIcon(node));
    row.appendChild(makeLabel(node, isRoot));

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      select(node.absPath, node.kind);
      if (node.kind === 'folder') toggle(node.absPath);
      else openNote(node.absPath);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(node.absPath, node.kind);
        if (node.kind === 'folder') toggle(node.absPath);
        else openNote(node.absPath);
      }
    });
    row.addEventListener('dragstart', (e) => {
      if (isRoot) {
        e.preventDefault();
        return;
      }
      draggingPath = node.absPath;
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', node.absPath);
        e.dataTransfer.effectAllowed = 'move';
      }
    });
    row.addEventListener('dragend', () => {
      draggingPath = null;
      clearDropTargets();
    });

    root.appendChild(row);

    if (node.kind === 'folder' && expanded.has(node.absPath) && node.children) {
      for (const child of node.children) {
        renderNode(child, depth + 1, false);
      }
    }
  }

  function makeChevron(node) {
    const el = document.createElement('span');
    el.className = 'chevron codicon';
    if (node.kind !== 'folder') {
      el.classList.add('placeholder');
      return el;
    }
    el.classList.add(expanded.has(node.absPath) ? 'codicon-chevron-down' : 'codicon-chevron-right');
    return el;
  }

  function makeIcon(node) {
    const el = document.createElement('span');
    el.className = 'icon codicon';
    if (node.kind === 'folder') {
      el.classList.add(expanded.has(node.absPath) ? 'codicon-folder-opened' : 'codicon-folder');
    } else {
      el.classList.add('codicon-markdown');
    }
    return el;
  }

  function makeLabel(node, isRoot) {
    const el = document.createElement('span');
    el.className = 'label';
    el.textContent = node.kind === 'note' && !isRoot ? stripMdExt(node.name) : node.name;
    return el;
  }

  function toggle(absPath) {
    if (expanded.has(absPath)) expanded.delete(absPath);
    else expanded.add(absPath);
    render();
  }

  function select(absPath, kind) {
    selectedPath = absPath;
    for (const el of root.querySelectorAll('.row.selected')) {
      el.classList.remove('selected');
    }
    for (const el of root.querySelectorAll('.row')) {
      if (el.dataset.path === absPath) {
        el.classList.add('selected');
        break;
      }
    }
    vscode.postMessage({ type: 'selectionChanged', path: absPath, kind: kind });
  }

  function openNote(absPath) {
    vscode.postMessage({ type: 'openNote', path: absPath });
  }

  function stripMdExt(name) {
    return name.replace(/\.md$/i, '');
  }

  // resolve which folder a drop event lands in, null when the gesture is invalid
  function resolveDropTarget(element) {
    const row = element && element.closest ? element.closest('.row') : null;
    if (row) {
      if (row.dataset.kind !== 'folder') return null;
      const folderPath = row.dataset.path;
      if (folderPath === draggingPath) return null;
      if (pathContains(draggingPath, folderPath)) return null;
      return folderPath;
    }
    return tree ? tree.absPath : null;
  }

  function highlightDropTarget(targetPath) {
    clearDropTargets();
    for (const el of root.querySelectorAll('.row')) {
      if (el.dataset.path === targetPath) {
        el.classList.add('drop-target');
        break;
      }
    }
  }

  function clearDropTargets() {
    for (const el of root.querySelectorAll('.drop-target')) {
      el.classList.remove('drop-target');
    }
  }

  // true when descendant equals or sits beneath ancestor, separator-agnostic
  function pathContains(ancestor, descendant) {
    if (!ancestor || !descendant) return false;
    if (descendant === ancestor) return true;
    return descendant.startsWith(ancestor + '/') || descendant.startsWith(ancestor + '\\');
  }

  vscode.postMessage({ type: 'ready' });
})();
