// Moves the canvas in and out of a folder as the zoom crosses into its card
(function () {
  // A folder card zoomed to this much of the view falls open as its own canvas
  const DESCEND_COVERAGE = 0.8;

  // Zoom out by this factor from where a folder opened and the parent comes back
  const ASCEND_ZOOM_OUT_FACTOR = 1.3;

  // A folder card covering this much of the view starts fading the canvas over to its own color
  const FADE_COVERAGE = 0.6;

  // Wait for the wheel to go quiet this long, or one flick opens two folders
  const GESTURE_IDLE_MS = 150;

  const { clampZoom, rectOf } = window.PromptStudioViewport;

  // Drive one canvas between folders, reading what is on screen and asking the host for the next one
  function create(viewport, canvasEl, readCanvas, navigate) {
    let pendingDescent = null;
    let pendingAscent = null;
    let previousZoom = 1;
    let openedZoom = Infinity;
    let isTransitionLocked = false;
    let gestureIdleTimer;

    // A folder change that is ready and waiting for the wheel to go quiet
    let heldCrossing = null;

    // Read where a folder card draws its children on the surface, and how far down it scales them
    function measurePreviewFrame(absPath) {
      const el = readCanvas().cardEls.get(absPath);
      const miniSurface = el && el.querySelector('.folder-preview > .mini-surface');
      if (!miniSurface) {
        return null;
      }

      const rect = miniSurface.getBoundingClientRect();
      if (!rect.width) {
        return null;
      }

      // Measure on screen and take the view back out, so the numbers outlive the view they came from
      const currentView = viewport.getView();
      const canvasRect = canvasEl.getBoundingClientRect();
      const scale = rect.width / miniSurface.offsetWidth / currentView.zoom;

      // The preview starts at the corner of the box its cards fill, so line up on the canvas origin instead
      const originX = Number(miniSurface.dataset.originX);
      const originY = Number(miniSurface.dataset.originY);
      return {
        x: (rect.left - canvasRect.left - currentView.panX) / currentView.zoom - originX * scale,
        y: (rect.top - canvasRect.top - currentView.panY) / currentView.zoom - originY * scale,
        scale
      };
    }

    // Draw the parent so the folder just left sits where its cards were
    function placeAscendedView(ascent) {
      const cards = readCanvas().cards;

      // The surface still carries the view of the folder being left, so measure the parent against it
      const frame = measurePreviewFrame(ascent.from);
      if (!frame) {
        const card = cards.find((entry) => entry.absPath === ascent.from);
        viewport.fit(card ? [rectOf(card)] : cards.map(rectOf));
        return;
      }

      const currentView = viewport.getView();
      const zoom = clampZoom(currentView.zoom / frame.scale);
      viewport.setView(zoom, currentView.panX - frame.x * zoom, currentView.panY - frame.y * zoom);
    }

    // Take the topmost folder card the zoom is closing in on
    function folderCardAt(point) {
      let topmostCard = null;
      for (const card of readCanvas().cards) {
        const isUnderPoint = point.x >= card.x && point.x <= card.x + card.width &&
          point.y >= card.y && point.y <= card.y + card.height;
        if (card.kind === 'folder' && isUnderPoint && (!topmostCard || (card.z || 0) >= (topmostCard.z || 0))) {
          topmostCard = card;
        }
      }
      return topmostCard;
    }

    // Work out which folder the view is heading for and how far it has come
    function fadeToward(anchor) {
      const state = readCanvas().state;
      const view = viewport.getView();

      // Zooming back out of this folder fades the canvas over to the parent's color
      const leaveProgress = Math.log(openedZoom / view.zoom) / Math.log(ASCEND_ZOOM_OUT_FACTOR);
      if (leaveProgress > 0) {
        if (state.breadcrumbs.length < 2) {
          return null;
        }
        return { absPath: null, color: state.parentColor, progress: Math.min(leaveProgress, 1) };
      }

      const card = folderCardAt(anchor);
      if (!card) {
        return null;
      }

      // Take whichever side of the card fills more of the view, so a wide window still reaches the threshold
      const size = viewport.viewportSize();
      const coverage = Math.max(card.width * view.zoom / size.width, card.height * view.zoom / size.height);
      const enterProgress = (coverage - FADE_COVERAGE) / (DESCEND_COVERAGE - FADE_COVERAGE);
      if (enterProgress <= 0) {
        return null;
      }
      return { absPath: card.absPath, color: card.color, progress: Math.min(enterProgress, 1) };
    }

    // Fall into the folder card the fade has finished on
    function descendIntoFolder(absPath) {
      // A held crossing can outlive the canvas it was measured on, and that card is no longer there to enter
      if (!readCanvas().cardEls.has(absPath)) {
        return;
      }

      // Hand the child canvas the place and scale its cards are already drawn at
      const frame = measurePreviewFrame(absPath);
      pendingDescent = null;
      if (frame) {
        pendingDescent = { folder: absPath, frame };
      }

      isTransitionLocked = true;
      viewport.suspendZoom(true);
      navigate(absPath);
    }

    // Pop back out to the parent the fade has finished on
    function ascendToParent() {
      const crumbs = readCanvas().state.breadcrumbs;
      if (crumbs.length < 2) {
        return;
      }

      isTransitionLocked = true;
      viewport.suspendZoom(true);
      pendingAscent = { folder: crumbs[crumbs.length - 2].path, from: crumbs[crumbs.length - 1].path };
      navigate(pendingAscent.folder);
    }

    // Move the canvas the way a finished fade asks for
    function cross(fade) {
      if (fade.absPath) {
        descendIntoFolder(fade.absPath);
      } else {
        ascendToParent();
      }
    }

    // Hold the next folder change, and the zoom itself, until the wheel has been still for a moment
    function holdTransitions() {
      clearTimeout(gestureIdleTimer);
      gestureIdleTimer = setTimeout(() => {
        isTransitionLocked = false;
        viewport.suspendZoom(false);

        // A fade that filled up while the last change was still landing gets its move now
        if (heldCrossing) {
          const held = heldCrossing;
          heldCrossing = null;
          cross(held);
        }
      }, GESTURE_IDLE_MS);
    }

    // Follow a pan or zoom and hand back the fade it calls for
    function onViewChanged(zoom, isGesture, anchor) {
      const state = readCanvas().state;
      if (!isGesture || !state) {
        // Measure leaving from the zoom a folder change, Fit, or the 100% button last set
        openedZoom = zoom;
        previousZoom = zoom;
        return null;
      }

      const fade = fadeToward(anchor);
      holdTransitions();

      // Cross only when the fade is full and the zoom is still moving the way that filled it
      const isCrossing = Boolean(fade) && fade.progress >= 1 &&
        (fade.absPath ? zoom > previousZoom : zoom < previousZoom);
      heldCrossing = null;
      if (isCrossing) {
        if (isTransitionLocked) {
          heldCrossing = fade;
        } else {
          cross(fade);
        }
      }

      previousZoom = zoom;
      return fade;
    }

    // Place the viewport for a folder change, leaving a plain redraw where it is
    function placeView(folder, isSameFolder, restoredView) {
      const restored = restoredView && restoredView.folder === folder ? restoredView : null;
      const descent = pendingDescent && pendingDescent.folder === folder ? pendingDescent : null;
      const ascent = pendingAscent && pendingAscent.folder === folder ? pendingAscent : null;
      pendingDescent = null;
      pendingAscent = null;

      if (!restored && !descent && !ascent && isSameFolder) {
        return;
      }

      if (restored) {
        viewport.setView(restored.zoom, restored.panX, restored.panY);
      } else if (descent) {
        // Read the parent's view now rather than at the crossing, since a zoom still easing has moved on
        const currentView = viewport.getView();
        viewport.setView(
          descent.frame.scale * currentView.zoom,
          currentView.panX + descent.frame.x * currentView.zoom,
          currentView.panY + descent.frame.y * currentView.zoom
        );
      } else if (ascent) {
        placeAscendedView(ascent);
      } else {
        // A click or a breadcrumb frames the folder, so zooming out only ever means leaving it
        viewport.fit(readCanvas().cards.map(rectOf));
      }
    }

    return { onViewChanged, placeView };
  }

  window.PromptStudioFolderZoom = { create };
})();
