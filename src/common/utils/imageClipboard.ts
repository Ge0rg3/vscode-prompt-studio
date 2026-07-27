// Puts an image on the system clipboard, since the VSCode api carries text alone
import { execFile, spawn } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

import * as vscode from 'vscode';

const runCommand = promisify(execFile);

const WSL_REMOTE = 'wsl';

// What a format is called on the clipboard, with no apple class when AppleScript cannot read it
interface ClipboardFormat {
  mime: string;
  appleClass?: string;
}

const CLIPBOARD_FORMATS: ReadonlyMap<string, ClipboardFormat> = new Map([
  ['.png', { mime: 'image/png', appleClass: 'PNGf' }],
  ['.jpg', { mime: 'image/jpeg', appleClass: 'JPEG' }],
  ['.jpeg', { mime: 'image/jpeg', appleClass: 'JPEG' }],
  ['.gif', { mime: 'image/gif', appleClass: 'GIFf' }],
  ['.webp', { mime: 'image/webp' }]
]);

// --- helpers ---

// Feed the file to a command that reads the image on its input
function pipeFile(command: string, args: string[], bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
    child.stdin.end(bytes);
  });
}

// Name the file the way Windows sees it, since the extension host can be running in WSL
async function windowsPath(absPath: string): Promise<string> {
  if (process.platform === 'win32') {
    return absPath;
  }

  const { stdout } = await runCommand('wslpath', ['-w', absPath]);
  return stdout.trim();
}

// Copy the file itself, so the paste carries the picture rather than a screenshot of it
async function copyOnWindows(absPath: string): Promise<void> {
  const target = (await windowsPath(absPath)).replace(/'/g, "''");
  await runCommand('powershell.exe', ['-NoProfile', '-Command', `Set-Clipboard -LiteralPath '${target}'`]);
}

// Read the file into the clipboard as a picture of its own format
async function copyOnMac(absPath: string, appleClass: string): Promise<void> {
  const quoted = absPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `set the clipboard to (read (POSIX file "${quoted}") as \u00abclass ${appleClass}\u00bb)`;
  await runCommand('osascript', ['-e', script]);
}

// Hand the bytes to whichever clipboard tool the session runs
async function copyOnLinux(absPath: string, mime: string): Promise<void> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));

  if (process.env.WAYLAND_DISPLAY) {
    await pipeFile('wl-copy', ['--type', mime], bytes);
    return;
  }

  await pipeFile('xclip', ['-selection', 'clipboard', '-t', mime], bytes);
}

// --- exports ---

// Put the image on the clipboard, false when this machine has no tool that can
export async function copyImageToClipboard(absPath: string): Promise<boolean> {
  const format = CLIPBOARD_FORMATS.get(path.extname(absPath).toLowerCase());
  if (!format) {
    return false;
  }

  // A remote host keeps its own clipboard, while the chat input reads the one at the keyboard
  if (vscode.env.remoteName !== undefined && vscode.env.remoteName !== WSL_REMOTE) {
    return false;
  }

  try {
    if (process.platform === 'win32' || vscode.env.remoteName === WSL_REMOTE) {
      await copyOnWindows(absPath);
    } else if (process.platform === 'darwin') {
      if (!format.appleClass) {
        return false;
      }
      await copyOnMac(absPath, format.appleClass);
    } else {
      await copyOnLinux(absPath, format.mime);
    }
    return true;
  } catch {
    return false;
  }
}
