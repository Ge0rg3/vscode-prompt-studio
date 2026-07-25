// Tints an element with one of the shared palette colors, clearing any previous tint
(function () {
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
