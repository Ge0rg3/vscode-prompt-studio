// substitute simple {{key}} tokens, all values are extension-controlled
export function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

// 32-char alphanumeric nonce for the webview CSP
export function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
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
