// shared right-click menu for the sidebar webviews, rendered into a #context-menu element
(function () {
  const SUBMENU_OPEN_DELAY_MS = 150;

  // Copy as Path opens a submenu for the absolute or the root-relative path
  const COPY_PATH_ITEM = {
    label: 'Copy as Path',
    icon: 'file-symlink-file',
    submenu: [
      { label: 'Static', icon: 'link', cmd: 'promptStudio.copyPathStatic' },
      { label: 'Relative', icon: 'file-submodule', cmd: 'promptStudio.copyPathRelative' }
    ]
  };

  // a controller bound to one menu container, dispatching picks through onCommand(cmd, node)
  function create(menuEl, onCommand) {
    function hide() {
      menuEl.classList.add('hidden');
    }

    // a clickable row that runs its action or dispatches its command
    function buildMenuItem(entry, node) {
      const item = document.createElement('div');
      item.className = 'menu-item';
      const icon = document.createElement('span');
      icon.className = `codicon codicon-${entry.icon}`;
      const label = document.createElement('span');
      label.textContent = entry.label;
      item.appendChild(icon);
      item.appendChild(label);

      item.addEventListener('click', () => {
        hide();
        if (entry.action) {
          entry.action();
          return;
        }
        onCommand(entry.cmd, node);
      });
      return item;
    }

    // place the submenu beside its parent when it fits there, else expand it inline below
    function openSubmenu(header, submenu, arrow) {
      // a pending timer can fire after the menu was rebuilt or hidden, ignore the orphaned nodes
      if (!header.isConnected) {
        return;
      }
      submenu.classList.remove('hidden', 'inline');
      const rect = header.getBoundingClientRect();
      const width = submenu.offsetWidth;
      const fitsRight = rect.right + width <= window.innerWidth - 4;
      const fitsLeft = rect.left - width >= 4;

      if (fitsRight || fitsLeft) {
        arrow.className = 'submenu-arrow codicon codicon-chevron-right';
        const left = fitsRight ? rect.right : rect.left - width;
        const top = Math.min(rect.top, Math.max(0, window.innerHeight - submenu.offsetHeight - 4));
        submenu.style.left = `${left}px`;
        submenu.style.top = `${top}px`;
      } else {
        arrow.className = 'submenu-arrow codicon codicon-chevron-down';
        submenu.classList.add('inline');
        // pull the menu up so the expanded rows stay on-screen
        if (menuEl.getBoundingClientRect().bottom > window.innerHeight - 4) {
          menuEl.style.top = `${Math.max(4, window.innerHeight - menuEl.offsetHeight - 4)}px`;
        }
      }
    }

    // reset the submenu to its closed state
    function closeSubmenu(submenu, arrow) {
      submenu.classList.add('hidden');
      submenu.classList.remove('inline');
      arrow.className = 'submenu-arrow codicon codicon-chevron-right';
    }

    // a parent whose children fly out beside it, or expand inline when there is no room
    function buildSubmenuItem(entry, node) {
      const parent = document.createElement('div');
      parent.className = 'submenu-parent';

      const header = document.createElement('div');
      header.className = 'menu-item';
      const icon = document.createElement('span');
      icon.className = `codicon codicon-${entry.icon}`;
      const label = document.createElement('span');
      label.textContent = entry.label;
      const arrow = document.createElement('span');
      arrow.className = 'submenu-arrow codicon codicon-chevron-right';
      header.appendChild(icon);
      header.appendChild(label);
      header.appendChild(arrow);

      const submenu = document.createElement('div');
      submenu.className = 'submenu hidden';
      for (const child of entry.submenu) {
        submenu.appendChild(buildMenuItem(child, node));
      }

      parent.appendChild(header);
      parent.appendChild(submenu);

      let openTimer;
      parent.addEventListener('mouseenter', () => {
        openTimer = setTimeout(() => openSubmenu(header, submenu, arrow), SUBMENU_OPEN_DELAY_MS);
      });
      parent.addEventListener('mouseleave', () => {
        clearTimeout(openTimer);
        closeSubmenu(submenu, arrow);
      });
      return parent;
    }

    // place the menu at the click point, clamped inside the window
    function show(x, y, items, node) {
      menuEl.replaceChildren();
      for (const entry of items) {
        if (entry === 'sep') {
          const sep = document.createElement('div');
          sep.className = 'menu-sep';
          menuEl.appendChild(sep);
          continue;
        }

        menuEl.appendChild(entry.submenu ? buildSubmenuItem(entry, node) : buildMenuItem(entry, node));
      }
      menuEl.classList.remove('hidden');

      const maxX = Math.max(0, window.innerWidth - menuEl.offsetWidth - 4);
      const maxY = Math.max(0, window.innerHeight - menuEl.offsetHeight - 4);
      menuEl.style.left = `${Math.min(x, maxX)}px`;
      menuEl.style.top = `${Math.min(y, maxY)}px`;
    }

    document.addEventListener('mousedown', (event) => {
      if (!menuEl.contains(event.target)) hide();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hide();
    });
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, true);

    return { show, hide };
  }

  window.PromptStudioContextMenu = { create, COPY_PATH_ITEM };
})();
