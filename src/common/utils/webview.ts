// Renders webview HTML from the bundled templates and reads restored panel state
import * as fs from 'node:fs';

import * as vscode from 'vscode';

// --- helpers ---

// Substitute {{key}} tokens with their values
function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

// Build a 32-character nonce for the webview security policy
function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

// Build the content security policy, adding a style nonce for a webview that writes its own styles
function buildCsp(webview: vscode.Webview, nonce: string, styleNonce: boolean): string {
  const styleSrc = styleNonce
    ? `style-src ${webview.cspSource} 'nonce-${nonce}'`
    : `style-src ${webview.cspSource}`;
  return [
    `default-src 'none'`,
    styleSrc,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`
  ].join('; ');
}

// --- exports ---

// Turn a bundled media path into a uri the webview can load
export function assetUri(webview: vscode.Webview, extensionUri: vscode.Uri, relativePath: string): string {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, relativePath)).toString();
}

// Fill a bundled template with a fresh nonce, the security policy, and the caller's values
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

// Read a string field out of a restored panel state
export function readStringField(state: unknown, key: string): string | undefined {
  if (state && typeof state === 'object' && typeof (state as Record<string, unknown>)[key] === 'string') {
    return (state as Record<string, string>)[key];
  }
  return undefined;
}

// Read a boolean field out of a restored panel state
export function readBooleanField(state: unknown, key: string): boolean | undefined {
  if (state && typeof state === 'object' && typeof (state as Record<string, unknown>)[key] === 'boolean') {
    return (state as Record<string, boolean>)[key];
  }
  return undefined;
}
