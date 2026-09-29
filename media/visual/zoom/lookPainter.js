// Draws the zoom's fades onto the two levels: the card opening, the canvas tint, and how much of the parent shows
(function () {
  // Round the previews' shade shift to steps this fine, so a fade restyles their copies less often.
  // One step changes a copy's shade by under 1%
  const LEVEL_SHIFT_STEPS = 20;

  const OPENING_CLASS = 'opening';
  const OPEN_PROGRESS_VAR = '--ps-open-progress';
  const LEVEL_SHIFT_VAR = '--ps-level-shift';

  const { applyTint } = window.PromptStudioPalette;
  const { previewOf } = window.PromptStudioCardBuilders;

  // --- helpers ---

  function titleOf(el) {
    return el.querySelector(':scope > .title');
  }

  function roundTo(value, steps) {
    return Math.round(value * steps) / steps;
  }

  // Draw a card opening into its own canvas, fading its title, its fill, and an empty folder's glyph by progress
  function setOpening(el, progress) {
    el.classList.add(OPENING_CLASS);
    el.style.setProperty(OPEN_PROGRESS_VAR, String(progress));
    titleOf(el).style.opacity = String(1 - progress);
    const previewEl = previewOf(el);
    if (previewEl.classList.contains('empty')) {
      previewEl.style.setProperty(OPEN_PROGRESS_VAR, String(progress));
    }
  }

  function clearOpening(el) {
    el.classList.remove(OPENING_CLASS);
    el.style.removeProperty(OPEN_PROGRESS_VAR);
    titleOf(el).style.opacity = '';
    previewOf(el).style.removeProperty(OPEN_PROGRESS_VAR);
  }

  // Shift a folder card's preview shades up this many levels, writing only a change since every copy inside restyles
  function setPreviewShift(el, shift) {
    const previewEl = previewOf(el);
    const shiftText = shift ? String(shift) : '';
    if (previewEl.style.getPropertyValue(LEVEL_SHIFT_VAR) === shiftText) {
      return;
    }

    if (shiftText) {
      previewEl.style.setProperty(LEVEL_SHIFT_VAR, shiftText);
    } else {
      previewEl.style.removeProperty(LEVEL_SHIFT_VAR);
    }
  }

  function isSameKey(key, paintedKey) {
    return paintedKey !== null && key.every((part, index) => part === paintedKey[index]);
  }

  // --- exports ---

  // Paint the fades onto the levels' elements, with colors from displayColorOf(path, savedColor)
  function create(canvasEl, fadeEl, emptyEl, emptyLabelEl, levels, displayColorOf) {
    // What the last paint left on the page, so a frame only writes what changed
    let paintedTargetEl = null;
    let paintedOwnEl = null;
    let paintedSiblingsKey = null;
    let paintedContextKey = null;
    let shownCanvasColor;
    let shownFadeColor;

    // The opacity last written on each card, since the page reads an opacity back rounded
    const paintedOpacities = new WeakMap();

    // Fade a card, leaving a fully shown one without an inline opacity, and write only a change.
    // With shouldHideAtZero a faded-out card is hidden outright too, since the browser still paints it at opacity 0
    function setCardOpacity(el, opacity, shouldHideAtZero) {
      const opacityText = opacity < 1 ? String(opacity) : '';
      if (paintedOpacities.get(el) === opacityText) {
        return;
      }

      el.style.opacity = opacityText;
      if (shouldHideAtZero) {
        el.style.visibility = opacity > 0 ? '' : 'hidden';
      }
      paintedOpacities.set(el, opacityText);
    }

    // Put the opening style on the opening live card and the open folder's card, clearing it off any other card
    function paintOpening(targetEl, targetProgress, ownEl, ownProgress) {
      for (const el of [paintedTargetEl, paintedOwnEl]) {
        if (el && el !== targetEl && el !== ownEl) {
          clearOpening(el);
        }
      }
      if (targetEl) {
        setOpening(targetEl, targetProgress);
      }
      if (ownEl) {
        setOpening(ownEl, ownProgress);
      }
      paintedTargetEl = targetEl;
      paintedOwnEl = ownEl;
    }

    // Fade the live cards around the opening one while the parent's breadcrumb flies the view out
    function paintSiblings(live, context, targetEl, siblingOpacity) {
      const key = [live.el, context && context.el, targetEl, siblingOpacity];
      if (isSameKey(key, paintedSiblingsKey)) {
        return;
      }

      paintedSiblingsKey = key;
      for (const el of live.cardEls.values()) {
        setCardOpacity(el, el === targetEl ? 1 : siblingOpacity, true);
      }
    }

    // Shift the opening card's preview up a level as it opens, and every folder card's preview down a level as the
    // canvas leaves for the parent
    function paintLevelShifts(live, targetEl, targetProgress, outerShift) {
      for (const card of live.data.cards) {
        if (card.kind === 'folder') {
          const el = live.cardEls.get(card.absPath);
          setPreviewShift(el, el === targetEl ? roundTo(targetProgress, LEVEL_SHIFT_STEPS) : outerShift);
        }
      }
    }

    // Show the parent around the live level: the open folder's card while the canvas leaves for it, the others as they
    // fade in. The copy hidden in the open folder's card never takes a level shift
    function paintContext(context, live, outerProgress, siblingOpacity) {
      setPreviewShift(context.ownEl, 0);

      // Only fade the open folder's card, since hiding it would restyle the copy of the live level inside it
      setCardOpacity(context.ownEl, outerProgress < 1 ? 1 : 0, false);
      const key = [context.el, live.el, siblingOpacity];
      if (isSameKey(key, paintedContextKey)) {
        return;
      }

      paintedContextKey = key;
      for (const el of context.cardEls.values()) {
        if (el !== context.ownEl) {
          setCardOpacity(el, siblingOpacity, true);
        }
      }
    }

    // Lay the tint of the folder the canvas is heading for over the canvas, the opening card's or the parent's
    function paintFade(look, live, context) {
      let color = null;
      let opacity = 0;
      if (look.inner) {
        const target = live.cardsByPath.get(look.inner.path);
        color = displayColorOf(look.inner.path, target && target.color) || null;
        opacity = look.inner.openProgress;
      } else if (look.outer && look.outer.openProgress < 1 && context) {
        color = displayColorOf(context.data.folder, context.data.folderColor) || null;
        opacity = 1 - look.outer.openProgress;
      }

      // Leave the tint alone while the fade is hidden, so a still canvas writes nothing
      if (opacity > 0 && color !== shownFadeColor) {
        applyTint(fadeEl, color, 'tinted');
        shownFadeColor = color;
      }
      fadeEl.style.opacity = String(opacity);
      fadeEl.style.willChange = opacity > 0 ? 'opacity' : '';
    }

    // Show the empty-folder message over an empty live level, fading with the canvas as it leaves for the parent, and
    // over an empty folder card while it opens or closes, fading with the card
    function paintEmpty(look, live, outerProgress) {
      const target = look.inner ? live.cardsByPath.get(look.inner.path) : undefined;
      const isOpeningEmpty = Boolean(target && target.children && target.children.length === 0);
      const isLiveEmpty = live.data.cards.length === 0;
      emptyEl.classList.toggle('hidden', !isLiveEmpty && !isOpeningEmpty);

      let opacity = '';
      if (isOpeningEmpty) {
        opacity = String(look.inner.openProgress);
      } else if (isLiveEmpty && outerProgress < 1) {
        opacity = String(outerProgress);
      }
      emptyLabelEl.style.opacity = opacity;
    }

    function paintCanvasTint(live) {
      const color = displayColorOf(live.data.folder, live.data.folderColor) || null;
      if (color !== shownCanvasColor) {
        applyTint(canvasEl, color, 'surface-tinted');
        shownCanvasColor = color;
      }
    }

    // Draw how far a live card has opened, and how much of the parent shows around the live level
    function paint(look) {
      const live = levels.liveLevel();
      if (!live) {
        return;
      }

      const context = levels.contextLevel();
      const targetEl = look.inner ? live.cardEls.get(look.inner.path) || null : null;
      const targetProgress = look.inner ? look.inner.openProgress : 0;
      const outerProgress = look.outer ? look.outer.openProgress : 1;

      paintCanvasTint(live);
      paintOpening(targetEl, targetProgress, context ? context.ownEl : null, outerProgress);
      paintSiblings(live, context, targetEl, look.inner ? look.inner.siblingOpacity : 1);

      // Shift the live previews a level down as the canvas leaves them, and show the parent around them
      const outerShift = outerProgress < 1 ? roundTo(outerProgress - 1, LEVEL_SHIFT_STEPS) : 0;
      paintLevelShifts(live, targetEl, targetProgress, outerShift);
      if (context) {
        paintContext(context, live, outerProgress, look.outer ? look.outer.siblingOpacity : 0);
      } else {
        paintedContextKey = null;
      }

      paintFade(look, live, context);
      paintEmpty(look, live, outerProgress);
    }

    return { paint };
  }

  window.PromptStudioLookPainter = { create };
})();
