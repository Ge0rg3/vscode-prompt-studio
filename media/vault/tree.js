(function () {
  const vscode = acquireVsCodeApi();

  let state = null;
  const expanded = new Set();
  let selectedPath = null;
  let dragSource = null;

  const treeEl = document.getElementById('tree');
  const menuEl = document.getElementById('context-menu');

  // --- focus tracking ---

  // toggle the body class so .selected rows render as active vs inactive
  function setFocused(value) {
    document.body.classList.toggle('focused', value);
  }
  document.addEventListener('focusin', () => setFocused(true));
  document.addEventListener('focusout', () => setFocused(false));
  window.addEventListener('focus', () => setFocused(true));
  window.addEventListener('blur', () => setFocused(false));

  // --- inbound state ---

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'state') {
      state = msg.state;
      render();
    } else if (msg.type === 'expandAll') {
      expandAll();
    } else if (msg.type === 'collapseAll') {
      expanded.clear();
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });

  // --- rendering ---

  function render() {
    treeEl.replaceChildren();
    if (!state) {
      renderWelcome();
      return;
    }
    if (state.children.length === 0) {
      renderEmptyHint();
      return;
    }
    for (const node of state.children) {
      renderNode(node, 0);
    }
  }

  function renderWelcome() {
    const wrap = document.createElement('div');
    wrap.id = 'welcome';

    const para = document.createElement('p');
    para.textContent = 'No vault is configured.';
    wrap.appendChild(para);

    const btn = document.createElement('button');
    btn.textContent = 'Configure Vault';
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: 'command', command: 'promptStudio.configureVault' });
    });
    wrap.appendChild(btn);

    treeEl.appendChild(wrap);
  }

  function renderEmptyHint() {
    const hint = document.createElement('div');
    hint.id = 'empty-hint';
    hint.textContent = 'Right-click to create a note or folder.';
    treeEl.appendChild(hint);
  }

  function renderNode(node, depth) {
    const isFolder = node.kind === 'folder';
    const isOpen = isFolder && expanded.has(node.absPath);

    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.path = node.absPath;
    row.dataset.kind = node.kind;
    if (node.absPath === selectedPath) {
      row.classList.add('selected');
    }
    if (node.color) {
      row.classList.add('colored', 'color-' + node.color);
    }

    for (let level = 0; level < depth; level++) {
      const guide = document.createElement('span');
      guide.className = 'indent-guide';
      row.appendChild(guide);
    }

    const indent = document.createElement('span');
    indent.className = 'indent';
    row.appendChild(indent);

    const twisty = document.createElement('span');
    twisty.className = 'twisty';
    if (isFolder) {
      const chev = document.createElement('span');
      chev.className = `codicon codicon-chevron-${isOpen ? 'down' : 'right'}`;
      twisty.appendChild(chev);
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExpand(node);
      });
    } else {
      twisty.classList.add('empty');
    }
    row.appendChild(twisty);

    const icon = document.createElement('span');
    icon.className = 'icon';
    const iconName = isFolder ? (isOpen ? 'codicon-folder-opened' : 'codicon-folder') : 'codicon-note';
    const iconGlyph = document.createElement('span');
    iconGlyph.className = `codicon ${iconName}`;
    icon.appendChild(iconGlyph);
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = isFolder ? node.name : stripMdExt(node.name);
    row.appendChild(label);

    if (isFolder) {
      const actions = document.createElement('span');
      actions.className = 'actions';
      const canvasAction = document.createElement('span');
      canvasAction.className = 'action codicon codicon-layout';
      canvasAction.title = 'Open Visual Canvas';
      canvasAction.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({
          type: 'command',
          command: 'promptStudio.openVisual',
          node: serialize(node)
        });
      });
      actions.appendChild(canvasAction);
      row.appendChild(actions);
    }

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      select(node.absPath);
      if (isFolder) {
        toggleExpand(node);
      } else {
        vscode.postMessage({ type: 'openNote', path: node.absPath });
      }
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      select(node.absPath);
      showMenu(e.clientX, e.clientY, menuFor(node), node);
    });

    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      dragSource = node.absPath;
      e.dataTransfer.setData('text/plain', node.absPath);
      e.dataTransfer.effectAllowed = 'move';
    });

    if (isFolder) {
      row.addEventListener('dragover', (e) => {
        if (!canDrop(dragSource, node.absPath)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (e) => {
        row.classList.remove('drop-target');
        e.preventDefault();
        e.stopPropagation();
        const src = dragSource || e.dataTransfer.getData('text/plain');
        dragSource = null;
        if (!canDrop(src, node.absPath)) return;
        vscode.postMessage({ type: 'move', source: src, destDir: node.absPath });
      });
    }

    treeEl.appendChild(row);

    if (isFolder && isOpen && node.children) {
      for (const child of node.children) {
        renderNode(child, depth + 1);
      }
    }
  }

  function stripMdExt(name) {
    return name.replace(/\.md$/i, '');
  }

  function toggleExpand(node) {
    if (expanded.has(node.absPath)) {
      expanded.delete(node.absPath);
    } else {
      expanded.add(node.absPath);
    }
    render();
  }

  function expandAll() {
    if (!state) return;
    addFolderPaths(state.children);
    render();
  }

  function addFolderPaths(nodes) {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        expanded.add(node.absPath);
        if (node.children) {
          addFolderPaths(node.children);
        }
      }
    }
  }

  function select(path) {
    selectedPath = path;
    for (const row of treeEl.querySelectorAll('.row.selected')) {
      row.classList.remove('selected');
    }
    if (!path) return;
    for (const row of treeEl.querySelectorAll('.row')) {
      if (row.dataset.path === path) {
        row.classList.add('selected');
        break;
      }
    }
  }

  // reject self-into-self moves and same-parent no-ops
  function canDrop(src, destDir) {
    if (!src || !destDir) return false;
    if (src === destDir) return false;
    if (destDir.startsWith(src + '/') || destDir.startsWith(src + '\\')) return false;
    const parent = src.replace(/[\/\\][^\/\\]+$/, '');
    if (parent === destDir) return false;
    return true;
  }

  // --- empty-area handlers ---

  treeEl.addEventListener('click', (e) => {
    if (e.target.closest('.row')) return;
    select(null);
  });

  treeEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.row')) return;
    if (!state) return;
    e.preventDefault();
    select(null);
    showMenu(e.clientX, e.clientY, emptyMenu(), null);
  });

  treeEl.addEventListener('dragover', (e) => {
    if (!state) return;
    if (e.target.closest('.row')) return;
    if (!canDrop(dragSource, state.root)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  treeEl.addEventListener('drop', (e) => {
    if (!state) return;
    if (e.target.closest('.row')) return;
    e.preventDefault();
    const src = dragSource || e.dataTransfer.getData('text/plain');
    dragSource = null;
    if (!canDrop(src, state.root)) return;
    vscode.postMessage({ type: 'move', source: src, destDir: state.root });
  });

  // --- context menu ---

  function menuFor(node) {
    if (node.kind === 'note') {
      return [
        { label: 'Open', icon: 'go-to-file', action: () => vscode.postMessage({ type: 'openNote', path: node.absPath }) },
        'sep',
        { label: 'Rename', icon: 'edit', cmd: 'promptStudio.rename' },
        { label: 'Copy Contents', icon: 'copy', cmd: 'promptStudio.copyContents' },
        'sep',
        { label: 'Reveal in Explorer', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
        { label: 'Copy as Path', icon: 'file-symlink-file', cmd: 'promptStudio.copyPath' }
      ];
    }
    return [
      { label: 'Open as Canvas', icon: 'layout', cmd: 'promptStudio.openVisual' },
      'sep',
      { label: 'New Note', icon: 'new-file', cmd: 'promptStudio.newNote', expandFolder: true },
      { label: 'New Folder', icon: 'new-folder', cmd: 'promptStudio.newFolder', expandFolder: true },
      'sep',
      { label: 'Rename', icon: 'edit', cmd: 'promptStudio.rename' },
      'sep',
      { label: 'Reveal in Explorer', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
      { label: 'Copy as Path', icon: 'file-symlink-file', cmd: 'promptStudio.copyPath' }
    ];
  }

  function emptyMenu() {
    return [
      { label: 'Open as Canvas', icon: 'layout', cmd: 'promptStudio.openVisual' },
      'sep',
      { label: 'New Note', icon: 'new-file', cmd: 'promptStudio.newNote' },
      { label: 'New Folder', icon: 'new-folder', cmd: 'promptStudio.newFolder' }
    ];
  }

  function showMenu(x, y, items, node) {
    menuEl.replaceChildren();
    for (const entry of items) {
      if (entry === 'sep') {
        const sep = document.createElement('div');
        sep.className = 'menu-sep';
        menuEl.appendChild(sep);
        continue;
      }
      const item = document.createElement('div');
      item.className = 'menu-item';
      const icon = document.createElement('span');
      icon.className = `codicon codicon-${entry.icon}`;
      const label = document.createElement('span');
      label.textContent = entry.label;
      item.appendChild(icon);
      item.appendChild(label);

      item.addEventListener('click', () => {
        hideMenu();
        if (entry.action) {
          entry.action();
          return;
        }
        if (entry.expandFolder && node && node.kind === 'folder') {
          expanded.add(node.absPath);
          render();
        }
        vscode.postMessage({
          type: 'command',
          command: entry.cmd,
          node: node ? serialize(node) : undefined
        });
      });
      menuEl.appendChild(item);
    }
    menuEl.classList.remove('hidden');

    const width = menuEl.offsetWidth;
    const height = menuEl.offsetHeight;
    const maxX = Math.max(0, window.innerWidth - width - 4);
    const maxY = Math.max(0, window.innerHeight - height - 4);
    menuEl.style.left = `${Math.min(x, maxX)}px`;
    menuEl.style.top = `${Math.min(y, maxY)}px`;
  }

  function hideMenu() {
    menuEl.classList.add('hidden');
  }

  function serialize(node) {
    return { kind: node.kind, absPath: node.absPath, name: node.name };
  }

  document.addEventListener('mousedown', (e) => {
    if (!menuEl.contains(e.target)) hideMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideMenu();
  });
  window.addEventListener('blur', hideMenu);
  window.addEventListener('scroll', hideMenu, true);
})();
