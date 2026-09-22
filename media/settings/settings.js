// Fills the settings page from the host state and posts each choice back
(function () {
  const vscode = acquireVsCodeApi();

  const noteViewEl = document.getElementById('note-view');
  const projectVaultRootEl = document.getElementById('project-vault-root');
  const globalVaultRootEl = document.getElementById('global-vault-root');
  const projectVaultModeButtons = document.querySelectorAll('#project-vault-modes .choice');
  const globalVaultModeButtons = document.querySelectorAll('#global-vault-modes .choice');

  // Show a vault folder, or say there is none
  function renderVaultRoot(rootEl, root) {
    rootEl.textContent = root || 'No vault yet. Open a folder, or pick one below.';
    rootEl.classList.toggle('unset', !root);
  }

  // Mark the saved choice in a row of buttons
  function markCurrentMode(buttons, mode) {
    for (const modeButton of buttons) {
      const isCurrent = modeButton.dataset.mode === mode;
      const mark = modeButton.querySelector('.choice-mark');
      modeButton.classList.toggle('current', isCurrent);
      mark.className = `choice-mark codicon codicon-circle-${isCurrent ? 'filled' : 'outline'}`;
    }
  }

  // Grey out the project choices an empty window cannot offer
  function renderWorkspaceChoices(hasWorkspace) {
    for (const modeButton of projectVaultModeButtons) {
      modeButton.disabled = !hasWorkspace && modeButton.dataset.mode !== 'custom';
    }
  }

  // Post every click, even on the current choice, since picking the folder again is a real choice
  function bindModeButtons(buttons, messageType) {
    for (const modeButton of buttons) {
      modeButton.addEventListener('click', () => {
        vscode.postMessage({ type: messageType, mode: modeButton.dataset.mode });
      });
    }
  }

  noteViewEl.addEventListener('change', () => {
    vscode.postMessage({ type: 'setNoteView', view: noteViewEl.value });
  });

  bindModeButtons(projectVaultModeButtons, 'setProjectVaultMode');
  bindModeButtons(globalVaultModeButtons, 'setGlobalVaultMode');

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }

    noteViewEl.value = message.noteView;
    renderVaultRoot(projectVaultRootEl, message.projectVaultRoot);
    renderVaultRoot(globalVaultRootEl, message.globalVaultRoot);
    markCurrentMode(projectVaultModeButtons, message.projectVaultMode);
    markCurrentMode(globalVaultModeButtons, message.globalVaultMode);
    renderWorkspaceChoices(message.hasWorkspace);
  });

  vscode.postMessage({ type: 'ready' });
})();
