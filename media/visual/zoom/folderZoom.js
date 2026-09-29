// Moves the canvas into a folder card as the view closes in on it, and out to the parent as the view pulls away
(function () {
  // Run one fade across this ratio of zoom, counted from the zoom it starts at
  const FADE_ZOOM_RATIO = 1.8;
  const LOG_FADE_ZOOM_RATIO = Math.log(FADE_ZOOM_RATIO);

  // Snap a fade's progress to a whole number within this distance, to absorb floating-point error
  const ROUNDING_NOISE = 1e-9;

  // Ease the fades back to rest over this long while a click or a button flies the view
  const LOOK_ANIMATION_MS = 260;

  // Spread a whole fade over at least this long, so even a hard flick shows it over about ten frames
  const LOOK_FADE_MIN_MS = 160;

  // Count at most this long per frame when moving the fades on, so a late frame delays a fade instead of skipping part
  // of it
  const MAX_LOOK_STEP_MS = 33;

  // Inside a folder the zoom can go far below the canvas root's floor, since the way out to the parent lies down there
  const FOLDER_MIN_ZOOM = 1e-4;

  const { clamp01, topmostCardAt, viewRectOf, rectCoverage, visibleCoverage, openProgressFor } = window.PromptStudioCoverage;
  const { MIN_ZOOM } = window.PromptStudioViewport;

  // --- helpers ---

  // Count how many FADE_ZOOM_RATIOs the zoom sits above the zoom a fade starts from, negative below it, snapping off
  // rounding error
  function gateProgress(zoom, gateZoom) {
    const progress = Math.log(zoom / gateZoom) / LOG_FADE_ZOOM_RATIO;
    const wholeProgress = Math.round(progress);
    return Math.abs(progress - wholeProgress) < ROUNDING_NOISE ? wholeProgress : progress;
  }

  // Ease a scripted move's fades in and out, from 0 at the start to 1 at the end
  function easeInOut(progress) {
    return progress * progress * (3 - 2 * progress);
  }

  function mix(from, to, share) {
    return from + (to - from) * share;
  }

  // Move a value toward its target by at most maxStep, landing on the target exactly
  function stepToward(value, target, maxStep) {
    if (Math.abs(target - value) <= maxStep) {
      return target;
    }
    return value + Math.sign(target - value) * maxStep;
  }

  // Step the progress like any value, but stop at 0 when it crosses between opening a card and leaving for the parent,
  // so the canvas tint only changes color while hidden
  function stepProgressToward(progress, target, maxStep) {
    const next = stepToward(progress, target, maxStep);
    return progress * next < 0 ? 0 : next;
  }

  // Take the gates of a view resting at a zoom, with the parent's other cards fully shown or hidden
  function restingGatesAt(zoom, isSiblingShown) {
    return {
      enterZoom: zoom,
      leaveZoom: zoom,
      siblingZoom: isSiblingShown ? zoom : zoom / FADE_ZOOM_RATIO,
      latchedPath: null
    };
  }

  // Move the fades a share of the way from a scripted move's start to rest, with no card opening and the parent hidden
  function lookTowardRest(fromLook, share) {
    const { inner, outer } = fromLook;
    const partway = { inner: null, outer: null };
    if (inner && share < 1) {
      partway.inner = {
        path: inner.path,
        openProgress: mix(inner.openProgress, 0, share),
        siblingOpacity: mix(inner.siblingOpacity, 1, share)
      };
    }
    if (outer) {
      partway.outer = { openProgress: mix(outer.openProgress, 1, share), siblingOpacity: mix(outer.siblingOpacity, 0, share) };
    }
    return partway;
  }

  // --- exports ---

  // Open and leave folders as the camera zooms, updating the fades every frame.
  // onLevelLeave() runs before a folder change, and onLevelEnter(fromFolder) after it
  function create(camera, levels, ancestors, onLevelLeave, onLevelEnter) {
    // The zoom each fade starts from, called its gate, for a folder card opening, the canvas leaving for the parent,
    // and the parent's other cards appearing. A folder change stays invisible only while enterZoom is at or above
    // leaveZoom, and siblingZoom sits within one FADE_ZOOM_RATIO below leaveZoom
    let enterZoom = 1;
    let leaveZoom = 1;
    let siblingZoom = 1 / FADE_ZOOM_RATIO;

    // The folder card under the zoom point last frame, and the opening one, kept while it shows open or is due to
    let candidatePath = null;
    let latchedPath = null;

    // The folder card the zoom is heading into this frame, the one a level change opens
    let candidate = null;

    // The fades the view asks for, one progress from -1 to 1 and the opacity of the parent's other cards. Above 0 the
    // candidate card is that far open, and below 0 the canvas is that far on its way to the parent
    let targetProgress = 0;
    let targetSiblingOpacity = 0;

    // The fades drawn now, following the ones asked for at a bounded rate. Level changes wait for these
    let shownProgress = 0;
    let shownSiblingOpacity = 0;

    // When the shown fades last stepped, or null while they sit on their targets
    let lookSteppedAt = null;

    // The fades as drawn, called the look: which live card is opening and how far, and how much of the parent shows
    let look = { inner: null, outer: null };

    // The live level a card is held in while dragged or resized. Every level change waits until the card lets go, or
    // until a redraw of the live level takes the card away
    let heldLevelEl = null;

    // Gates saved over a reload, put back in place of the usual reset when setView restores the view
    let savedGates = null;

    // The click or button move in progress, or null. It holds the look it eases to rest from, its elapsed ms and when
    // they were last counted, and whether the camera is still flying
    let scriptedMove = null;

    // Take the folder card the zoom is opening, the latched one or else the card on top under the anchor, never a note
    function pickCandidate(live, zoom) {
      const latched = latchedPath && live.cardsByPath.get(latchedPath);
      let picked = latched || topmostCardAt(live.data.cards, camera.getAnchor());
      if (picked && picked.kind !== 'folder') {
        picked = null;
      }

      // Start a new target's fade from the zoom it was picked up at
      if (picked && picked.absPath !== candidatePath && zoom > enterZoom) {
        enterZoom = zoom;
      }
      candidatePath = picked ? picked.absPath : null;
      return picked;
    }

    // Work out how far the canvas has pulled away toward the parent, or null at the root and until the parent is drawn
    function evaluateOuter(live, zoom, viewRect) {
      if (live.crumbs.length < 2) {
        return null;
      }

      // Hold the fades at the zoom until the parent is drawn, so it fades in from there instead of popping in. Stop one
      // FADE_ZOOM_RATIO above the zoom floor, leaving room below for the fade to finish
      if (!levels.contextLevel()) {
        const heldZoom = Math.max(zoom, FOLDER_MIN_ZOOM * FADE_ZOOM_RATIO);
        leaveZoom = Math.min(leaveZoom, heldZoom);
        siblingZoom = Math.min(siblingZoom, heldZoom / FADE_ZOOM_RATIO);
        return null;
      }

      const leaveProgress = gateProgress(zoom, leaveZoom);
      const siblingProgress = gateProgress(zoom, siblingZoom);
      return {
        openProgress: Math.max(openProgressFor(rectCoverage(levels.ownRect(), viewRect)), clamp01(1 + leaveProgress)),
        siblingOpacity: 1 - clamp01(siblingProgress)
      };
    }

    // Work out the fades the view asks for from the view, the anchor, and the gates
    function evaluateTarget() {
      const live = levels.liveLevel();
      const view = camera.getView();
      const viewRect = viewRectOf(view, camera.viewportSize());

      // Drop the fade of an opening card a redraw took away, so the next card starts its own from 0
      if (latchedPath && !live.cardsByPath.has(latchedPath)) {
        latchedPath = null;
        shownProgress = Math.min(shownProgress, 0);
      }

      candidate = pickCandidate(live, view.zoom);
      const enterProgress = clamp01(gateProgress(view.zoom, enterZoom));
      const coverage = candidate ? visibleCoverage(live.data.cards, candidate, viewRect) : 0;
      const innerProgress = candidate ? Math.min(openProgressFor(coverage), enterProgress) : 0;
      const outer = evaluateOuter(live, view.zoom, viewRect);
      targetProgress = 0;
      if (innerProgress > 0) {
        targetProgress = innerProgress;
      } else if (outer) {
        targetProgress = outer.openProgress - 1;
      }
      targetSiblingOpacity = outer ? outer.siblingOpacity : 0;
    }

    // Hold on to the opening card while it is drawn open or asked to open, so the fade never switches cards midway
    function latchCandidate() {
      latchedPath = candidate && (shownProgress > 0 || targetProgress > 0) ? candidate.absPath : null;
    }

    function isLookSettled() {
      return shownProgress === targetProgress && shownSiblingOpacity === targetSiblingOpacity;
    }

    // Move the shown fades toward the ones asked for, a whole fade taking at least LOOK_FADE_MIN_MS. From rest, only
    // start the clock and move from the next frame, since this call can land anywhere between two frames
    function stepLook() {
      if (isLookSettled()) {
        lookSteppedAt = null;
        return;
      }

      const now = performance.now();
      if (lookSteppedAt === null) {
        lookSteppedAt = now;
        return;
      }

      const maxStep = Math.min(now - lookSteppedAt, MAX_LOOK_STEP_MS) / LOOK_FADE_MIN_MS;
      shownProgress = stepProgressToward(shownProgress, targetProgress, maxStep);
      shownSiblingOpacity = stepToward(shownSiblingOpacity, targetSiblingOpacity, maxStep);
      lookSteppedAt = isLookSettled() ? null : now;
    }

    // Show the fades asked for at once, for a view placed with no animation
    function snapLook() {
      shownProgress = targetProgress;
      shownSiblingOpacity = targetSiblingOpacity;
      lookSteppedAt = null;
    }

    // Build the look from the shown fades. The parent shows only once it is drawn
    function shownLook() {
      const hasParent = levels.liveLevel().crumbs.length > 1 && levels.contextLevel() !== null;
      return {
        inner: shownProgress > 0 ? { path: latchedPath, openProgress: shownProgress, siblingOpacity: 1 } : null,
        outer: hasParent ? { openProgress: 1 + Math.min(shownProgress, 0), siblingOpacity: shownSiblingOpacity } : null
      };
    }

    // Check whether a card is held down in the live level, forgetting a hold whose level was drawn again
    function isCardHeld() {
      if (heldLevelEl !== null && heldLevelEl !== levels.liveLevel().el) {
        heldLevelEl = null;
      }
      return heldLevelEl !== null;
    }

    // Open only a card whose children are read, since the child level is built from them.
    // Wait out a late fade in its preview too, or the child's cards would show at once what was still fading in
    function canDescend(card) {
      return card.children !== undefined && !levels.isFadingIn(card.absPath);
    }

    // Start every fade from the zoom the camera now shows, drawing the look the new gates ask for: no card opening, and
    // the parent's other cards fully shown or hidden
    function resetGates(isSiblingShown) {
      ({ enterZoom, leaveZoom, siblingZoom, latchedPath } = restingGatesAt(camera.getView().zoom, isSiblingShown));
      candidatePath = null;
      shownProgress = 0;
      shownSiblingOpacity = isSiblingShown ? 1 : 0;
    }

    // Open a folder card as the live level, carrying the camera into its coordinates
    function descend(card) {
      const live = levels.liveLevel();
      const fromFolder = live.data.folder;
      onLevelLeave();
      ancestors.pushLevel(live.data);

      const childData = { folder: card.absPath, cards: card.children, folderColor: card.color };
      const frame = levels.descend(card, childData);
      camera.rebase(frame.x, frame.y, frame.scale);

      // Start with the parent's other cards shown and the open folder's card fully open, as they were drawn a frame ago
      resetGates(true);
      onLevelEnter(fromFolder);
    }

    // Make the parent the live level, carrying the camera into its coordinates
    function ascend() {
      const fromFolder = levels.liveLevel().data.folder;
      onLevelLeave();
      const frame = levels.ascend();
      ancestors.popLevel();
      camera.rebase(-frame.x / frame.scale, -frame.y / frame.scale, 1 / frame.scale);

      // The level around the new parent was never drawn, so its cards start hidden
      resetGates(false);
      onLevelEnter(fromFolder);
    }

    // Change level once the shown fades complete, whatever moved the view, unless a card is being dragged or resized.
    // Opening needs the parent hidden, and leaving needs the parent's other cards fully shown
    function changeLevelIfDue() {
      if (isCardHeld()) {
        return false;
      }
      if (shownProgress >= 1 && shownSiblingOpacity <= 0 && canDescend(candidate)) {
        descend(candidate);
        return true;
      }
      if (shownProgress <= -1 && shownSiblingOpacity >= 1 && levels.contextLevel()) {
        ascend();
        return true;
      }
      return false;
    }

    // Take the fades asked for, move the shown ones on in a frame, and change level once they complete.
    // Only frames move the fades, so the steps between two drawn frames add up to the time between them
    function updateLook(isInsideFrame) {
      evaluateTarget();
      if (isInsideFrame) {
        stepLook();
      }
      latchCandidate();
      if (changeLevelIfDue()) {
        evaluateTarget();
        latchCandidate();
      }
      look = shownLook();
    }

    // Reset the gates for a view placed with no animation, or put back the ones saved with it over a reload
    function applyCutGates() {
      if (!savedGates) {
        resetGates(false);
        return;
      }

      ({ enterZoom, leaveZoom, siblingZoom, latchedPath } = savedGates);
      candidatePath = latchedPath;
      savedGates = null;
    }

    // Check whether any of the parent drawn around the live level is on screen
    function isContextShowing() {
      return look.outer !== null && (look.outer.openProgress < 1 || look.outer.siblingOpacity > 0);
    }

    // Start easing the fades to rest from fromLook, with no level change until the move is over
    function startScriptedMove(fromLook) {
      scriptedMove = { fromLook, elapsedMs: 0, steppedAt: performance.now(), isFlying: true };
      look = fromLook;
    }

    // Ease the fades a frame on, and end the move once they rest and the camera no longer flies it
    function stepScriptedMove(frame) {
      // Count the flight as over once input takes over or the camera settles. A resize mid-flight does neither
      if (frame.kind === 'input' || frame.isSettled) {
        scriptedMove.isFlying = false;
      }

      const now = performance.now();
      scriptedMove.elapsedMs += Math.min(now - scriptedMove.steppedAt, MAX_LOOK_STEP_MS);
      scriptedMove.steppedAt = now;
      const progress = Math.min(1, scriptedMove.elapsedMs / LOOK_ANIMATION_MS);
      look = lookTowardRest(scriptedMove.fromLook, easeInOut(progress));
      if (progress === 1 && !scriptedMove.isFlying) {
        // Start the fades over from where the move landed, at rest with the parent's cards hidden
        scriptedMove = null;
        resetGates(false);
        lookSteppedAt = null;
      }
    }

    // Follow one camera frame, resetting the gates on a cut, easing a scripted move, or stepping the fades.
    // Returns true while the fades still have to move on their own, so the camera keeps the frames coming
    function onFrame(frame) {
      if (!levels.liveLevel()) {
        return false;
      }

      // End any scripted move at a cut, starting the fades over from the cut's gates
      if (frame.kind === 'cut') {
        scriptedMove = null;
        applyCutGates();
        evaluateTarget();
        snapLook();
        latchCandidate();
        look = shownLook();
        return false;
      }

      if (scriptedMove) {
        stepScriptedMove(frame);
        if (scriptedMove) {
          return true;
        }
      }

      // Catch up at rest on the rebuilds that would otherwise land mid-motion
      if (frame.isSettled) {
        ancestors.catchUpAtRest();
      }

      updateLook(true);
      return !isLookSettled();
    }

    // Work out the fades again after a redraw or a drag, unless a scripted move is easing them.
    // The shown fades catch up over the frames this asks for
    function refresh() {
      if (!levels.liveLevel() || scriptedMove) {
        return;
      }

      updateLook(false);
      if (!isLookSettled()) {
        camera.requestFrame();
      }
    }

    // Check whether the view holds still, with the camera at rest and no scripted move easing the fades
    function isAtRest() {
      return !camera.isMoving() && scriptedMove === null;
    }

    // Rebuild both levels for the new edit mode, now if the view is still, otherwise once it stops
    function rebuildAtRest() {
      if (ancestors.rebuildAtRest(isAtRest())) {
        refresh();
      }
    }

    function setCardHeld(isHeld) {
      heldLevelEl = isHeld ? levels.liveLevel().el : null;
    }

    // Take the view that frames the live level's cards
    function fitLiveView() {
      return camera.fitView(levels.liveLevel().data.cards);
    }

    function flyToFit() {
      const view = fitLiveView();
      camera.flyTo(view.zoom, view.panX, view.panY);
    }

    function currentLook() {
      return look;
    }

    // Take the gates to save with the view, or the ones a running scripted move lands on, since a reload drops the move
    function gates() {
      if (scriptedMove) {
        return restingGatesAt(camera.getView().zoom, false);
      }
      return { enterZoom, leaveZoom, siblingZoom, latchedPath };
    }

    // Hold on to gates saved over a reload until setView restores their view
    function keepGatesForNextCut(saved) {
      savedGates = saved;
    }

    // Fly to a view, easing the fades back to rest on the way
    function flyToView(view) {
      startScriptedMove(look);
      camera.flyTo(view.zoom, view.panX, view.panY);
    }

    // Open a live folder card from a click, changing level at once and flying in from the fades as drawn.
    // Returns false when the host has to open it: the parent shows, another card opens, or the card cannot open yet
    function flyIntoCard(absPath) {
      const card = levels.liveLevel().cardsByPath.get(absPath);
      const isOtherCardOpening = look.inner !== null && look.inner.path !== absPath;
      if (!card || isOtherCardOpening || isContextShowing() || !canDescend(card)) {
        return false;
      }

      // Keep the card, now the open folder's card, as far open as it was, and its old siblings as they were
      const openProgress = look.inner ? look.inner.openProgress : 0;
      const siblingOpacity = look.inner ? look.inner.siblingOpacity : 1;
      descend(card);
      startScriptedMove({ inner: null, outer: { openProgress, siblingOpacity } });
      flyToFit();
      return true;
    }

    // Fly out to the parent from its breadcrumb, changing level at once and flying out from the fades as drawn.
    // Returns false when the host has to open it: a card is opening or the parent is not drawn yet
    function flyToParent() {
      if (look.inner !== null || !levels.contextLevel()) {
        return false;
      }

      // Keep the old level, now an opening card in the parent, as far open as it was, and the other cards as they were
      const openProgress = look.outer ? look.outer.openProgress : 1;
      const siblingOpacity = look.outer ? look.outer.siblingOpacity : 0;
      const fromFolder = levels.liveLevel().data.folder;
      ascend();
      startScriptedMove({ inner: { path: fromFolder, openProgress, siblingOpacity }, outer: null });
      flyToFit();
      return true;
    }

    // Hold the zoom above the canvas's floor at the root, and let it run far lower inside a folder
    camera.setMinZoomReader(() => {
      const live = levels.liveLevel();
      return live && live.crumbs.length > 1 ? FOLDER_MIN_ZOOM : MIN_ZOOM;
    });

    return {
      onFrame, refresh, rebuildAtRest, setCardHeld, isCardHeld, isAtRest, currentLook, gates, keepGatesForNextCut, fitLiveView,
      flyToView, flyIntoCard, flyToParent
    };
  }

  window.PromptStudioFolderZoom = { create };
})();
