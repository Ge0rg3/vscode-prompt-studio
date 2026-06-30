(function () {
  const vscode = acquireVsCodeApi();

  const treeEl = document.getElementById('tree');
  const menuEl = document.getElementById('context-menu');

  const { create, COPY_PATH_ITEM } = window.PromptStudioContextMenu;

  let children = [];
  const expanded = new Set();

  // --- helpers ---

  // the node fields the host needs for a command
  function serialize(node) {
    return { kind: node.kind, name: node.name, absPath: node.absPath, skill: node.skill };
  }

  // post a node command back to the host, node is null for background actions
  function postCommand(command, node) {
    vscode.postMessage({ type: 'command', command, node: node ? serialize(node) : undefined });
  }

  function render() {
    treeEl.replaceChildren();
    for (const node of children) {
      renderNode(node, 0);
    }
  }

  // the expand-state key for a node
  function keyOf(node) {
    return node.absPath;
  }

  // the leading codicon class for a node's kind and open state
  function iconClass(node, isOpen) {
    if (node.kind === 'skill') {
      return 'codicon-sparkle';
    }
    if (node.kind === 'folder') {
      return isOpen ? 'codicon-folder-opened' : 'codicon-folder';
    }
    return 'codicon-file';
  }

  // a hover-row icon that runs a command on the node
  function actionButton(icon, title, command, node) {
    const action = document.createElement('span');
    action.className = `action codicon codicon-${icon}`;
    action.title = title;
    action.addEventListener('click', (event) => {
      event.stopPropagation();
      postCommand(command, node);
    });
    return action;
  }

  function renderNode(node, depth) {
    const expandable = node.kind !== 'file';
    const hasChildren = expandable && node.children && node.children.length > 0;
    const key = keyOf(node);
    const isOpen = hasChildren && expanded.has(key);

    const row = document.createElement('div');
    row.className = 'row';

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
    if (hasChildren) {
      const chevron = document.createElement('span');
      chevron.className = `codicon codicon-chevron-${isOpen ? 'down' : 'right'}`;
      twisty.appendChild(chevron);
      twisty.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleExpand(key);
      });
    } else {
      twisty.classList.add('empty');
    }
    row.appendChild(twisty);

    const icon = document.createElement('span');
    icon.className = 'icon';
    const glyph = document.createElement('span');
    glyph.className = `codicon ${iconClass(node, isOpen)}`;
    icon.appendChild(glyph);
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.name;
    row.appendChild(label);

    if (node.kind === 'skill') {
      if (node.skill && node.skill.description) {
        row.title = node.skill.description;
      }
      const actions = document.createElement('span');
      actions.className = 'actions';
      actions.appendChild(actionButton('go-to-file', 'Open SKILL.md', 'promptStudio.openSkill', node));
      actions.appendChild(actionButton('layout', 'Open as Canvas', 'promptStudio.openSkillVisual', node));
      actions.appendChild(actionButton('claude', 'Send to Claude', 'promptStudio.sendSkillToClaude', node));
      row.appendChild(actions);
    }

    row.addEventListener('click', () => {
      if (node.kind === 'file') {
        vscode.postMessage({ type: 'openNote', path: node.absPath });
      } else if (hasChildren) {
        toggleExpand(key);
      }
    });

    const items = menuFor(node);
    if (items) {
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        menu.show(event.clientX, event.clientY, items, node);
      });
    }

    treeEl.appendChild(row);

    if (isOpen) {
      for (const child of node.children) {
        renderNode(child, depth + 1);
      }
    }
  }

  function toggleExpand(key) {
    if (expanded.has(key)) {
      expanded.delete(key);
    } else {
      expanded.add(key);
    }
    render();
  }

  // collect the expand key of every node that has children, recursing into them
  function addExpandableKeys(nodes) {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        expanded.add(keyOf(node));
        addExpandableKeys(node.children);
      }
    }
  }

  // the skills-root actions shown when right-clicking empty space
  function backgroundMenu() {
    return [
      { label: 'Open as Canvas', icon: 'layout', cmd: 'promptStudio.openSkillsCanvas' },
      'sep',
      { label: 'New Skill', icon: 'add', cmd: 'promptStudio.newSkill' }
    ];
  }

  // the right-click menu for a node
  function menuFor(node) {
    if (node.kind === 'skill') {
      return [
        { label: 'Open SKILL.md', icon: 'go-to-file', cmd: 'promptStudio.openSkill' },
        { label: 'Open as Template', icon: 'files', cmd: 'promptStudio.openSkillTemplate' },
        { label: 'Open as Canvas', icon: 'layout', cmd: 'promptStudio.openSkillVisual' },
        'sep',
        { label: 'Send to Claude', icon: 'claude', cmd: 'promptStudio.sendSkillToClaude' },
        'sep',
        { label: 'Reveal in Explorer', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
        COPY_PATH_ITEM
      ];
    }
    if (node.kind === 'file') {
      return [
        { label: 'Open', icon: 'go-to-file', action: () => vscode.postMessage({ type: 'openNote', path: node.absPath }) },
        'sep',
        { label: 'Reveal in Explorer', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
        COPY_PATH_ITEM
      ];
    }
    if (node.kind === 'folder') {
      return [
        { label: 'Reveal in Explorer', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
        COPY_PATH_ITEM
      ];
    }
    return null;
  }

  // --- wiring ---

  const menu = create(menuEl, postCommand);

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) {
      return;
    }
    if (message.type === 'state') {
      children = message.children || [];
      render();
    } else if (message.type === 'expandAll') {
      addExpandableKeys(children);
      render();
    } else if (message.type === 'collapseAll') {
      expanded.clear();
      render();
    }
  });

  // right-click empty space acts on the skills root
  treeEl.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.row')) {
      return;
    }
    event.preventDefault();
    menu.show(event.clientX, event.clientY, backgroundMenu(), null);
  });

  vscode.postMessage({ type: 'ready' });
})();
