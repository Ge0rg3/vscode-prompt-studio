// Fills the settings page from the host state and posts each choice back
(function () {
  const vscode = acquireVsCodeApi();

  const noteViewEl = document.getElementById('note-view');
  const vaultRootEl = document.getElementById('vault-root');
  const modeButtons = document.querySelectorAll('#vault-modes .choice');

  // Show the vault folder, or say there is none
  function renderVaultRoot(root) {
    vaultRootEl.textContent = root || 'No vault yet. Open a folder, or pick one below.';
    vaultRootEl.classList.toggle('unset', !root);
  }

  // Mark the saved choice and grey out what an empty window cannot offer
  function renderVaultModes(mode, hasWorkspace) {
    for (const modeButton of modeButtons) {
      const isCurrent = modeButton.dataset.mode === mode;
      const mark = modeButton.querySelector('.choice-mark');
      modeButton.classList.toggle('current', isCurrent);
      mark.className = `choice-mark codicon codicon-circle-${isCurrent ? 'filled' : 'outline'}`;
      modeButton.disabled = !hasWorkspace && modeButton.dataset.mode !== 'custom';
    }
  }

  noteViewEl.addEventListener('change', () => {
    vscode.postMessage({ type: 'setNoteView', view: noteViewEl.value });
  });

  // Send the row on every click, since picking the folder again is a real choice
  for (const modeButton of modeButtons) {
    modeButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'setVaultMode', mode: modeButton.dataset.mode });
    });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }

    noteViewEl.value = message.noteView;
    renderVaultRoot(message.vaultRoot);
    renderVaultModes(message.vaultMode, message.hasWorkspace);
  });

  vscode.postMessage({ type: 'ready' });
})();
