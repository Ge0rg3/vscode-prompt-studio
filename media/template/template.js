(function () {
  const vscode = acquireVsCodeApi();

  const editor = document.getElementById('editor');
  const editorWrap = document.getElementById('editor-wrap');
  const gutterLines = document.getElementById('gutter-lines');
  const preview = document.getElementById('preview');
  const toggle = document.getElementById('toggle');
  const toggleIcon = document.getElementById('toggle-icon');
  const toggleLabel = document.getElementById('toggle-label');
  const copy = document.getElementById('copy');
  const send = document.getElementById('send');

  let lineCount = 0;

  // --- editor style ---

  // append a generic monospace fallback when the family lacks one
  function ensureMonospace(family) {
    return /\bmonospace\b/i.test(family) ? family : family + ', monospace';
  }

  // mirror the editor font and spacing onto the textarea and gutter
  function applyEditorStyle(style) {
    const fontFamily = ensureMonospace(style.fontFamily);
    for (const el of [editor, gutterLines]) {
      el.style.setProperty('font-family', fontFamily, 'important');
      el.style.setProperty('font-size', style.fontSize + 'px', 'important');
      el.style.setProperty('line-height', style.lineHeight + 'px', 'important');
    }
    editor.style.setProperty('font-weight', style.fontWeight, 'important');
    editor.style.setProperty('tab-size', String(style.tabSize));
  }

  // --- line-number gutter ---

  // redraw the gutter whenever the line count changes
  function syncGutter() {
    const count = editor.value.split('\n').length;
    if (count === lineCount) return;
    lineCount = count;
    const rows = [];
    for (let n = 1; n <= count; n++) {
      rows.push('<div class="ln">' + n + '</div>');
    }
    gutterLines.innerHTML = rows.join('');
  }

  // keep the gutter aligned with the textarea's vertical scroll
  function syncGutterScroll() {
    gutterLines.style.transform = 'translateY(' + -editor.scrollTop + 'px)';
  }

  // --- view modes ---

  // show the editable text, hide the rendered preview
  function showEditor() {
    preview.classList.add('hidden');
    editorWrap.classList.remove('hidden');
    toggleIcon.className = 'codicon codicon-preview';
    toggleLabel.textContent = 'Preview';
    editor.focus();
  }

  // show the rendered markdown, hide the editor
  function showPreview(html) {
    preview.innerHTML = html;
    editorWrap.classList.add('hidden');
    preview.classList.remove('hidden');
    toggleIcon.className = 'codicon codicon-edit';
    toggleLabel.textContent = 'Edit';
  }

  // true while the rendered preview is showing
  function isPreviewing() {
    return !preview.classList.contains('hidden');
  }

  // --- inbound messages ---

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'content') {
      vscode.setState({ notePath: msg.notePath, claudeCommand: msg.claudeCommand });
      applyEditorStyle(msg.style);
      editor.value = msg.text;
      lineCount = 0;
      syncGutter();
      syncGutterScroll();
      vscode.postMessage({ type: 'render', text: editor.value });
    } else if (msg.type === 'rendered') {
      showPreview(msg.html);
    }
  });

  // --- editing ---

  editor.addEventListener('input', syncGutter);
  editor.addEventListener('scroll', syncGutterScroll);

  // --- toolbar ---

  toggle.addEventListener('click', () => {
    if (isPreviewing()) {
      showEditor();
    } else {
      vscode.postMessage({ type: 'render', text: editor.value });
    }
  });

  copy.addEventListener('click', () => {
    vscode.postMessage({ type: 'copy', text: editor.value });
  });

  send.addEventListener('click', () => {
    vscode.postMessage({ type: 'sendToClaude', text: editor.value });
  });

  vscode.postMessage({ type: 'ready' });
})();
