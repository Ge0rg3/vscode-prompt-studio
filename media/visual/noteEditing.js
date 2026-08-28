// Holds the text fields on the note cards and writes what is typed back to disk
(function () {
  const SAVE_DEBOUNCE_MS = 400;

  // Build the controller that owns every card field, writing through saveNote(path, text)
  function create(saveNote, onFieldBlur) {
    const unsavedText = new Map();
    let editingPath = null;
    let saveTimer;

    // Write every edited note back
    function flush() {
      clearTimeout(saveTimer);
      for (const [absPath, text] of unsavedText) {
        saveNote(absPath, text);
      }
      unsavedText.clear();
    }

    // Hold what was typed and write it back once the typing stops
    function queueSave(absPath, text) {
      unsavedText.set(absPath, text);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    }

    // Build the field that edits one card's raw note
    function buildField(card) {
      const field = document.createElement('textarea');
      field.className = 'note-text';
      field.spellcheck = false;
      field.value = card.text || '';

      // VSCode forces its own font onto form controls, so this one has to be set inline
      field.style.setProperty('font-family', 'var(--vscode-editor-font-family, monospace), Menlo, Consolas, monospace', 'important');

      field.addEventListener('input', () => {
        card.text = field.value;
        queueSave(card.absPath, field.value);
      });
      field.addEventListener('focus', () => {
        editingPath = card.absPath;
      });
      field.addEventListener('blur', () => {
        editingPath = null;
        flush();
        onFieldBlur();
      });

      // Scroll the text the wheel is over rather than the canvas under it, while ctrl still zooms
      field.addEventListener('wheel', (event) => {
        if (!event.ctrlKey && !event.metaKey && field.scrollHeight > field.clientHeight) {
          event.stopPropagation();
        }
      });
      return field;
    }

    function isEditing() {
      return editingPath !== null;
    }

    // Removing a focused field fires no blur, so the redraw clears the editing path itself
    function onCardsReplaced() {
      editingPath = null;
    }

    return { buildField, flush, isEditing, onCardsReplaced };
  }

  window.PromptStudioNoteEditing = { create };
})();
