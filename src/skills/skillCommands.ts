import * as path from 'node:path';

import * as vscode from 'vscode';
import { stringify } from 'yaml';

import { CardLayoutStore } from '../common/cardLayoutStore';
import { sendTextToClaude } from '../common/sendToClaude';
import { pathExists } from '../common/utils/fs';
import { validateEntryName } from '../vault/entryName';
import { TemplatePanel } from '../vault/templatePanel';
import { CanvasContext, VisualPanel } from '../visual/visualPanel';
import { SkillNode, SkillTreeNode } from './skillNode';
import { scanSkills, SKILL_FILE, skillsRoot } from './skillScanner';
import { SkillsWebviewProvider } from './skillsWebviewProvider';

// --- helpers ---

// the slash command that invokes a skill in Claude Code
function slashCommand(node: SkillNode): string {
  return `/${node.skill.name}`;
}

// a starter SKILL.md, yaml quotes the name safely
function skillScaffold(name: string): string {
  const frontmatter = stringify({
    name,
    description: 'Describe what this skill does and when to use it.'
  });
  return `---\n${frontmatter}---\n\n# ${name}\n\n`;
}

// prompt for a name and scaffold a new skill folder under the workspace .claude/skills
async function createSkill(provider: SkillsWebviewProvider): Promise<void> {
  const root = skillsRoot();
  if (!root) {
    void vscode.window.showWarningMessage('Prompt Studio: open a folder to create a skill.');
    return;
  }

  const input = await vscode.window.showInputBox({
    title: 'New skill',
    prompt: 'Skill name',
    value: 'my-skill',
    validateInput: validateEntryName
  });
  if (!input) {
    return;
  }

  const name = input.trim();
  const dir = vscode.Uri.file(path.join(root, name));
  if (await pathExists(dir)) {
    void vscode.window.showErrorMessage(`A skill named "${name}" already exists.`);
    return;
  }

  const skillFile = vscode.Uri.file(path.join(root, name, SKILL_FILE));
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(skillFile, new TextEncoder().encode(skillScaffold(name)));
  await vscode.commands.executeCommand('vscode.open', skillFile);
  await provider.refresh();
}

// open the skills root as a read-only canvas
async function openSkillsCanvas(extensionUri: vscode.Uri, skillStore: CardLayoutStore): Promise<void> {
  const root = skillsRoot();
  if (!root || (await scanSkills()).length === 0) {
    void vscode.window.showWarningMessage('Prompt Studio: no Claude skills found.');
    return;
  }

  const context: CanvasContext = { store: skillStore, root, allowCrud: false };
  VisualPanel.show(extensionUri, context, root);
}

// --- exports ---

export function registerSkillCommands(
  provider: SkillsWebviewProvider,
  extensionUri: vscode.Uri,
  skillStore: CardLayoutStore
): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('promptStudio.openSkill', async (target?: SkillTreeNode) => {
      if (target?.kind !== 'skill') {
        return;
      }

      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target.skill.skillFile));
    }),

    vscode.commands.registerCommand('promptStudio.openSkillTemplate', (target?: SkillTreeNode) => {
      if (target?.kind !== 'skill') {
        return;
      }

      TemplatePanel.show(extensionUri, target.skill.skillFile, slashCommand(target));
    }),

    vscode.commands.registerCommand('promptStudio.openSkillVisual', (target?: SkillTreeNode) => {
      if (target?.kind !== 'skill') {
        return;
      }

      const context: CanvasContext = { store: skillStore, root: target.absPath, allowCrud: false };
      VisualPanel.show(extensionUri, context, target.absPath);
    }),

    vscode.commands.registerCommand('promptStudio.sendSkillToClaude', async (target?: SkillTreeNode) => {
      if (target?.kind !== 'skill') {
        return;
      }

      await sendTextToClaude(slashCommand(target));
    }),

    vscode.commands.registerCommand('promptStudio.newSkill', () => createSkill(provider)),
    vscode.commands.registerCommand('promptStudio.openSkillsCanvas', () =>
      openSkillsCanvas(extensionUri, skillStore)
    )
  );
}

export function registerSkillViewCommands(provider: SkillsWebviewProvider): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('promptStudio.refreshSkills', () => provider.refresh()),
    vscode.commands.registerCommand('promptStudio.expandAllSkills', () => provider.expandAll()),
    vscode.commands.registerCommand('promptStudio.collapseAllSkills', () => provider.collapseAll())
  );
}
