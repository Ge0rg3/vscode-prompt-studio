// Builds the label, icon, and message for the other way to open a note
(function () {
  // What a webview shows before the host says which view the setting names
  const INITIAL_NOTE_VIEW = 'template';

  function alternateOpen(view, node) {
    if (view === 'file') {
      return {
        label: 'Open as Template',
        icon: 'files',
        message: { type: 'command', command: 'promptStudio.openTemplate', node }
      };
    }

    return {
      label: 'Open as File',
      icon: 'file-code',
      message: { type: 'openFile', path: node.absPath }
    };
  }

  window.PromptStudioNoteOpen = { alternateOpen, INITIAL_NOTE_VIEW };
})();
