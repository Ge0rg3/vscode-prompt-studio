// Builds and shows the right-click menus for the cards and for empty canvas space
(function () {
  const { create: createContextMenu, COPY_PATH_ITEM } = window.PromptStudioContextMenu;
  const { alternateOpen, INITIAL_NOTE_VIEW } = window.PromptStudioNoteOpen;
  const { DEFAULT_CARD_WIDTH, DEFAULT_CARD_HEIGHT } = window.PromptStudioCardBuilders;

  // --- helpers ---

  // Cut a node down to the fields sent with a command
  function serialize(node) {
    return { kind: node.kind, absPath: node.absPath, name: node.name };
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

  // --- exports ---

  // Show the canvas's menus in menuEl, leaving out Rename, Delete, and the create items unless allowCrud.
  // postAfterSave sends a message once pending edits are written, postMessage sends one at once
  function create(menuEl, cardColors, allowCrud, camera, levels, colors, postAfterSave, postMessage) {
    // The view a note opens in by default, as the host last reported it, so the menu offers the other one
    let noteView = INITIAL_NOTE_VIEW;

    const menu = createContextMenu(
      menuEl,
      (command, node) => postAfterSave({ type: 'command', command, node: serialize(node) }),
      cardColors
    );

    // Build a node for the open folder out of the last breadcrumb
    function currentFolderNode() {
      const crumb = levels.liveLevel().crumbs.at(-1);
      return { kind: 'folder', absPath: crumb.path, name: crumb.name };
    }

    function noteMenu(card) {
      const alternate = alternateOpen(noteView, serialize(card));
      return compactMenu([
        { kind: 'swatches', target: colors.cardColorTarget(card) },
        'sep',
        { label: 'Open', icon: 'go-to-file', action: () => postAfterSave({ type: 'openNote', node: serialize(card) }) },
        { label: alternate.label, icon: alternate.icon, action: () => postAfterSave(alternate.message) },
        // Only a skills canvas is read-only, and skills keep no history
        allowCrud ? { label: 'Show History', icon: 'history', cmd: 'promptStudio.showHistory' } : null,
        'sep',
        { label: 'Send to Claude', icon: 'claude', cmd: 'promptStudio.sendToClaude' },
        'sep',
        allowCrud ? { label: 'Rename', icon: 'edit', cmd: 'promptStudio.rename' } : null,
        { label: 'Copy Contents', icon: 'copy', cmd: 'promptStudio.copyContents' },
        'sep',
        { label: 'Reveal in File Manager', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
        COPY_PATH_ITEM,
        'sep',
        allowCrud ? { label: 'Delete', icon: 'trash', cmd: 'promptStudio.delete' } : null
      ]);
    }

    function folderMenu(card) {
      return compactMenu([
        { kind: 'swatches', target: colors.cardColorTarget(card) },
        'sep',
        allowCrud ? { label: 'Rename', icon: 'edit', cmd: 'promptStudio.rename' } : null,
        'sep',
        { label: 'Reveal in File Manager', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
        COPY_PATH_ITEM,
        'sep',
        allowCrud ? { label: 'Delete', icon: 'trash', cmd: 'promptStudio.delete' } : null
      ]);
    }

    // Work out the surface point that centers a new card on the click
    function dropPoint(event) {
      const point = camera.toSurface(event.clientX, event.clientY);
      return {
        x: Math.round(point.x - DEFAULT_CARD_WIDTH / 2),
        y: Math.round(point.y - DEFAULT_CARD_HEIGHT / 2)
      };
    }

    // Build the menu for empty canvas space, acting on the open folder
    function backgroundMenu(dropPos) {
      return compactMenu([
        { kind: 'swatches', target: colors.folderColorTarget() },
        'sep',
        allowCrud ? { label: 'New Note', icon: 'new-file', action: () => postMessage({ type: 'newEntry', kind: 'note', x: dropPos.x, y: dropPos.y }) } : null,
        allowCrud ? { label: 'New Folder', icon: 'new-folder', action: () => postMessage({ type: 'newEntry', kind: 'folder', x: dropPos.x, y: dropPos.y }) } : null,
        'sep',
        { label: 'Reveal in File Manager', icon: 'folder-opened', cmd: 'promptStudio.revealInOS' },
        COPY_PATH_ITEM
      ]);
    }

    function showCardMenu(event, card) {
      const items = card.kind === 'note' ? noteMenu(card) : folderMenu(card);
      menu.show(event.clientX, event.clientY, items, card);
    }

    function showBackgroundMenu(event) {
      menu.show(event.clientX, event.clientY, backgroundMenu(dropPoint(event)), currentFolderNode());
    }

    function hideMenu() {
      if (!menuEl.classList.contains('hidden')) {
        menu.hide();
      }
    }

    function setNoteView(view) {
      noteView = view;
    }

    return { showCardMenu, showBackgroundMenu, hideMenu, setNoteView };
  }

  window.PromptStudioMenus = { create, serialize };
})();
