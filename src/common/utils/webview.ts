import * as fs from 'node:fs';

import * as vscode from 'vscode';

// --- helpers ---

// substitute {{key}} tokens with their values
function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

// 32-char alphanumeric nonce for the webview CSP
function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

// the content-security policy shared by every bundled webview
function buildCsp(webview: vscode.Webview, nonce: string, styleNonce: boolean): string {
  const styleSrc = styleNonce
    ? `style-src ${webview.cspSource} 'nonce-${nonce}'`
    : `style-src ${webview.cspSource}`;
  return [`default-src 'none'`, styleSrc, `font-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`].join('; ');
}

// --- exports ---

// a webview-safe uri for a bundled media asset
export function assetUri(webview: vscode.Webview, extensionUri: vscode.Uri, relativePath: string): string {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, relativePath)).toString();
}

// fill a bundled template with a fresh nonce, the CSP, and the caller's values
export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  templatePath: string,
  replacements: Record<string, string>,
  styleNonce = false
): string {
  const nonce = randomNonce();
  const template = fs.readFileSync(vscode.Uri.joinPath(extensionUri, templatePath).fsPath, 'utf8');
  return fillTemplate(template, { csp: buildCsp(webview, nonce, styleNonce), nonce, ...replacements });
}

// the string at key in a restored webview-panel state
export function readStringField(state: unknown, key: string): string | undefined {
  if (state && typeof state === 'object' && typeof (state as Record<string, unknown>)[key] === 'string') {
    return (state as Record<string, string>)[key];
  }
  return undefined;
}

// the boolean at key in a restored webview-panel state
export function readBooleanField(state: unknown, key: string): boolean | undefined {
  if (state && typeof state === 'object' && typeof (state as Record<string, unknown>)[key] === 'boolean') {
    return (state as Record<string, boolean>)[key];
  }
  return undefined;
}
