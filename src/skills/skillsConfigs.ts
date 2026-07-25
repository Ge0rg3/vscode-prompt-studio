// Keeps the colors and layout config for each .claude/skills root in its own file
import * as vscode from 'vscode';

import { VaultConfig } from '../common/vaultConfig';
import { owningSkillsDir } from './skillScanner';

// One VaultConfig per .claude/skills root, created on demand and kept for the session
export class SkillsConfigs implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  // Never fires, a skills dir path never moves
  private readonly rootChangeEmitter = new vscode.EventEmitter<void>();
  private readonly configs = new Map<string, VaultConfig>();
  private readonly configSubs: vscode.Disposable[] = [];

  readonly onDidChange: vscode.Event<void> = this.changeEmitter.event;

  // Get the config for the skills root a path sits in, or for that root itself
  configFor(absPath: string): VaultConfig | undefined {
    const skillsDir = owningSkillsDir(absPath);
    if (!skillsDir) {
      return undefined;
    }

    let config = this.configs.get(skillsDir);
    if (!config) {
      config = new VaultConfig(() => skillsDir, this.rootChangeEmitter.event);
      this.configSubs.push(config.onDidChange(() => this.changeEmitter.fire()));
      this.configs.set(skillsDir, config);
    }
    return config;
  }

  dispose(): void {
    for (const sub of this.configSubs) {
      sub.dispose();
    }
    for (const config of this.configs.values()) {
      config.dispose();
    }
    this.configs.clear();
    this.rootChangeEmitter.dispose();
    this.changeEmitter.dispose();
  }
}
