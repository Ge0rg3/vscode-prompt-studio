// Works out paint order, the card on top at a point, and how much of the view a card covers, from card data alone
(function () {
  // A folder card starts opening once it shows over this share of the view, and is fully open at this share
  const COVER_START = 0.35;
  const COVER_FULL = 0.85;

  // --- helpers ---

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  function areaOf(rect) {
    return rect.width * rect.height;
  }

  function containsPoint(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  }

  // Take the part two rectangles share, or null when they do not overlap
  function overlapOf(first, second) {
    const left = Math.max(first.x, second.x);
    const top = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);
    if (right <= left || bottom <= top) {
      return null;
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function distinctSorted(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const distinct = [];
    for (const value of sorted) {
      if (distinct[distinct.length - 1] !== value) {
        distinct.push(value);
      }
    }
    return distinct;
  }

  // Add up the area of a rectangle the covering rectangles leave open, cutting it along their edges into cells
  function uncoveredArea(rect, covers) {
    const xs = [rect.x, rect.x + rect.width];
    const ys = [rect.y, rect.y + rect.height];
    for (const cover of covers) {
      xs.push(cover.x, cover.x + cover.width);
      ys.push(cover.y, cover.y + cover.height);
    }
    const columns = distinctSorted(xs);
    const rows = distinctSorted(ys);

    let openArea = 0;
    for (let i = 0; i < columns.length - 1; i++) {
      for (let j = 0; j < rows.length - 1; j++) {
        // Every covering edge is a cell edge, so the cell's middle tells whether a cover spans the whole cell
        const middleX = (columns[i] + columns[i + 1]) / 2;
        const middleY = (rows[j] + rows[j + 1]) / 2;
        if (!covers.some((cover) => containsPoint(cover, middleX, middleY))) {
          openArea += (columns[i + 1] - columns[i]) * (rows[j + 1] - rows[j]);
        }
      }
    }
    return openArea;
  }

  // --- exports ---

  // List the cards that paint above a card, in list order. z-index stacks them first, then DOM order for equal z
  function cardsPaintedAbove(cards, target) {
    const targetZ = target.z || 0;
    const targetIndex = cards.indexOf(target);
    return cards.filter((card, index) => (card.z || 0) > targetZ || ((card.z || 0) === targetZ && index > targetIndex));
  }

  // Find the card drawn on top at a point, or null over empty space
  function topmostCardAt(cards, point) {
    let topmost = null;
    for (const card of cards) {
      // A later card with the same z paints over an earlier one
      if (containsPoint(card, point.x, point.y) && (!topmost || (card.z || 0) >= (topmost.z || 0))) {
        topmost = card;
      }
    }
    return topmost;
  }

  // Take the view as a rectangle in the level's own coordinates
  function viewRectOf(view, size) {
    return { x: -view.panX / view.zoom, y: -view.panY / view.zoom, width: size.width / view.zoom, height: size.height / view.zoom };
  }

  // Measure the share of the view a rectangle covers, ignoring anything drawn over it
  function rectCoverage(rect, viewRect) {
    const visiblePart = overlapOf(rect, viewRect);
    return visiblePart ? areaOf(visiblePart) / areaOf(viewRect) : 0;
  }

  // Measure the share of the view where a card shows, leaving out the parts cards painted above it hide
  function visibleCoverage(cards, target, viewRect) {
    const visiblePart = overlapOf(target, viewRect);
    if (!visiblePart) {
      return 0;
    }

    // Clip every card painted above the target to the target's part of the view
    const covers = [];
    for (const card of cardsPaintedAbove(cards, target)) {
      const cover = overlapOf(card, visiblePart);
      if (cover) {
        covers.push(cover);
      }
    }

    const openArea = covers.length ? uncoveredArea(visiblePart, covers) : areaOf(visiblePart);
    return openArea / areaOf(viewRect);
  }

  // Map a card's coverage onto how far it has opened, 0 below COVER_START and 1 from COVER_FULL up
  function openProgressFor(coverage) {
    return clamp01((coverage - COVER_START) / (COVER_FULL - COVER_START));
  }

  window.PromptStudioCoverage = {
    clamp01, overlapOf, cardsPaintedAbove, topmostCardAt, viewRectOf, rectCoverage, visibleCoverage, openProgressFor
  };
})();
