// Holds back an update from the host that redraws the open folder's cards until the view is still and no card is in use
(function () {
  // Draw a held state after this long even while the view still moves
  const HELD_STATE_MAX_MS = 400;

  const { levelDataOf, parentDataOf } = window.PromptStudioLevels;

  // Take host states for the open folder, calling refreshLook() once one redraws the cards outside a camera frame
  function create(levels, ancestors, folderZoom, editing, refreshLook) {
    // The state waiting to redraw the open folder's cards, and the timer that draws it anyway
    let heldState = null;
    let heldStateTimer;

    // Cards dragged or resized while a state was held, whose new place outranks the one the state was read with
    const movedWhileHeld = new Set();

    // Keep the place of every card moved or resized while the state was held, since the state was read before the move
    function keepMovedPlaces(cards) {
      for (const card of cards) {
        if (!movedWhileHeld.has(card.absPath)) {
          continue;
        }

        const drawn = levels.liveLevel().cardsByPath.get(card.absPath);
        if (drawn) {
          card.x = drawn.x;
          card.y = drawn.y;
          card.z = drawn.z;
          card.width = drawn.width;
          card.height = drawn.height;
        }
      }
    }

    // Check whether a card is being dragged or resized, or a field holds the caret
    function isCardInUse() {
      return folderZoom.isCardHeld() || editing.isEditing();
    }

    // Check whether the cards can be redrawn, with the view at rest and no card in use
    function canRedrawLive() {
      return folderZoom.isAtRest() && !isCardInUse();
    }

    function drop() {
      heldState = null;
      movedWhileHeld.clear();
      clearTimeout(heldStateTimer);
      heldStateTimer = undefined;
    }

    // Check whether a held state waits on nothing but the next frame
    function isDue() {
      return heldState !== null && canRedrawLive();
    }

    // Hand the state's parent level to the ancestors when it carries one
    function takeParentOf(next) {
      const parentData = parentDataOf(next);
      if (parentData) {
        ancestors.takeParent(parentData, folderZoom.isAtRest());
      }
    }

    // Redraw the open folder's cards from the held state, keeping the view and the fades
    function apply() {
      const next = heldState;
      keepMovedPlaces(next.cards);
      drop();
      levels.renderLive(levelDataOf(next), next.breadcrumbs);
      takeParentOf(next);
    }

    // Redraw from the held state now if canRedrawLive allows it
    function applyAtRest() {
      if (isDue()) {
        apply();
        refreshLook();
      }
    }

    // Redraw from a state that waited long enough, even mid-motion, unless a card is held or a field has the caret
    function onHeldStateTimeout() {
      heldStateTimer = undefined;
      if (isCardInUse()) {
        return;
      }

      apply();
      refreshLook();
    }

    // Hold a state that would redraw the open folder's cards, drawing it now if nothing stands in the way
    function hold(next) {
      heldState = next;
      applyAtRest();
      if (heldState && heldStateTimer === undefined) {
        heldStateTimer = setTimeout(onHeldStateTimeout, HELD_STATE_MAX_MS);
      }
    }

    // Adopt a state for the open folder when nothing drawn changes, and hold it for a redraw otherwise.
    // Work out the fades again after adopting, since a folder card whose contents just arrived can open now
    function confirm(next) {
      if (!levels.canAdoptLive(next.cards)) {
        hold(next);
        return;
      }

      drop();
      levels.adoptLive(next.cards, next.folderColor);
      takeParentOf(next);
      refreshLook();
    }

    // Keep a card's new place over the held state's copy of it, after a drag or a resize
    function rememberMovedCard(absPath) {
      if (heldState) {
        movedWhileHeld.add(absPath);
      }
    }

    // Redraw from the held state inside a camera frame, before the frame works out the fades from the cards
    function applyInFrame() {
      if (isDue()) {
        apply();
      }
    }

    return { confirm, drop, applyAtRest, applyInFrame, isDue, rememberMovedCard };
  }

  window.PromptStudioHeldStates = { create };
})();
