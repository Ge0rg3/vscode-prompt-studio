// Pans, zooms and flies the view over the card surface, and carries it into another folder's coordinates without a jump
(function () {
  // The canvas root holds the zoom above MIN_ZOOM, and a folder sets a floor of its own through setMinZoomReader
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 64;
  const LOG_MAX_ZOOM = Math.log(MAX_ZOOM);

  // Zoom 1.2x per 120px of wheel, one notch on X11. A 100px Windows notch zooms a little less
  const NOTCH_LOG = Math.log(1.2);
  const NOTCH_PX = 120;

  // Let one event zoom up to this many notches, since Chromium folds the notches of a fast spin into one event
  const MAX_EVENT_NOTCHES = 5;

  // Chromium sends a pinch as ctrl+wheel with deltaY = -100 ln(scale)
  const PINCH_PX_PER_LOG_UNIT = 100;

  // Draw a zoom step smaller than this many pixels straight away, since a pinch sends a few pixels per event and a
  // wheel notch 100 or more
  const DIRECT_PX_MAX = 20;

  // Let the zoom asked for run at most this far ahead of the zoom drawn, about two folders deep
  const MAX_LEAD_LOG = Math.log(8);

  // A key or button press zooms by this step, and a held key zooms at this rate per second
  const KEY_STEP_LOG = Math.log(1.25);
  const KEY_HOLD_LOG_RATE = Math.log(4);

  // Cap the time a key repeat counts for, since the first repeat lands a good while after the press
  const KEY_HOLD_MAX_MS = 100;

  // Halve the gap between the zoom drawn and the zoom asked for this often, closing at most this many ln units a second
  const ZOOM_HALF_LIFE_MS = 55;
  const INPUT_MAX_LOG_SPEED = 12;

  // A flight eases at a calmer pace than the wheel
  const FLIGHT_HALF_LIFE_MS = 80;
  const FLIGHT_MAX_LOG_SPEED = 8;

  // Slide the view instead when a flight changes the zoom by less than this, since the point it zooms about runs off
  // toward infinity
  const PAN_ONLY_LOG = 0.02;

  // Land on the target once nothing in view would move another half pixel
  const SETTLE_PX = 0.5;

  // One frame at 60Hz, the step the first frame of a gesture eases by
  const FRAME_MS = 16;

  // Ease by no more than this in one step, so a backgrounded tab does not jump on its way back
  const MAX_FRAME_MS = 100;

  // Keep hover effects off until the view has been still this long
  const GESTURE_END_MS = 250;

  // A wheel reporting lines or pages rather than pixels moves about this far per step
  const WHEEL_DELTA_LINES = 1;
  const WHEEL_DELTA_PAGES = 2;
  const WHEEL_LINE_PIXELS = 16;
  const WHEEL_PAGE_PIXELS = 800;

  const PRIMARY_BUTTON = 0;
  const MIDDLE_BUTTON = 1;

  const GESTURING_CLASS = 'gesturing';
  const PANNING_CLASS = 'panning';

  const FIT_MARGIN = 40;
  const FIT_MAX_ZOOM = 1;

  // --- helpers ---

  // Read a wheel event as pixels, whichever unit it arrives in
  function wheelPixels(event) {
    let pixelsPerUnit = 1;
    if (event.deltaMode === WHEEL_DELTA_LINES) {
      pixelsPerUnit = WHEEL_LINE_PIXELS;
    } else if (event.deltaMode === WHEEL_DELTA_PAGES) {
      pixelsPerUnit = WHEEL_PAGE_PIXELS;
    }
    return { x: event.deltaX * pixelsPerUnit, y: event.deltaY * pixelsPerUnit };
  }

  function clampMagnitude(value, limit) {
    return Math.max(-limit, Math.min(limit, value));
  }

  // Take the share of the gap an ease with this half-life closes in the time elapsed
  function halfLifeShare(elapsedMs, halfLifeMs) {
    return 1 - Math.pow(0.5, elapsedMs / halfLifeMs);
  }

  // Turn a ctrl+wheel into a zoom step in ln units, matching a pinch exactly and a wheel by its pixels
  function wheelLogStep(pixelsY, isRealWheel) {
    if (isRealWheel) {
      return clampMagnitude(-pixelsY * NOTCH_LOG / NOTCH_PX, MAX_EVENT_NOTCHES * NOTCH_LOG);
    }
    return clampMagnitude(-pixelsY / PINCH_PX_PER_LOG_UNIT, NOTCH_LOG);
  }

  // Move a zoom target by a step, stopping at the zoom limits without ever pulling it back against the step
  function stepTarget(logTarget, logStep, logMinZoom) {
    const next = logTarget + logStep;
    if (logStep > 0) {
      return Math.min(next, Math.max(LOG_MAX_ZOOM, logTarget));
    }
    return Math.max(next, Math.min(logMinZoom, logTarget));
  }

  // Take the box every rectangle sits inside
  function boundsOf(rects) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const rect of rects) {
      left = Math.min(left, rect.x);
      top = Math.min(top, rect.y);
      right = Math.max(right, rect.x + rect.width);
      bottom = Math.max(bottom, rect.y + rect.height);
    }
    return { left, top, width: right - left, height: bottom - top };
  }

  // --- exports ---

  // Drive the pan and zoom of one surface inside its canvas element, handing every frame to onFrame before it is drawn
  function create(canvasEl, surfaceEl, onFrame) {
    // The zoom drawn now and the zoom it is heading for, both as ln(zoom)
    let logZoom = 0;
    let logTarget = 0;

    // The view as drawn, with the zoom kept apart from logZoom to give back exactly what setView placed
    let zoom = 1;
    let panX = 0;
    let panY = 0;

    // Read the lowest zoom that input and fitView can reach, since it changes from folder to folder
    let readMinZoom = () => MIN_ZOOM;

    // The point the zoom holds still, as a spot on screen and the surface point under it
    const anchor = { screenX: 0, screenY: 0, surfaceX: 0, surfaceY: 0 };

    // Input waiting for the next frame to draw it
    let pendingPanX = 0;
    let pendingPanY = 0;
    let pendingLogStep = 0;

    // The animated move flyTo started, or null. It zooms about a fixed anchor, or slides the anchor when the zoom
    // barely changes
    let flight = null;
    let hasCancelledFlight = false;

    // The canvas size, read before setView jumps the view and kept by a ResizeObserver, so frames and clicks never
    // touch layout
    let viewWidth = 0;
    let viewHeight = 0;

    let isFramePending = false;
    let lastFrameAt = 0;
    let lastKeyStepAt = -Infinity;
    let isModifierHeld = false;
    let gestureTimer;

    // True while onFrame runs inside a frame. The frame writes the transform after it
    let isInsideFrame = false;

    // Jump straight to a view instead of flying there when the system asks for reduced motion
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Move the drawn zoom in ln units, and the plain zoom with it
    function setLogZoom(nextLogZoom) {
      logZoom = nextLogZoom;
      zoom = Math.exp(nextLogZoom);
    }

    // Read the canvas size from layout. It costs nothing while no change to the page waits to be laid out
    function measureView() {
      viewWidth = canvasEl.clientWidth;
      viewHeight = canvasEl.clientHeight;
    }

    // Pin the zoom to a screen point, reading the surface point under it off the view as drawn
    function setAnchor(screenX, screenY) {
      anchor.screenX = screenX;
      anchor.screenY = screenY;
      anchor.surfaceX = (screenX - panX) / zoom;
      anchor.surfaceY = (screenY - panY) / zoom;
    }

    function centerAnchor() {
      setAnchor(viewWidth / 2, viewHeight / 2);
    }

    // Move the pan so the anchored point stays under the same spot on screen as the scale changes
    function holdAnchor() {
      panX = anchor.screenX - anchor.surfaceX * zoom;
      panY = anchor.screenY - anchor.surfaceY * zoom;
    }

    // Measure from the anchor to the corner of the view farthest from it, the point a zoom moves most
    function farthestCornerDistance() {
      const dx = Math.max(anchor.screenX, viewWidth - anchor.screenX);
      const dy = Math.max(anchor.screenY, viewHeight - anchor.screenY);
      return Math.hypot(dx, dy);
    }

    // Draw the surface where the current pan and zoom put it
    function writeTransform() {
      surfaceEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    }

    // Keep hover effects off while the view moves, and until it has been still a moment
    function holdGesture() {
      surfaceEl.classList.add(GESTURING_CLASS);
      clearTimeout(gestureTimer);
      gestureTimer = setTimeout(() => {
        surfaceEl.classList.remove(GESTURING_CLASS);
      }, GESTURE_END_MS);
    }

    // Ask for one frame, however many times this runs before it comes
    function requestFrame() {
      if (isFramePending) {
        return;
      }

      isFramePending = true;
      requestAnimationFrame(stepFrame);
    }

    // Hand the view to user input, stopping any flight at the zoom drawn now
    function stopFlightForInput() {
      if (!flight) {
        return;
      }

      flight = null;
      hasCancelledFlight = true;
      logTarget = logZoom;
      centerAnchor();
    }

    // Remember whether Ctrl or Meta is really held, since Chromium sends a pinch as ctrl+wheel with no key press
    function trackModifier(event) {
      if (event.key === 'Control' || event.key === 'Meta') {
        isModifierHeld = event.ctrlKey || event.metaKey;
      }
    }

    // Close part of the gap to the target in ln units, no faster than the speed limit
    function easeZoom(elapsedMs) {
      const halfLifeMs = flight ? FLIGHT_HALF_LIFE_MS : ZOOM_HALF_LIFE_MS;
      const maxStep = (flight ? FLIGHT_MAX_LOG_SPEED : INPUT_MAX_LOG_SPEED) * elapsedMs / 1000;
      const step = (logTarget - logZoom) * halfLifeShare(elapsedMs, halfLifeMs);
      if (step) {
        setLogZoom(logZoom + clampMagnitude(step, maxStep));
      }
    }

    // Slide the anchor toward the flight's screen point at the pace the zoom eases
    function slideAnchor(elapsedMs) {
      const share = halfLifeShare(elapsedMs, FLIGHT_HALF_LIFE_MS);
      anchor.screenX += (flight.screenX - anchor.screenX) * share;
      anchor.screenY += (flight.screenY - anchor.screenY) * share;
    }

    // Lay the waiting pan over the view, then re-read the surface point under the anchor, since the pan moved it
    function applyPendingPan() {
      if (!pendingPanX && !pendingPanY) {
        return;
      }

      panX += pendingPanX;
      panY += pendingPanY;
      pendingPanX = 0;
      pendingPanY = 0;
      setAnchor(anchor.screenX, anchor.screenY);
    }

    // Snap onto the target once the rest of the way is too small to see
    function settleIfInvisible() {
      if (logZoom === logTarget && !flight) {
        return;
      }

      // Add how far the anchor still has to slide to how far the remaining zoom moves the farthest corner
      const slidePx = flight ? Math.hypot(flight.screenX - anchor.screenX, flight.screenY - anchor.screenY) : 0;
      const zoomPx = Math.abs(Math.expm1(logTarget - logZoom)) * farthestCornerDistance();
      if (slidePx + zoomPx >= SETTLE_PX) {
        return;
      }

      if (logZoom !== logTarget) {
        setLogZoom(logTarget);
      }
      if (flight) {
        anchor.screenX = flight.screenX;
        anchor.screenY = flight.screenY;
      }
      holdAnchor();

      // A landed flight hands the anchor back to the middle of the view, as a cut does
      if (flight) {
        flight = null;
        centerAnchor();
      }
    }

    // Move the view one frame on, returning whether anything on screen moved
    function advance(elapsedMs) {
      const startZoom = zoom;
      const startPanX = panX;
      const startPanY = panY;

      // Draw the pinch steps that came in since the last frame in full, then ease the rest of the way
      if (pendingLogStep) {
        setLogZoom(logZoom + pendingLogStep);
        pendingLogStep = 0;
      }
      easeZoom(elapsedMs);

      // Keep the anchor still on screen, or slide it on in a flight that only pans
      if (flight) {
        slideAnchor(elapsedMs);
      }
      if (flight || zoom !== startZoom) {
        holdAnchor();
      }

      applyPendingPan();
      settleIfInvisible();
      return zoom !== startZoom || panX !== startPanX || panY !== startPanY;
    }

    // Hand a frame to onFrame, returning whether it asks for another
    function reportFrame(kind) {
      isInsideFrame = true;
      const shouldRequestFrame = onFrame({ kind, isSettled: !isMoving() });
      isInsideFrame = false;
      return shouldRequestFrame;
    }

    // Ease the view, let onFrame react before anything is drawn, then write the transform once
    function stepFrame(now) {
      isFramePending = false;
      const elapsedMs = lastFrameAt ? Math.min(now - lastFrameAt, MAX_FRAME_MS) : FRAME_MS;
      lastFrameAt = now;

      // Move the view and note what moved it
      const wasFlying = flight !== null;
      const hasMoved = advance(elapsedMs);
      let kind = 'tick';
      if (wasFlying) {
        kind = 'flight';
      } else if (hasMoved || hasCancelledFlight) {
        kind = 'input';
      }
      hasCancelledFlight = false;

      // Let onFrame react, then draw
      const shouldRequestFrame = reportFrame(kind);
      writeTransform();
      if (hasMoved) {
        holdGesture();
      }

      // Keep the frames coming while the view moves or onFrame asks for more
      if (isMoving() || shouldRequestFrame) {
        requestFrame();
      } else {
        lastFrameAt = 0;
      }
    }

    // Let onFrame catch up with a change that moved nothing, then write the transform in case it changed level
    function tick() {
      const shouldRequestFrame = reportFrame('tick');
      writeTransform();
      if (shouldRequestFrame) {
        requestFrame();
      }
    }

    // Zoom by a step in ln units about a screen point, easing there, or drawing a pinch step in full at the next frame
    function zoomAbout(screenX, screenY, logStep, isDirect) {
      stopFlightForInput();
      setAnchor(screenX, screenY);

      // Drop any zoom still queued in the other direction when the input turns back
      const bankedLog = logTarget - logZoom - pendingLogStep;
      if (bankedLog * logStep < 0) {
        logTarget -= bankedLog;
      }

      const nextTarget = stepTarget(logTarget, logStep, Math.log(readMinZoom()));
      if (isDirect) {
        pendingLogStep += nextTarget - logTarget;
      }
      logTarget = nextTarget;

      // Cap how far the zoom asked for runs ahead of the zoom drawn
      const leadLog = logTarget - logZoom - pendingLogStep;
      if (Math.abs(leadLog) > MAX_LEAD_LOG) {
        logTarget -= leadLog - Math.sign(leadLog) * MAX_LEAD_LOG;
      }
      requestFrame();
    }

    function panBy(dx, dy) {
      stopFlightForInput();
      pendingPanX += dx;
      pendingPanY += dy;
      requestFrame();
    }

    // Check whether the zoom, a pan, or a flight still has somewhere to go
    function isMoving() {
      return logZoom !== logTarget || pendingLogStep !== 0 || pendingPanX !== 0 || pendingPanY !== 0 || flight !== null;
    }

    function getView() {
      return { zoom, panX, panY };
    }

    // Take the surface point the zoom holds still
    function getAnchor() {
      return { x: anchor.surfaceX, y: anchor.surfaceY };
    }

    function viewportSize() {
      return { width: viewWidth, height: viewHeight };
    }

    function toSurface(clientX, clientY) {
      const rect = canvasEl.getBoundingClientRect();
      return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
    }

    function setMinZoomReader(nextReadMinZoom) {
      readMinZoom = nextReadMinZoom;
    }

    // Place the view with no animation, dropping any zoom, pan, or flight still on its way, and report it as a cut
    function setView(nextZoom, nextPanX, nextPanY) {
      zoom = nextZoom;
      logZoom = Math.log(nextZoom);
      logTarget = logZoom;
      panX = nextPanX;
      panY = nextPanY;
      pendingPanX = 0;
      pendingPanY = 0;
      pendingLogStep = 0;
      flight = null;
      hasCancelledFlight = false;

      centerAnchor();
      writeTransform();
      if (onFrame({ kind: 'cut', isSettled: true })) {
        requestFrame();
      }
    }

    // Fly to a view, zooming about the one screen point that sits over the same surface point in both views
    function flyTo(nextZoom, nextPanX, nextPanY) {
      if (reducedMotionQuery.matches) {
        setView(nextZoom, nextPanX, nextPanY);
        return;
      }

      // Start from the view the next frame would have drawn
      if (pendingLogStep) {
        setLogZoom(logZoom + pendingLogStep);
        pendingLogStep = 0;
        holdAnchor();
      }
      applyPendingPan();

      // Hold the fixed point of the two views still, or slide the middle of the view when the zoom barely changes
      if (Math.abs(Math.log(nextZoom / zoom)) < PAN_ONLY_LOG) {
        centerAnchor();
        flight = { screenX: nextPanX + anchor.surfaceX * nextZoom, screenY: nextPanY + anchor.surfaceY * nextZoom };
      } else {
        setAnchor(
          (panX * nextZoom - nextPanX * zoom) / (nextZoom - zoom),
          (panY * nextZoom - nextPanY * zoom) / (nextZoom - zoom)
        );
        flight = { screenX: anchor.screenX, screenY: anchor.screenY };
      }

      logTarget = Math.log(nextZoom);
      requestFrame();
    }

    // Carry the view into another level's coordinates, where old surface point = origin + new point * scale.
    // Nothing moves on screen, and any zoom, pan or flight on its way carries on where it was heading
    function rebase(originX, originY, scale) {
      panX += originX * zoom;
      panY += originY * zoom;
      zoom *= scale;
      logZoom += Math.log(scale);
      logTarget += Math.log(scale);
      anchor.surfaceX = (anchor.surfaceX - originX) / scale;
      anchor.surfaceY = (anchor.surfaceY - originY) / scale;

      // Write the transform now, unless a frame is running and writes it once onFrame returns
      if (!isInsideFrame) {
        writeTransform();
      }
    }

    // Zoom about the middle of the view for a key or a button, a step per press and a steady rate while a key repeats
    function zoomStep(direction, isRepeat) {
      const now = performance.now();
      const heldMs = Math.min(now - lastKeyStepAt, KEY_HOLD_MAX_MS);
      lastKeyStepAt = now;
      const logStep = isRepeat ? KEY_HOLD_LOG_RATE * heldMs / 1000 : KEY_STEP_LOG;
      zoomAbout(viewWidth / 2, viewHeight / 2, direction * logStep, false);
    }

    // Work out the view that frames the rectangles at the last-read canvas size, or 100% at the origin for none
    function fitView(rects) {
      if (!rects.length) {
        return { zoom: 1, panX: 0, panY: 0 };
      }

      // A panel too short to hold the margin still gets a positive zoom out of this
      const bounds = boundsOf(rects);
      const fitZoom = Math.max(readMinZoom(), Math.min(
        FIT_MAX_ZOOM,
        Math.max(1, viewWidth - FIT_MARGIN * 2) / bounds.width,
        Math.max(1, viewHeight - FIT_MARGIN * 2) / bounds.height
      ));
      return {
        zoom: fitZoom,
        panX: (viewWidth - bounds.width * fitZoom) / 2 - bounds.left * fitZoom,
        panY: (viewHeight - bounds.height * fitZoom) / 2 - bounds.top * fitZoom
      };
    }

    // Work out the view at full size around whatever the middle of the view sits on
    function actualSizeView() {
      return {
        zoom: 1,
        panX: viewWidth / 2 - (viewWidth / 2 - panX) / zoom,
        panY: viewHeight / 2 - (viewHeight / 2 - panY) / zoom
      };
    }

    // Pinch and ctrl+wheel zoom, a plain wheel pans, and either one stops a flight
    canvasEl.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = wheelPixels(event);
      if (event.ctrlKey || event.metaKey) {
        const rect = canvasEl.getBoundingClientRect();
        const isDirect = !isModifierHeld && Math.abs(delta.y) < DIRECT_PX_MAX;
        zoomAbout(event.clientX - rect.left, event.clientY - rect.top, wheelLogStep(delta.y, isModifierHeld), isDirect);
        return;
      }

      // Shift turns a vertical wheel into a sideways pan
      if (event.shiftKey && delta.x === 0) {
        panBy(-delta.y, 0);
        return;
      }

      panBy(-delta.x, -delta.y);
    }, { passive: false });

    // Drag empty space, or drag with the middle button anywhere, to pan
    canvasEl.addEventListener('pointerdown', (event) => {
      const isBackgroundDrag = event.button === PRIMARY_BUTTON && event.target === canvasEl;
      if (!isBackgroundDrag && event.button !== MIDDLE_BUTTON) {
        return;
      }

      // A middle press grabs the view, stopping a flight where it is, and must not start the browser's scroll gesture
      if (event.button === MIDDLE_BUTTON) {
        event.preventDefault();
        stopFlightForInput();
      }
      let lastX = event.clientX;
      let lastY = event.clientY;
      canvasEl.setPointerCapture(event.pointerId);
      canvasEl.classList.add(PANNING_CLASS);

      const onMove = (move) => {
        panBy(move.clientX - lastX, move.clientY - lastY);
        lastX = move.clientX;
        lastY = move.clientY;
      };

      const onUp = () => {
        canvasEl.releasePointerCapture(event.pointerId);
        canvasEl.classList.remove(PANNING_CLASS);
        canvasEl.removeEventListener('pointermove', onMove);
        canvasEl.removeEventListener('pointerup', onUp);
        canvasEl.removeEventListener('pointercancel', onUp);
      };

      canvasEl.addEventListener('pointermove', onMove);
      canvasEl.addEventListener('pointerup', onUp);
      canvasEl.addEventListener('pointercancel', onUp);
    });

    // Stop a flight where it is when empty space is grabbed, except on the second press of a double-click, whose first
    // click just started that flight. Only the mouse events carry the click count
    canvasEl.addEventListener('mousedown', (event) => {
      if (event.button !== PRIMARY_BUTTON || event.target !== canvasEl) {
        return;
      }

      // Keep a double-click from selecting the text of every note
      if (event.detail > 1) {
        event.preventDefault();
        return;
      }
      stopFlightForInput();
    });

    window.addEventListener('keydown', trackModifier, true);
    window.addEventListener('keyup', trackModifier, true);

    // A key let go while the panel is in the background never reports its keyup
    window.addEventListener('blur', () => {
      isModifierHeld = false;
    });

    // Report a new panel size in the same frame it changes
    new ResizeObserver(() => {
      const previousWidth = viewWidth;
      const previousHeight = viewHeight;
      measureView();
      if (viewWidth !== previousWidth || viewHeight !== previousHeight) {
        tick();
      }
    }).observe(canvasEl);

    measureView();
    centerAnchor();
    return {
      getView, getAnchor, viewportSize, toSurface, isMoving, setMinZoomReader, setView, flyTo, rebase, zoomStep, fitView, actualSizeView,
      requestFrame, measureView
    };
  }

  window.PromptStudioViewport = { create, boundsOf, MIN_ZOOM };
})();
