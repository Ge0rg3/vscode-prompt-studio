// Renders the shared right-click menu into a webview's #context-menu element
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

  // Build a controller bound to one menu element, sending each pick through onCommand
  function create(menuEl, onCommand, colors = []) {
    let colorTarget = null;

    function hide() {
      // Drop any uncommitted hover preview back to the saved color
      if (colorTarget) {
        colorTarget.preview(colorTarget.currentColor());
        colorTarget = null;
      }
      menuEl.classList.add('hidden');
    }

    // Build a clickable row that runs its action or posts its command
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

    // Place the submenu beside its parent when it fits, else expand it inline below
    function openSubmenu(header, submenu, arrow) {
      // Ignore a timer that fires after the menu was rebuilt or hidden
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

        // Pull the menu up so the expanded rows stay on screen
        if (menuEl.getBoundingClientRect().bottom > window.innerHeight - 4) {
          menuEl.style.top = `${Math.max(4, window.innerHeight - menuEl.offsetHeight - 4)}px`;
        }
      }
    }

    // Reset the submenu to its closed state
    function closeSubmenu(submenu, arrow) {
      submenu.classList.add('hidden');
      submenu.classList.remove('inline');
      arrow.className = 'submenu-arrow codicon codicon-chevron-right';
    }

    // Build a parent row whose children fly out beside it, or inline when there is no room
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

    // Build the row of color dots, led by a swatch that clears the color
    function buildSwatchRow(target) {
      const row = document.createElement('div');
      row.className = 'swatch-row';

      for (const color of [null, ...colors]) {
        const dot = document.createElement('span');
        dot.className = color ? 'swatch color-' + color : 'swatch none';
        dot.title = color || 'No color';
        if ((target.currentColor() || null) === color) {
          dot.classList.add('selected');
        }

        dot.addEventListener('mouseenter', () => target.preview(color));
        dot.addEventListener('mouseleave', () => target.preview(target.currentColor()));
        dot.addEventListener('click', () => {
          if (dot.classList.contains('selected')) {
            hide();
            return;
          }

          for (const other of row.children) {
            other.classList.remove('selected');
          }
          dot.classList.add('selected');
          target.commit(color);
        });
        row.appendChild(dot);
      }
      return row;
    }

    // Rebuild the menu from its entries and open it at the click point
    function show(x, y, items, node) {
      colorTarget = null;
      menuEl.replaceChildren();
      for (const entry of items) {
        if (entry === 'sep') {
          const sep = document.createElement('div');
          sep.className = 'menu-sep';
          menuEl.appendChild(sep);
          continue;
        }
        if (entry.kind === 'swatches') {
          colorTarget = entry.target;
          menuEl.appendChild(buildSwatchRow(entry.target));
          continue;
        }

        menuEl.appendChild(entry.submenu ? buildSubmenuItem(entry, node) : buildMenuItem(entry, node));
      }
      menuEl.classList.remove('hidden');

      // Keep the menu inside the window
      const maxX = Math.max(0, window.innerWidth - menuEl.offsetWidth - 4);
      const maxY = Math.max(0, window.innerHeight - menuEl.offsetHeight - 4);
      menuEl.style.left = `${Math.min(x, maxX)}px`;
      menuEl.style.top = `${Math.min(y, maxY)}px`;
    }

    // Close the menu on a click outside, Escape, a scroll, or the window losing focus
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
