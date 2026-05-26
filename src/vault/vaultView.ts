import * as vscode from 'vscode';

// HTML body for the sidebar webview
function renderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>Prompt Studio</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 12px;
    }
  </style>
</head>
<body>
  <p>prompt studio</p>
</body>
</html>`;
}

export class VaultViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'promptStudio.vault';

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: false };
    view.webview.html = renderHtml();
  }
}
