// Pans and zooms the card surface, and turns screen points into surface points
(function () {
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 20;
  const ZOOM_STEP_FACTOR = 1.25;
  const WHEEL_ZOOM_RATE = 0.0015;

  // A wheel reporting lines or pages rather than pixels moves about this far per step
  const WHEEL_DELTA_LINES = 1;
  const WHEEL_DELTA_PAGES = 2;
  const WHEEL_LINE_PIXELS = 16;
  const WHEEL_PAGE_PIXELS = 800;

  const MIDDLE_BUTTON = 1;

  const FIT_MARGIN = 40;
  const FIT_MAX_ZOOM = 1;

  // The gap between the zoom on screen and the zoom asked for halves this often
  const ZOOM_HALF_LIFE_MS = 55;

  // Land on the target once the gap is this small a share of it
  const ZOOM_SETTLE_RATIO = 0.001;

  // One frame at 60Hz, the step the first frame of a gesture eases by
  const FRAME_MS = 16;

  // Ease by no more than this in one step, so a backgrounded tab does not jump on its way back
  const MAX_FRAME_MS = 100;

  // Keep the surface on its own layer until the gestures have been over this long
  const GESTURE_LAYER_MS = 250;

  function clampZoom(zoom) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  }

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

  function rectOf(card) {
    return { x: card.x, y: card.y, width: card.width, height: card.height };
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

  // Drive the pan and zoom of one surface inside its canvas element, reporting every change
  function create(canvasEl, surfaceEl, onViewChange) {
    let zoom = 1;
    let panX = 0;
    let panY = 0;

    // What the zoom is easing toward, and the point it holds still on the way there
    let targetZoom = 1;
    let anchorScreenX = 0;
    let anchorScreenY = 0;
    let anchorSurfaceX = 0;
    let anchorSurfaceY = 0;

    // A gesture leaves its pan here for the next frame, so what is drawn is always what is reported
    let pendingPanX = 0;
    let pendingPanY = 0;

    // Where the gesture in flight has got to
    let isFramePending = false;
    let lastFrameAt = 0;
    let layerTimer;
    let isZoomSuspended = false;

    // Draw the surface where the current pan and zoom put it
    function draw(isGesture) {
      surfaceEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      onViewChange(zoom, isGesture, { x: anchorSurfaceX, y: anchorSurfaceY });
    }

    // Hold the surface on its own layer until the gestures have stopped coming
    function holdLayer() {
      surfaceEl.classList.add('gesturing');
      clearTimeout(layerTimer);
      layerTimer = setTimeout(() => {
        surfaceEl.classList.remove('gesturing');
      }, GESTURE_LAYER_MS);
    }

    // Move the pan so the anchored point stays under the same spot on screen as the scale changes
    function holdAnchor() {
      panX = anchorScreenX - anchorSurfaceX * zoom;
      panY = anchorScreenY - anchorSurfaceY * zoom;
    }

    // Ease the scale toward the target, lay the waiting pan over it, and draw the two together
    function stepFrame(now) {
      isFramePending = false;
      const elapsed = lastFrameAt ? Math.min(now - lastFrameAt, MAX_FRAME_MS) : FRAME_MS;
      lastFrameAt = now;

      const gap = targetZoom - zoom;
      const isEasing = Math.abs(gap) > targetZoom * ZOOM_SETTLE_RATIO;
      if (isEasing) {
        zoom = targetZoom - gap * Math.pow(0.5, elapsed / ZOOM_HALF_LIFE_MS);
        holdAnchor();
      } else if (zoom !== targetZoom) {
        zoom = targetZoom;
        holdAnchor();
      }

      if (pendingPanX || pendingPanY) {
        panX += pendingPanX;
        panY += pendingPanY;
        pendingPanX = 0;
        pendingPanY = 0;

        // Re-read the surface point under the zoom anchor, since the pan just moved it
        anchorSurfaceX = (anchorScreenX - panX) / zoom;
        anchorSurfaceY = (anchorScreenY - panY) / zoom;
      }

      draw(true);
      if (isEasing) {
        requestFrame();
      } else {
        lastFrameAt = 0;
      }
    }

    function requestFrame() {
      if (isFramePending) {
        return;
      }

      isFramePending = true;
      holdLayer();
      requestAnimationFrame(stepFrame);
    }

    function panBy(dx, dy) {
      pendingPanX += dx;
      pendingPanY += dy;
      requestFrame();
    }

    // Aim the zoom at a screen point, easing there over the next few frames
    function zoomAt(clientX, clientY, factor) {
      if (isZoomSuspended) {
        return;
      }

      const rect = canvasEl.getBoundingClientRect();
      anchorScreenX = clientX - rect.left;
      anchorScreenY = clientY - rect.top;
      anchorSurfaceX = (anchorScreenX - panX) / zoom;
      anchorSurfaceY = (anchorScreenY - panY) / zoom;
      targetZoom = clampZoom(targetZoom * factor);
      requestFrame();
    }

    // Zoom about the middle of the view
    function zoomByFactor(factor) {
      const rect = canvasEl.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    }

    // Turn zoom input away while the canvas moves between folders, so the rest of a flick is not carried in
    function suspendZoom(isSuspended) {
      isZoomSuspended = isSuspended;
      targetZoom = zoom;
    }

    // Place the view exactly, dropping any zoom still on its way
    function setView(nextZoom, nextPanX, nextPanY) {
      // The move this was waiting on has landed, so the pointer drives the new view again
      isZoomSuspended = false;
      zoom = clampZoom(nextZoom);
      targetZoom = zoom;
      panX = nextPanX;
      panY = nextPanY;
      pendingPanX = 0;
      pendingPanY = 0;
      lastFrameAt = 0;
      draw(false);
    }

    function getView() {
      return { zoom, panX, panY };
    }

    function toSurface(clientX, clientY) {
      const rect = canvasEl.getBoundingClientRect();
      return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
    }

    // Take the surface point the middle of the view sits on
    function centerPoint() {
      return { x: (canvasEl.clientWidth / 2 - panX) / zoom, y: (canvasEl.clientHeight / 2 - panY) / zoom };
    }

    function viewportSize() {
      return { width: canvasEl.clientWidth, height: canvasEl.clientHeight };
    }

    // Frame the given rectangles, falling back to the origin when there are none
    function fit(rects) {
      if (!rects.length) {
        setView(1, 0, 0);
        return;
      }

      // A panel too short to hold the margin still gets a positive zoom out of this
      const bounds = boundsOf(rects);
      const size = viewportSize();
      const nextZoom = clampZoom(Math.min(
        FIT_MAX_ZOOM,
        Math.max(1, size.width - FIT_MARGIN * 2) / bounds.width,
        Math.max(1, size.height - FIT_MARGIN * 2) / bounds.height
      ));
      setView(
        nextZoom,
        (size.width - bounds.width * nextZoom) / 2 - bounds.left * nextZoom,
        (size.height - bounds.height * nextZoom) / 2 - bounds.top * nextZoom
      );
    }

    // Go back to full size around whatever the view is centered on, without reading as a zoom gesture
    function resetZoom() {
      const size = viewportSize();
      const middle = centerPoint();
      setView(1, size.width / 2 - middle.x, size.height / 2 - middle.y);
    }

    // Pinch and ctrl+wheel zoom, a plain wheel pans
    canvasEl.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = wheelPixels(event);
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.clientX, event.clientY, Math.exp(-delta.y * WHEEL_ZOOM_RATE));
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
      const isBackgroundDrag = event.button === 0 && event.target === canvasEl;
      if (!isBackgroundDrag && event.button !== MIDDLE_BUTTON) {
        return;
      }

      // A middle press would otherwise start the browser's own scroll gesture
      if (event.button === MIDDLE_BUTTON) {
        event.preventDefault();
      }

      let lastX = event.clientX;
      let lastY = event.clientY;
      canvasEl.setPointerCapture(event.pointerId);
      canvasEl.classList.add('panning');

      const onMove = (move) => {
        panBy(move.clientX - lastX, move.clientY - lastY);
        lastX = move.clientX;
        lastY = move.clientY;
      };

      const onUp = () => {
        canvasEl.releasePointerCapture(event.pointerId);
        canvasEl.classList.remove('panning');
        canvasEl.removeEventListener('pointermove', onMove);
        canvasEl.removeEventListener('pointerup', onUp);
        canvasEl.removeEventListener('pointercancel', onUp);
      };

      canvasEl.addEventListener('pointermove', onMove);
      canvasEl.addEventListener('pointerup', onUp);
      canvasEl.addEventListener('pointercancel', onUp);
    });

    function zoomIn() {
      zoomByFactor(ZOOM_STEP_FACTOR);
    }

    function zoomOut() {
      zoomByFactor(1 / ZOOM_STEP_FACTOR);
    }

    return { getView, setView, suspendZoom, zoomIn, zoomOut, resetZoom, fit, toSurface, viewportSize };
  }

  window.PromptStudioViewport = { create, clampZoom, boundsOf, rectOf };
})();
