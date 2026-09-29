// Keeps the stack of folders above the open one, and redraws the levels from it once the view rests or the page is idle
(function () {
  // Draw the next part of the parent within this long of the last part, even if the page never goes idle
  const CONTEXT_BUILD_TIMEOUT_MS = 100;

  // Give every part at least this long to draw in, since a part that waited out the timeout gets no idle time at all
  const MIN_SLICE_MS = 5;

  // Keep the levels above the live one, and draw the parent from the top of the stack.
  // onBeforeRebuild() runs just before both levels are built again from scratch, in the same task
  function create(levels, onBeforeRebuild) {
    // The levels above the live one, root first and parent last. When the host opens a folder directly, it starts at
    // that folder's parent
    let ancestorLevels = [];

    // The parent drawn around the live level is out of date and waits for the view to come to rest
    let isContextStale = false;
    let contextBuildHandle = null;

    // Both levels wait for the view to come to rest before they are built again in the new edit mode
    let isRebuildPending = false;

    function cancelContextBuild() {
      if (contextBuildHandle !== null) {
        cancelIdleCallback(contextBuildHandle);
        contextBuildHandle = null;
      }
    }

    // Draw part of the parent around the live level in the idle time given, and ask for more until it is drawn
    function buildContextSlice(deadline) {
      contextBuildHandle = null;
      if (levels.contextLevel() || !ancestorLevels.length) {
        return;
      }

      const minSliceEnd = performance.now() + MIN_SLICE_MS;
      const hasTimeLeft = () => performance.now() < minSliceEnd || deadline.timeRemaining() > 0;
      if (!levels.buildContextPart(ancestorLevels[ancestorLevels.length - 1], hasTimeLeft)) {
        contextBuildHandle = requestIdleCallback(buildContextSlice, { timeout: CONTEXT_BUILD_TIMEOUT_MS });
      }
    }

    // Draw the parent around the live level over the next idle moments, from the top of the stack
    function scheduleContextBuild() {
      cancelContextBuild();
      contextBuildHandle = requestIdleCallback(buildContextSlice, { timeout: CONTEXT_BUILD_TIMEOUT_MS });
    }

    // Draw the parent again from the changed copy the host put on top of the stack
    function rebuildContext() {
      isContextStale = false;
      levels.renderContext(ancestorLevels[ancestorLevels.length - 1]);
    }

    // Build both levels again from their data, the parent from the top of the stack
    function rebuildLevels() {
      isRebuildPending = false;
      onBeforeRebuild();
      const hasContext = levels.contextLevel() !== null;
      levels.clearContext();
      const live = levels.liveLevel();
      levels.renderLive(live.data, live.crumbs);
      if (hasContext) {
        rebuildContext();
      }
    }

    // Keep the level a descent leaves as the parent of the one it opens
    function pushLevel(data) {
      cancelContextBuild();
      isContextStale = false;
      ancestorLevels.push(data);
    }

    // Drop the parent an ascent made live, and draw the level above it at the next idle moment
    function popLevel() {
      cancelContextBuild();
      isContextStale = false;
      ancestorLevels.pop();
      scheduleContextBuild();
    }

    // Show a level the host sent for another folder, starting the stack again from its parent
    function showLevel(data, crumbs, parentData) {
      cancelContextBuild();
      isContextStale = false;
      isRebuildPending = false;
      onBeforeRebuild();

      levels.clearContext();
      levels.renderLive(data, crumbs);
      ancestorLevels = parentData ? [parentData] : [];
      if (parentData) {
        levels.renderContext(parentData);
      }
    }

    // Take the host's copy of the parent level as the top of the stack, redrawing the parent only where it changed
    function takeParent(data, isAtRest) {
      const context = levels.contextLevel();
      if (context && context.data.folder === data.folder && levels.canAdoptContext(data)) {
        levels.adoptContext(data);
        return;
      }

      ancestorLevels[Math.max(0, ancestorLevels.length - 1)] = data;
      if (!context) {
        scheduleContextBuild();
      } else if (isAtRest) {
        rebuildContext();
      } else {
        isContextStale = true;
      }
    }

    // Rebuild both levels for the new edit mode, now if the view is still, otherwise once it stops.
    // Returns true when it rebuilt them now
    function rebuildAtRest(isAtRest) {
      if (!isAtRest) {
        isRebuildPending = true;
        return false;
      }

      rebuildLevels();
      return true;
    }

    // Catch up on the rebuilds that waited for the view to come to rest
    function catchUpAtRest() {
      if (isRebuildPending) {
        rebuildLevels();
      } else if (isContextStale) {
        rebuildContext();
      }
    }

    return { pushLevel, popLevel, showLevel, takeParent, rebuildAtRest, catchUpAtRest };
  }

  window.PromptStudioAncestors = { create };
})();
