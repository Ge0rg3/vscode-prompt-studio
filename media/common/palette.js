// shared palette-class helper for the sidebar and canvas webviews
(function () {
  // set an element's tint classes, clearing any previous one
  function applyTint(element, color, baseClass) {
    for (const cls of [...element.classList]) {
      if (cls === baseClass || cls.startsWith('color-')) {
        element.classList.remove(cls);
      }
    }
    if (color) {
      element.classList.add(baseClass, 'color-' + color);
    }
  }

  window.PromptStudioPalette = { applyTint };
})();
