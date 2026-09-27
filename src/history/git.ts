// Finds the git binary and runs it on a repository with the user's own git config shut out
import { execFile, ExecFileException } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { isWithin } from '../common/utils/paths';
import { delay } from '../common/utils/time';

// The output of one git run
export interface GitResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

// The part of the built-in git extension's API read here
interface GitApi {
  git: { path: string };
}

// The built-in git extension's exports, typed by hand since it ships no types
interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

// Give snapshots an author, and override the global settings an older git still reads,
// since they can sign a snapshot, skip notes, or change git's output
const CONFIG_OVERRIDES = [
  'user.name=Prompt Studio',
  'user.email=history@prompt-studio.local',
  'commit.gpgSign=false',
  'core.autocrlf=false',
  'core.excludesFile=/dev/null',
  'core.fsmonitor=false',
  'core.quotePath=false',
  'color.ui=false'
] as const;

// Leave room to read a large note back in one go
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

// The exit code given when git never started
const SPAWN_FAILED_EXIT_CODE = -1;

// Wait up to about two seconds for another window to release its lock
const LOCK_RETRIES = 20;
const LOCK_RETRY_MS = 100;

// Treat a lock this old as left behind by a git that crashed
const STALE_LOCK_MS = 60_000;

// Pull the lock file's path out of git's "Unable to create '<path>.lock'" message
const LOCK_PATH = /'([^']+\.lock)'/;

// --- helpers ---

// Copy the environment minus every GIT_ variable, then shut out the user's config
function buildIsolatedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) {
      env[key] = value;
    }
  }

  // Skip the global and system config, git reads /dev/null as an empty file even on Windows
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';

  // Never wait on a prompt, and keep git's messages in English so the lock check can read them
  env.GIT_TERMINAL_PROMPT = '0';
  env.LC_ALL = 'C';
  return env;
}

// Read the exit code off a failed run, a string code means git never started
function exitCodeOf(error: ExecFileException | null): number {
  if (!error) {
    return 0;
  }
  return typeof error.code === 'number' ? error.code : SPAWN_FAILED_EXIT_CODE;
}

// Run git and collect its output, resolving with the exit code instead of throwing on a failure
function execGit(gitPath: string, args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      gitPath,
      args,
      { cwd, env: buildIsolatedEnv(), encoding: 'buffer', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => resolve({ exitCode: exitCodeOf(error), stdout, stderr: stderr.toString('utf8') })
    );
  });
}

// Ask VSCode's git extension which git it runs, undefined when it found none and its API throws
async function findGitFromExtension(extension: vscode.Extension<GitExtensionExports>): Promise<string | undefined> {
  try {
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports.getAPI(1).git.path;
  } catch {
    return undefined;
  }
}

// Build the arguments that point git at the repository and keep the user's config and hooks out of it
function buildGlobalArgs(gitDir: string, workTree: string | undefined): string[] {
  const globalArgs: string[] = [];
  for (const setting of CONFIG_OVERRIDES) {
    globalArgs.push('-c', setting);
  }

  // Point hooks at a folder that never exists to keep the user's hooks from running
  globalArgs.push('-c', `core.hooksPath=${path.join(gitDir, 'hooks')}`, `--git-dir=${gitDir}`);
  if (workTree) {
    globalArgs.push(`--work-tree=${workTree}`);
  }
  return globalArgs;
}

function isLocked(result: GitResult): boolean {
  return result.exitCode !== 0 && LOCK_PATH.test(result.stderr);
}

// Delete the lock git named, as long as it sits in the repository and nothing has touched it for a while
async function removeStaleLock(stderr: string, gitDir: string): Promise<boolean> {
  const lockPath = LOCK_PATH.exec(stderr)?.[1];
  if (!lockPath || !isWithin(path.resolve(lockPath), gitDir)) {
    return false;
  }

  try {
    const lockStats = await stat(lockPath);
    if (Date.now() - lockStats.mtimeMs < STALE_LOCK_MS) {
      return false;
    }
    await rm(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

// --- exports ---

// Find git the way VSCode's own git support does, or on PATH when that support is turned off
export async function findGit(): Promise<string | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  const isGitSupportOn = vscode.workspace.getConfiguration('git').get<boolean>('enabled') !== false;

  // Trust VSCode when it finds no git, since running a missing git on macOS offers to install Xcode
  const candidate = extension && isGitSupportOn ? await findGitFromExtension(extension) : 'git';
  if (!candidate) {
    return undefined;
  }

  const version = await execGit(candidate, ['--version'], homedir());
  return version.exitCode === 0 ? candidate : undefined;
}

// Run git on the repository in gitDir, with the vault as its working folder when one is given
export async function runGit(
  gitPath: string,
  gitDir: string,
  workTree: string | undefined,
  args: readonly string[]
): Promise<GitResult> {
  const fullArgs = [...buildGlobalArgs(gitDir, workTree), ...args];
  const cwd = workTree ?? path.dirname(gitDir);

  // Wait out a lock another window holds
  let result = await execGit(gitPath, fullArgs, cwd);
  for (let attempt = 0; attempt < LOCK_RETRIES && isLocked(result); attempt++) {
    await delay(LOCK_RETRY_MS);
    result = await execGit(gitPath, fullArgs, cwd);
  }

  // Clear a lock a crashed git left behind, then try once more
  if (isLocked(result) && (await removeStaleLock(result.stderr, gitDir))) {
    result = await execGit(gitPath, fullArgs, cwd);
  }
  return result;
}
