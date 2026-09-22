// Renders the vault sidebar tree with its selection, inline rename, drag moves, and menus
(function () {
  const vscode = acquireVsCodeApi();

  let state = null;
  const expanded = new Set();
  let selectedPath = null;
  let clipboardPath = null;
  let dragSource = null;
  let activePreview = null;
  let activeRename = null;
  let hasDeferredRender = false;
  let noteView = window.PromptStudioNoteOpen.INITIAL_NOTE_VIEW;

  const treeEl = document.getElementById('tree');
  const menuEl = document.getElementById('context-menu');
  const CARD_COLORS = JSON.parse(document.body.dataset.cardColors || '[]');
  const { applyTint } = window.PromptStudioPalette;
  const { alternateOpen } = window.PromptStudioNoteOpen;

  // --- focus tracking ---

  // Toggle the body class so the selected row uses the active highlight
  function setFocused(isFocused) {
    document.body.classList.toggle('focused', isFocused);
  }
  document.addEventListener('focusin', () => setFocused(true));
  document.addEventListener('focusout', () => setFocused(false));
  window.addEventListener('focus', () => setFocused(true));
  window.addEventListener('blur', () => setFocused(false));

  // --- keyboard ---

  // Rename the selected entry on F2
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'F2' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (!state || !selectedPath || !rowFor(selectedPath)) {
      return;
    }
    const node = findNode(selectedPath, state.children);
    if (node) {
      event.preventDefault();
      beginRename(node);
    }
  });

  // Delete the selected entry on Delete
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (activeRename || !state || !selectedPath || !rowFor(selectedPath)) {
      return;
    }
    const node = findNode(selectedPath, state.children);
    if (node) {
      event.preventDefault();
      postCommand('promptStudio.delete', node);
    }
  });

  // Copy the selected entry on ctrl/cmd C, paste a duplicate on V
  document.addEventListener('keydown', (event) => {
    if (activeRename || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'c') {
      if (state && selectedPath && findNode(selectedPath, state.children)) {
        clipboardPath = selectedPath;
      }
    } else if (key === 'v') {
      if (!state || !clipboardPath) {
        return;
      }
      event.preventDefault();
      const context = selectedPath ? findNode(selectedPath, state.children) : null;
      vscode.postMessage({
        type: 'paste',
        source: clipboardPath,
        contextNode: context ? serialize(context) : undefined
      });
    }
  });

  // --- inline rename ---

  // Explain why a name is invalid for this node, null when the name is fine
  function renameError(candidateName, node) {
    const name = candidateName.trim();
    if (!name) {
      return 'A name is required';
    }
    if (name.startsWith('.')) {
      return 'Name must not start with a dot';
    }
    if (/[\\/:*?"<>|]/.test(name)) {
      return 'Name must not contain / \\ : * ? " < > |';
    }
    if (hasSiblingNamed(node, name)) {
      return 'A file or folder with that name already exists';
    }
    return null;
  }

  // Strip the last segment off a path
  function parentDir(absPath) {
    return absPath.replace(/[\/\\][^\/\\]+$/, '');
  }

  // List everything in the folder that holds the given path
  function siblingsOf(absPath) {
    const parentPath = parentDir(absPath);
    if (parentPath === state.root) {
      return state.children;
    }
    const parent = findNode(parentPath, state.children);
    return parent && parent.children ? parent.children : [];
  }

  // Check whether another entry in the same folder already uses the name
  function hasSiblingNamed(node, name) {
    const target = (node.kind === 'note' ? ensureMdExt(name) : name).toLowerCase();
    for (const sibling of siblingsOf(node.absPath)) {
      if (sibling.absPath !== node.absPath && sibling.name.toLowerCase() === target) {
        return true;
      }
    }
    return false;
  }

  // Flag the input while its value is invalid
  function validateRename() {
    if (!activeRename) {
      return;
    }
    const error = renameError(activeRename.input.value, activeRename.node);
    activeRename.input.classList.toggle('invalid', Boolean(error));
    activeRename.input.title = error || '';
  }

  // Swap the editing input back for a label carrying the given text
  function endRename(text) {
    const rename = activeRename;
    activeRename = null;
    const shouldKeepFocus = document.activeElement === rename.input;
    rename.row.draggable = true;
    rename.label.textContent = text;
    rename.input.replaceWith(rename.label);
    if (shouldKeepFocus) {
      treeEl.focus();
    }
  }

  // Put the original name back and end the edit
  function cancelRename() {
    if (!activeRename) {
      return;
    }
    endRename(activeRename.original);

    // Apply any state update that arrived mid-edit
    if (hasDeferredRender) {
      render();
    }
  }

  // Send a valid, changed name to the host, staying open while it is invalid
  function commitRename() {
    if (!activeRename) {
      return;
    }
    const { node, original, input } = activeRename;
    const value = input.value.trim();
    if (!value || value === original) {
      cancelRename();
      return;
    }
    if (renameError(value, node)) {
      return;
    }

    const fullName = node.kind === 'note' ? ensureMdExt(value) : value;
    selectedPath = node.absPath.slice(0, node.absPath.length - node.name.length) + fullName;
    endRename(node.kind === 'note' ? stripMdExt(value) : value);
    vscode.postMessage({ type: 'rename', node: serialize(node), newName: value });
  }

  // Turn a row's label into an editable name field
  function beginRename(node) {
    if (activeRename) {
      return;
    }

    const row = rowFor(node.absPath);
    const label = row ? row.querySelector('.label') : null;
    if (!label) {
      return;
    }

    // Swap the label for an input holding the current name
    const original = label.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = original;
    input.spellcheck = false;
    row.draggable = false;
    label.replaceWith(input);
    activeRename = { node, row, input, label, original };

    // Finish on Enter, Escape, or blur, and keep clicks and drags off the row
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commitRename();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelRename();
      }
    });
    input.addEventListener('input', validateRename);
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('dragstart', (event) => event.stopPropagation());
    input.addEventListener('blur', () => {
      if (!activeRename) {
        return;
      }
      const value = activeRename.input.value.trim();
      if (!value || value === activeRename.original || renameError(value, activeRename.node)) {
        cancelRename();
      } else {
        commitRename();
      }
    });

    input.focus();
    input.select();
    validateRename();
  }

  // --- inbound state ---

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;
    if (message.type === 'state') {
      // Drop the rename, the copied entry, and the selection when the tree switches to another vault
      const nextRoot = message.state ? message.state.root : null;
      if (state && nextRoot !== state.root) {
        cancelRename();
        clipboardPath = null;
        selectedPath = null;
      }

      state = message.state;
      renderUnlessRenaming();
    } else if (message.type === 'noteView') {
      noteView = message.view;

      // Wait for the first state before drawing
      if (state) {
        renderUnlessRenaming();
      }
    } else if (message.type === 'expandAll') {
      expandAll();
    } else if (message.type === 'collapseAll') {
      expanded.clear();
      render();
    } else if (message.type === 'select') {
      select(message.path);
    } else if (message.type === 'reveal') {
      reveal(message.path);
    } else if (message.type === 'previewColor') {
      tintRow(message.path, message.color);
      trackPreview(message.path, message.color);
    }
  });

  // --- rendering ---

  // Redraw, holding the update back until an open rename is finished
  function renderUnlessRenaming() {
    if (activeRename) {
      hasDeferredRender = true;
      return;
    }

    render();
  }

  // Rebuild every row from the current state, dropping any edit in progress
  function render() {
    activeRename = null;
    hasDeferredRender = false;
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
    reapplyPreview();
  }

  // Offer the settings page when there is no vault yet
  function renderWelcome() {
    const welcome = document.createElement('div');
    welcome.id = 'welcome';

    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No vault yet.';
    welcome.appendChild(emptyMessage);

    const openSettingsButton = document.createElement('button');
    openSettingsButton.textContent = 'Open Settings';
    openSettingsButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'command', command: 'promptStudio.openSettings' });
    });
    welcome.appendChild(openSettingsButton);

    treeEl.appendChild(welcome);
  }

  function renderEmptyHint() {
    const hint = document.createElement('div');
    hint.id = 'empty-hint';
    hint.textContent = 'Right-click to create a note or folder.';
    treeEl.appendChild(hint);
  }

  // Set a row's color classes, clearing any previous tint
  function applyRowColor(row, color) {
    applyTint(row, color, 'colored');
  }

  // Build a row icon that runs its action without selecting the row
  function actionButton(icon, title, onClick) {
    const action = document.createElement('span');
    action.className = `action codicon codicon-${icon}`;
    action.title = title;
    action.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return action;
  }

  // Draw one row, then the rows under it when the folder is open
  function renderNode(node, depth) {
    const isFolder = node.kind === 'folder';
    const isOpen = isFolder && expanded.has(node.absPath);

    // Build the row and tint it
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.path = node.absPath;
    row.dataset.kind = node.kind;
    if (node.absPath === selectedPath) {
      row.classList.add('selected');
    }
    applyRowColor(row, node.color);

    // Draw one indent guide per ancestor level
    for (let level = 0; level < depth; level++) {
      const guide = document.createElement('span');
      guide.className = 'indent-guide';
      row.appendChild(guide);
    }

    const indent = document.createElement('span');
    indent.className = 'indent';
    row.appendChild(indent);

    // Add a chevron on a folder row, an empty slot on a note row
    const twisty = document.createElement('span');
    twisty.className = 'twisty';
    if (isFolder) {
      const chevron = document.createElement('span');
      chevron.className = `codicon codicon-chevron-${isOpen ? 'down' : 'right'}`;
      twisty.appendChild(chevron);
      twisty.addEventListener('click', (event) => {
        event.stopPropagation();
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

    // Add the icons that show when the row is hovered
    const actions = document.createElement('span');
    actions.className = 'actions';

    if (!isFolder) {
      const alternate = alternateOpen(noteView, serialize(node));
      actions.appendChild(actionButton(alternate.icon, alternate.label, () => vscode.postMessage(alternate.message)));
      actions.appendChild(actionButton('claude', 'Send to Claude', () => postCommand('promptStudio.sendToClaude', node)));
    }
    actions.appendChild(actionButton('layout', 'Open Visual Canvas', () => postCommand('promptStudio.openVisual', node)));
    row.appendChild(actions);

    // Toggle a folder on click, open a note in whichever view the setting names
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      select(node.absPath);
      if (isFolder) {
        toggleExpand(node);
      } else {
        vscode.postMessage({ type: 'openNote', node: serialize(node), preserveFocus: true });
      }
    });

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      select(node.absPath);
      menu.show(event.clientX, event.clientY, menuFor(node), node);
    });

    // Start a drag carrying the row's path
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      dragSource = node.absPath;
      event.dataTransfer.setData('text/plain', node.absPath);
      event.dataTransfer.effectAllowed = 'move';
    });

    // Take a drop on a folder and move the dragged entry into it
    if (isFolder) {
      row.addEventListener('dragover', (event) => {
        if (!canDrop(dragSource, node.absPath)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (event) => {
        row.classList.remove('drop-target');
        event.preventDefault();
        event.stopPropagation();
        const sourcePath = dragSource || event.dataTransfer.getData('text/plain');
        dragSource = null;
        if (!canDrop(sourcePath, node.absPath)) return;
        vscode.postMessage({ type: 'move', source: sourcePath, destDir: node.absPath });
      });
    }

    treeEl.appendChild(row);

    // Draw the children of an open folder
    if (isFolder && isOpen && node.children) {
      for (const child of node.children) {
        renderNode(child, depth + 1);
      }
    }
  }

  function stripMdExt(name) {
    return name.replace(/\.md$/i, '');
  }

  function ensureMdExt(name) {
    return /\.md$/i.test(name) ? name : name + '.md';
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

  // Mark every folder under these nodes as expanded, all the way down
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

  // Select the row for a path, clearing the selection when the path is null
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

  // Expand every ancestor folder of a path so its row renders, then select it
  function reveal(path) {
    if (!state) {
      return;
    }

    let parent = parentDir(path);
    while (parent && parent !== state.root) {
      expanded.add(parent);
      const next = parentDir(parent);
      if (next === parent) {
        break;
      }
      parent = next;
    }

    render();
    select(path);
  }

  // Refuse a drop onto the entry itself, into its own subfolder, or where it already sits
  function canDrop(sourcePath, destDir) {
    if (!sourcePath || !destDir) return false;
    if (sourcePath === destDir) return false;
    if (destDir.startsWith(sourcePath + '/') || destDir.startsWith(sourcePath + '\\')) return false;
    if (parentDir(sourcePath) === destDir) return false;
    return true;
  }

  // --- empty-area handlers ---

  treeEl.addEventListener('click', (event) => {
    if (event.target.closest('.row')) return;
    select(null);
  });

  treeEl.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.row')) return;
    if (!state) return;
    event.preventDefault();
    select(null);
    menu.show(event.clientX, event.clientY, emptyMenu(), null);
  });

  treeEl.addEventListener('dragover', (event) => {
    if (!state) return;
    if (event.target.closest('.row')) return;
    if (!canDrop(dragSource, state.root)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });

  treeEl.addEventListener('drop', (event) => {
    if (!state) return;
    if (event.target.closest('.row')) return;
    event.preventDefault();
    const sourcePath = dragSource || event.dataTransfer.getData('text/plain');
    dragSource = null;
    if (!canDrop(sourcePath, state.root)) return;
    vscode.postMessage({ type: 'move', source: sourcePath, destDir: state.root });
  });

  // --- context menu ---

  const { create, COPY_PATH_ITEM } = window.PromptStudioContextMenu;

  // Post a node command back to the host
  function postCommand(command, node) {
    vscode.postMessage({ type: 'command', command, node: node ? serialize(node) : undefined });
  }

  const menu = create(menuEl, postCommand, CARD_COLORS);

  // Expand the folder first, then create a note or folder inside it
  function newInFolder(command, node) {
    expanded.add(node.absPath);
    render();
    postCommand(command, node);
  }

  // Find a node anywhere in the tree by absolute path
  function findNode(absPath, nodes) {
    for (const node of nodes) {
      if (node.absPath === absPath) {
        return node;
      }
      if (node.children) {
        const found = findNode(absPath, node.children);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  // Read the color saved for a path in the current tree
  function nodeColorOf(absPath) {
    const node = state ? findNode(absPath, state.children) : undefined;
    return node ? node.color : undefined;
  }

  // Find the rendered row for a path, absent when its parent is collapsed
  function rowFor(absPath) {
    for (const row of treeEl.querySelectorAll('.row')) {
      if (row.dataset.path === absPath) {
        return row;
      }
    }
    return undefined;
  }

  // Tint the row for a path without saving the color
  function tintRow(absPath, color) {
    const row = rowFor(absPath);
    if (row) {
      applyRowColor(row, color);
    }
  }

  // Tint the row and send the color to the host
  function previewColor(absPath, color) {
    tintRow(absPath, color);
    vscode.postMessage({ type: 'previewColor', path: absPath, color: color || null });
  }

  // Remember the live preview, drop it once it matches the saved color
  function trackPreview(absPath, color) {
    activePreview = (nodeColorOf(absPath) || null) === (color || null) ? null : { path: absPath, color };
  }

  // Re-apply the preview if it still differs from the saved color
  function reapplyPreview() {
    if (!activePreview) {
      return;
    }
    trackPreview(activePreview.path, activePreview.color);
    if (activePreview) {
      tintRow(activePreview.path, activePreview.color);
    }
  }

  // Set the color on the node, tint its row, then save it
  function recolor(absPath, color) {
    const node = state ? findNode(absPath, state.children) : undefined;
    if (node) {
      node.color = color || undefined;
    }
    tintRow(absPath, color);
    vscode.postMessage({ type: 'setColor', path: absPath, color: color || null });
  }

  // Wire the menu's color swatches to a node, tinting its row on hover
  function colorTarget(node) {
    return {
      currentColor: () => nodeColorOf(node.absPath),
      preview: (color) => previewColor(node.absPath, color),
      commit: (color) => recolor(node.absPath, color)
    };
  }

  // Build the right-click menu for a node's kind
  function menuFor(node) {
    if (node.kind === 'note') {
      const alternate = alternateOpen(noteView, serialize(node));
      return [
        { kind: 'swatches', target: colorTarget(node) },
        'sep',
        { label: 'Open', icon: 'go-to-file', action: () => vscode.postMessage({ type: 'openNote', node: serialize(node) }) },
        { label: alternate.label, icon: alternate.icon, action: () => vscode.postMessage(alternate.message) },
        'sep',
        { label: 'Send to Claude', icon: 'claude', cmd: 'promptStudio.sendToClaude' },
        'sep',
        { label: 'Rename', icon: 'edit', action: () => beginRename(node) },
        { label: 'Duplicate File', icon: 'files', action: () => vscode.postMessage({ type: 'paste', source: node.absPath, contextNode: serialize(node) }) },
        { label: 'Copy Contents', icon: 'copy', cmd: 'promptStudio.copyContents' },
        'sep',
        { label: 'Reveal in File Manager', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
        COPY_PATH_ITEM,
        'sep',
        { label: 'Delete', icon: 'trash', cmd: 'promptStudio.delete' }
      ];
    }
    return [
      { kind: 'swatches', target: colorTarget(node) },
      'sep',
      { label: 'Open as Canvas', icon: 'layout', cmd: 'promptStudio.openVisual' },
      'sep',
      { label: 'New Note', icon: 'new-file', action: () => newInFolder('promptStudio.newNote', node) },
      { label: 'New Folder', icon: 'new-folder', action: () => newInFolder('promptStudio.newFolder', node) },
      'sep',
      { label: 'Rename', icon: 'edit', action: () => beginRename(node) },
      { label: 'Duplicate Folder', icon: 'files', action: () => vscode.postMessage({ type: 'paste', source: node.absPath, contextNode: serialize(node) }) },
      'sep',
      { label: 'Reveal in File Manager', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
      COPY_PATH_ITEM,
      'sep',
      { label: 'Delete', icon: 'trash', cmd: 'promptStudio.delete' }
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

  function serialize(node) {
    return { kind: node.kind, absPath: node.absPath, name: node.name };
  }

  vscode.postMessage({ type: 'ready' });
})();
