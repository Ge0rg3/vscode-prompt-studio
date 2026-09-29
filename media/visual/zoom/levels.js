// Keeps the open folder's cards live, draws the parent folder around them, and swaps the two roles at a level change
(function () {
  // Chromium's moveBefore moves an element without resetting its scroll offsets or restarting its animations
  const CAN_MOVE_IN_PLACE = typeof Element.prototype.moveBefore === 'function';

  // The classes a level's layer takes as the live level and as the parent drawn around it
  const LIVE_CLASS = 'level';
  const CONTEXT_CLASS = 'context';

  // The class that hides the preview in the open folder's card, since the live cards stand in for it
  const OPEN_FOLDER_CLASS = 'open-folder';

  // Copy the live cards into the open folder's card within this long of a change, even if the page never goes idle
  const MIRROR_REFRESH_TIMEOUT_MS = 200;

  const { overlapOf, cardsPaintedAbove } = window.PromptStudioCoverage;
  const { PREVIEW_DEPTH, previewOf } = window.PromptStudioCardBuilders;
  const { applyTint } = window.PromptStudioPalette;

  // --- helpers ---

  function moveInto(parentEl, el, beforeEl) {
    if (CAN_MOVE_IN_PLACE) {
      parentEl.moveBefore(el, beforeEl);
    } else {
      parentEl.insertBefore(el, beforeEl);
    }
  }

  // Lay an element out now, reading its size to make the browser do it while there is time for it
  function layOutNow(el) {
    return el.offsetWidth;
  }

  // Find the parent's cards that paint above the open folder's card and overlap it, in list order. Only these draw over
  // the live cards, since those sit inside that card
  function cardsOverOwn(cards, ownCard) {
    return cardsPaintedAbove(cards, ownCard).filter((card) => overlapOf(card, ownCard) !== null);
  }

  // Check whether two copies of a card match in everything drawn for it, its children aside
  function isSameCardDrawing(drawn, next) {
    return drawn.kind === next.kind && drawn.absPath === next.absPath && drawn.name === next.name &&
      drawn.title === next.title && drawn.text === next.text && drawn.color === next.color &&
      drawn.x === next.x && drawn.y === next.y && drawn.z === next.z &&
      drawn.width === next.width && drawn.height === next.height;
  }

  // Check whether fresh cards change nothing drawn beyond filling blank previews, down to the depth each side draws
  function canAdoptCards(drawnCards, nextCards, drawnDepth, nextDepth, skipPath) {
    if (drawnCards.length !== nextCards.length) {
      return false;
    }

    for (const [index, drawn] of drawnCards.entries()) {
      const next = nextCards[index];
      if (!isSameCardDrawing(drawn, next)) {
        return false;
      }
      if (drawn.kind !== 'folder' || drawn.absPath === skipPath) {
        continue;
      }
      if (!canAdoptChildren(drawn.children, next.children, drawnDepth, nextDepth)) {
        return false;
      }
    }
    return true;
  }

  // Check a folder's fresh children the way its preview draws them, blank when they are unread or past the depth
  function canAdoptChildren(drawnChildren, nextChildren, drawnDepth, nextDepth) {
    if (drawnDepth < 1 || drawnChildren === undefined) {
      return true;
    }
    if (nextDepth < 1 || nextChildren === undefined) {
      return false;
    }
    return canAdoptCards(drawnChildren, nextChildren, drawnDepth - 1, nextDepth - 1, null);
  }

  // Hand fresh children to the card objects already drawn, since the card elements' handlers hold on to those objects
  function graftChildren(drawnCards, nextCards, skipPath) {
    for (const [index, card] of drawnCards.entries()) {
      if (card.kind === 'folder' && card.absPath !== skipPath) {
        card.children = nextCards[index].children;
      }
    }
  }

  // --- exports ---

  // Turn a host state into the data of the level it shows
  function levelDataOf(state) {
    const crumb = state.breadcrumbs[state.breadcrumbs.length - 1];
    return { folder: crumb.path, cards: state.cards, folderColor: state.folderColor };
  }

  // Turn a host state's parent level into level data, or null at the root and on refreshes that leave it out
  function parentDataOf(state) {
    if (!state.parent) {
      return null;
    }

    const crumb = state.breadcrumbs[state.breadcrumbs.length - 2];
    return { folder: crumb.path, cards: state.parent.cards, folderColor: state.parent.folderColor };
  }

  // Draw levels onto the surface. A level is one folder's cards in a layer of their own, with data
  // { folder, cards, folderColor } shared with the ancestor stack, and a level change swaps the layers' roles.
  // attachHandlers(el, card) wires each card, and displayColorOf(path, savedColor) gives its color
  function create(surfaceEl, builders, attachHandlers, displayColorOf) {
    // The parent's cards that draw over the live cards, above them and moved with the parent
    const frontEl = document.createElement('div');
    frontEl.className = CONTEXT_CLASS;
    frontEl.inert = true;
    surfaceEl.appendChild(frontEl);

    // The open folder's level, and the parent level drawn around it
    let live = null;
    let context = null;

    // The parent level being drawn a few cards at a time. It becomes the context once every card is built
    let pendingContext = null;

    // The copy of the live cards in the open folder's card is out of date, and waits for an idle moment or a move up
    // to the parent
    let isMirrorStale = false;
    let mirrorRefreshHandle = null;

    function buildCardEl(card, depth) {
      const el = builders.buildCard(card, depth);
      attachHandlers(el, card);
      return el;
    }

    // Build a level's cards into a fresh live layer under the parent's front cards, their previews depth levels deep
    function buildLive(data, crumbs, depth) {
      const el = document.createElement('div');
      el.className = LIVE_CLASS;

      const cardEls = new Map();
      const cardsByPath = new Map();
      for (const card of data.cards) {
        const cardEl = buildCardEl(card, depth);
        cardEls.set(card.absPath, cardEl);
        cardsByPath.set(card.absPath, card);
        el.appendChild(cardEl);
      }

      surfaceEl.insertBefore(el, frontEl);
      builders.restoreNoteScroll(el);
      return { data, crumbs, el, cardEls, cardsByPath, depth };
    }

    // Map the parent level into the live level's coordinates through the preview frame of the open folder's card
    function placeContext() {
      const { x, y, scale } = context.frame;
      const transform = `scale(${1 / scale}) translate(${-x}px, ${-y}px)`;
      context.el.style.transform = transform;
      frontEl.style.transform = transform;
    }

    // Line the parent up with the frame the live cards give now, worked out from their data
    function reframeContext() {
      context.frame = builders.previewFrame(context.ownCard, live.data.cards);
      placeContext();
    }

    // Put back the scroll offsets a plain move resets on note fields
    function restoreMovedScroll(movedEls) {
      if (CAN_MOVE_IN_PLACE) {
        return;
      }
      for (const el of movedEls) {
        builders.restoreNoteScroll(el);
      }
    }

    function cancelMirrorRefresh() {
      if (mirrorRefreshHandle !== null) {
        cancelIdleCallback(mirrorRefreshHandle);
        mirrorRefreshHandle = null;
      }
    }

    // Copy the live cards into the hidden preview of the open folder's card again
    function refreshMirror() {
      cancelMirrorRefresh();
      context.ownCard.children = live.data.cards;
      const previewEl = previewOf(context.ownEl);
      previewEl.replaceWith(builders.buildPreview(live.data.cards, context.ownCard));
      builders.restoreNoteScroll(context.ownEl);
      isMirrorStale = false;
    }

    // Copy the live cards into the open folder's card at the next idle moment, unless a move up to the parent needs
    // it sooner
    function scheduleMirrorRefresh() {
      if (mirrorRefreshHandle !== null) {
        return;
      }

      mirrorRefreshHandle = requestIdleCallback(() => {
        mirrorRefreshHandle = null;
        if (context && isMirrorStale) {
          refreshMirror();
        }
      }, { timeout: MIRROR_REFRESH_TIMEOUT_MS });
    }

    // Mark the copy of the live cards in the open folder's card out of date, when a parent is drawn or being drawn
    function markMirrorStale() {
      if (!context && !pendingContext) {
        return;
      }

      isMirrorStale = true;
      if (context) {
        scheduleMirrorRefresh();
      }
    }

    // Fill every preview a level drew blank that its data now reaches, leaving out the card at skipPath
    function fillLevelPreviews(level, skipPath) {
      for (const card of level.data.cards) {
        if (card.kind === 'folder' && card.absPath !== skipPath) {
          builders.fillBlankPreviews(level.cardEls.get(card.absPath), card);
        }
      }
      level.depth = PREVIEW_DEPTH;
    }

    // Fill every preview the live level drew blank that its data now reaches, the parent's copy of the level included
    function fillLive() {
      fillLevelPreviews(live, null);
      if (context && !isMirrorStale) {
        builders.fillBlankPreviews(context.ownEl, context.ownCard);
      }
    }

    // Fill in the deepest preview level a descent left out, a frame later so the frame that changes level stays light
    function scheduleFill() {
      const builtLevel = live;
      requestAnimationFrame(() => {
        if (live === builtLevel) {
          fillLive();
        }
      });
    }

    // Tint the open folder's card with the folder's own color, since a state without the parent can still change it
    function syncOwnColor() {
      if (context.ownCard.color === live.data.folderColor) {
        return;
      }

      context.ownCard.color = live.data.folderColor;
      applyTint(context.ownEl, displayColorOf(context.ownCard.absPath, context.ownCard.color), 'colored');
    }

    // Start drawing the parent level in a layer under the live one.
    // Returns null when it has no card for the open folder to line up on
    function beginContext(data) {
      const ownCard = data.cards.find((card) => card.absPath === live.data.folder);
      if (!ownCard) {
        return null;
      }

      // Fill the open folder card's children from the live cards, since the host leaves them out
      ownCard.children = live.data.cards;

      const el = document.createElement('div');
      el.className = CONTEXT_CLASS;
      el.inert = true;
      surfaceEl.insertBefore(el, live.el);
      isMirrorStale = false;
      return {
        data,
        ownCard,
        el,
        cardEls: new Map(),
        cardsByPath: new Map(),
        frontCards: new Set(cardsOverOwn(data.cards, ownCard)),
        builtCount: 0
      };
    }

    // Build the next card of a parent level straight into the layer it draws in, hidden until a paint shows it.
    // Returns the card's element
    function buildNextContextCard(build) {
      const card = build.data.cards[build.builtCount];
      const el = buildCardEl(card, PREVIEW_DEPTH);

      // Hide the card the way the painter does, the open folder's card only faded out
      if (card === build.ownCard) {
        el.classList.add(OPEN_FOLDER_CLASS);
        el.style.opacity = '0';
      } else {
        el.style.visibility = 'hidden';
      }
      build.cardEls.set(card.absPath, el);
      build.cardsByPath.set(card.absPath, card);

      const layerEl = build.frontCards.has(card) ? frontEl : build.el;
      layerEl.appendChild(el);
      builders.restoreNoteScroll(el);
      build.builtCount += 1;
      return el;
    }

    // Once every card of a parent level is built, make it the parent drawn around the live level, lined up on the open
    // folder's card
    function finishContext(build) {
      const { data, ownCard, el, cardEls, cardsByPath } = build;
      const ownEl = cardEls.get(ownCard.absPath);
      context = { data, ownCard, ownEl, el, cardEls, cardsByPath, frame: null, depth: PREVIEW_DEPTH };
      reframeContext();
      syncOwnColor();
      if (isMirrorStale) {
        scheduleMirrorRefresh();
      }
    }

    // Drop a parent level still being drawn. No finished parent exists meanwhile, so the front layer holds only its
    // cards
    function dropPendingContext() {
      if (pendingContext) {
        pendingContext.el.remove();
        frontEl.replaceChildren();
        pendingContext = null;
      }
    }

    // Build the live level from new data, lining the parent up with the new cards at once and copying them in later
    function renderLive(data, crumbs) {
      if (live) {
        live.el.remove();
      }
      live = buildLive(data, crumbs, PREVIEW_DEPTH);
      if (context) {
        context.ownCard.children = data.cards;
        reframeContext();
        syncOwnColor();
      }
      markMirrorStale();
    }

    // Draw the parent level around the live one in full, unless it has no card for the open folder to line up on
    function renderContext(data) {
      clearContext();
      const build = beginContext(data);
      if (!build) {
        return;
      }

      while (build.builtCount < data.cards.length) {
        buildNextContextCard(build);
      }
      finishContext(build);
    }

    // Draw part of the parent level around the live one, a card at a time while hasTimeLeft() holds, one card at least.
    // Each card is laid out as it goes, leaving the next frame nothing to lay out. Returns true once all is drawn
    function buildContextPart(data, hasTimeLeft) {
      if (!pendingContext || pendingContext.data !== data) {
        dropPendingContext();
        pendingContext = beginContext(data);
        if (!pendingContext) {
          return true;
        }
      }

      const build = pendingContext;
      do {
        layOutNow(buildNextContextCard(build));
      } while (build.builtCount < data.cards.length && hasTimeLeft());
      if (build.builtCount < data.cards.length) {
        return false;
      }

      pendingContext = null;
      finishContext(build);
      return true;
    }

    // Drop the parent level drawn around the live one, and any part of one still being drawn
    function clearContext() {
      dropPendingContext();
      if (context) {
        context.el.remove();
        frontEl.replaceChildren();
        context = null;
      }
      cancelMirrorRefresh();
      isMirrorStale = false;
    }

    // Put the parent's cards that drew over the live cards back into its layer, in list order
    function returnFrontCards() {
      const movedEls = [];
      let nextEl = null;
      const cards = context.data.cards;
      for (let i = cards.length - 1; i >= 0; i--) {
        const cardEl = context.cardEls.get(cards[i].absPath);
        if (cardEl.parentNode !== context.el) {
          moveInto(context.el, cardEl, nextEl);
          movedEls.push(cardEl);
        }
        nextEl = cardEl;
      }
      restoreMovedScroll(movedEls);
    }

    // Open a live folder card as the new live level, returning the frame its children were drawn at in the old one
    function descend(card, childData) {
      const frame = builders.previewFrame(card, card.children);
      const crumbs = [...live.crumbs, { path: card.absPath, name: card.name }];

      // Drop the old parent's layers, already faded out at this zoom
      clearContext();

      // Turn the level being left into the parent around the child where it stands.
      // Only the cards that draw over the opened card move, to the front layer
      const { el, data, cardEls, cardsByPath, depth } = live;
      el.className = CONTEXT_CLASS;
      el.inert = true;
      const ownEl = cardEls.get(card.absPath);
      ownEl.classList.add(OPEN_FOLDER_CLASS);

      const movedEls = [];
      for (const frontCard of cardsOverOwn(data.cards, card)) {
        const cardEl = cardEls.get(frontCard.absPath);
        moveInto(frontEl, cardEl, null);
        movedEls.push(cardEl);
      }
      restoreMovedScroll(movedEls);

      context = { data, ownCard: card, ownEl, el, cardEls, cardsByPath, frame, depth };
      placeContext();

      // Build the child one preview level short, as deep as the parent's copy of it drew
      live = buildLive(childData, crumbs, PREVIEW_DEPTH - 1);
      scheduleFill();
      return frame;
    }

    // Make the parent drawn around the live level live again, returning the frame the old level sat at inside it
    function ascend() {
      // Bring the copy of the live cards in the open folder's card up to date before it shows
      if (isMirrorStale) {
        refreshMirror();
      } else {
        builders.restoreNoteScroll(context.ownEl);
      }

      // Turn the parent into the live level where it stands, where the old level's card shows its preview again
      const { data, frame, el, ownEl, cardEls, cardsByPath, depth } = context;
      const crumbs = live.crumbs.slice(0, -1);
      returnFrontCards();
      el.className = LIVE_CLASS;
      el.inert = false;
      el.style.transform = '';
      ownEl.classList.remove(OPEN_FOLDER_CLASS);

      // Drop the old level, whose copy takes its place
      live.el.remove();
      live = { data, crumbs, el, cardEls, cardsByPath, depth };
      context = null;
      cancelMirrorRefresh();
      return frame;
    }

    // Take fresh cards for the live level that canAdoptLive accepted, drawing only what they add
    function adoptLive(cards, folderColor) {
      graftChildren(live.data.cards, cards, null);
      live.data.folderColor = folderColor;
      if (context) {
        syncOwnColor();
      }
      fillLive();
    }

    // Take a fresh copy of the parent level that canAdoptContext accepted, drawing only what it adds
    function adoptContext(data) {
      const ownPath = context.ownCard.absPath;
      graftChildren(context.data.cards, data.cards, ownPath);
      context.data.folderColor = data.folderColor;
      fillLevelPreviews(context, ownPath);
    }

    function canAdoptLive(cards) {
      return canAdoptCards(live.data.cards, cards, live.depth, PREVIEW_DEPTH, null);
    }

    function canAdoptContext(data) {
      return canAdoptCards(context.data.cards, data.cards, context.depth, PREVIEW_DEPTH, context.ownCard.absPath);
    }

    // Line the parent up again after the title row changed height, since the frame depends on it
    function remeasure() {
      if (context) {
        reframeContext();
      }
    }

    // Line the parent up again after a live card moved or changed size.
    // It lines up at once, and the open folder's card copies the new layout at the next idle moment
    function relayout() {
      remeasure();
      markMirrorStale();
    }

    // Check whether a live card's preview is still fading in content that arrived late
    function isFadingIn(absPath) {
      return builders.isFadingIn(live.cardEls.get(absPath));
    }

    // Map the open folder's card into the live level's coordinates through its preview frame
    function ownRect() {
      const { x, y, scale } = context.frame;
      const card = context.ownCard;
      return { x: (card.x - x) / scale, y: (card.y - y) / scale, width: card.width / scale, height: card.height / scale };
    }

    function liveLevel() {
      return live;
    }

    function contextLevel() {
      return context;
    }

    // Find every element drawn for a path: its live card, its card in the parent, and its copies inside previews
    function elementsOf(absPath) {
      const drawnEls = [];
      for (const level of [live, context, pendingContext]) {
        const el = level && level.cardEls.get(absPath);
        if (el) {
          drawnEls.push(el);
        }
      }
      drawnEls.push(...surfaceEl.querySelectorAll(`.mini-card[data-path="${CSS.escape(absPath)}"]`));
      return drawnEls;
    }

    return {
      renderLive, renderContext, buildContextPart, clearContext, descend, ascend, adoptLive, adoptContext, canAdoptLive,
      canAdoptContext, relayout, remeasure, markMirrorStale, isFadingIn, ownRect, liveLevel, contextLevel, elementsOf
    };
  }

  window.PromptStudioLevels = { create, levelDataOf, parentDataOf };
})();
