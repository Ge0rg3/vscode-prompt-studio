// Shows the swatch being hovered over a card or the canvas, and saves the colors picked for cards and folders
(function () {
  const { applyTint } = window.PromptStudioPalette;

  // --- exports ---

  // Color the levels' cards, posting previews and saves through postMessage and running repaint() after each tint
  function create(levels, postMessage, repaint) {
    // The swatch hovered over a path, here or in another view, while it differs from the saved color
    let activePreview = null;

    // Find a drawn card by path, among the live cards first and then the parent's cards around them
    function drawnCardOf(absPath) {
      for (const level of [levels.liveLevel(), levels.contextLevel()]) {
        const card = level && level.cardsByPath.get(absPath);
        if (card) {
          return card;
        }
      }
      return null;
    }

    function cardColorOf(absPath) {
      const card = drawnCardOf(absPath);
      return card ? card.color : undefined;
    }

    // Look up the saved color for a path, a folder's own color when it is the open folder or its parent
    function savedColorOf(absPath) {
      for (const level of [levels.liveLevel(), levels.contextLevel()]) {
        if (level && absPath === level.data.folder) {
          return level.data.folderColor;
        }
      }
      return cardColorOf(absPath);
    }

    // Remember the live preview, drop it once it matches the saved color
    function trackPreview(absPath, color) {
      activePreview = (savedColorOf(absPath) || null) === (color || null) ? null : { path: absPath, color };
    }

    // Tint every drawn card for a path without saving the color, then repaint the canvas and fade tints
    function tintDrawn(absPath, color) {
      for (const el of levels.elementsOf(absPath)) {
        applyTint(el, color, 'colored');
      }
      repaint();
    }

    // Tint this canvas, then have the host mirror it in the sidebar and other canvases
    function previewColor(absPath, color) {
      trackPreview(absPath, color);
      tintDrawn(absPath, color);
      postMessage({ type: 'previewColor', path: absPath, color: color || null });
    }

    // Set the color on the card, then save it
    function recolor(absPath, color) {
      const card = drawnCardOf(absPath);
      if (card) {
        card.color = color || undefined;
      }
      tintDrawn(absPath, color);
      postMessage({ type: 'setColor', path: absPath, color: color || null });
    }

    // Set the color on the canvas background and on the open folder's card in the parent, then save it
    function recolorFolder(absPath, color) {
      levels.liveLevel().data.folderColor = color || undefined;
      const context = levels.contextLevel();
      if (context) {
        context.ownCard.color = color || undefined;
      }
      tintDrawn(absPath, color);
      postMessage({ type: 'setColor', path: absPath, color: color || null });
    }

    // Take the color a path is drawn in, the swatch being hovered over it while there is one
    function displayColorOf(absPath, savedColor) {
      if (activePreview && activePreview.path === absPath) {
        return activePreview.color || undefined;
      }
      return savedColor;
    }

    // Show a swatch another view is hovering over a path
    function receivePreview(absPath, color) {
      trackPreview(absPath, color);
      tintDrawn(absPath, color);
    }

    // Re-apply the preview after a redraw, if it still differs from the saved color
    function reapplyPreview() {
      if (!activePreview) {
        return;
      }
      trackPreview(activePreview.path, activePreview.color);
      if (activePreview) {
        tintDrawn(activePreview.path, activePreview.color);
      }
    }

    // Build the swatch target that recolors a card
    function cardColorTarget(card) {
      return {
        currentColor: () => cardColorOf(card.absPath),
        preview: (color) => previewColor(card.absPath, color),
        commit: (color) => recolor(card.absPath, color)
      };
    }

    // Build the swatch target that recolors the open folder and its canvas background
    function folderColorTarget() {
      const folder = levels.liveLevel().data.folder;
      return {
        currentColor: () => levels.liveLevel().data.folderColor,
        preview: (color) => previewColor(folder, color),
        commit: (color) => recolorFolder(folder, color)
      };
    }

    return { displayColorOf, receivePreview, reapplyPreview, cardColorTarget, folderColorTarget };
  }

  window.PromptStudioColors = { create };
})();
