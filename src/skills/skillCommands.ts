// The commands behind the skill rows and the skills view title bar.
import * as path from 'node:path';

import * as vscode from 'vscode';
import { stringify } from 'yaml';

import { ColorPreview } from '../common/cardColors';
import { sendTextToClaude } from '../common/sendToClaude';
import { pathExists } from '../common/utils/fs';
import { MentionIndex } from '../template/mentionIndex';
import { TemplatePanel } from '../template/templatePanel';
import { validateEntryName } from '../vault/entryName';
import { CanvasContext, VisualPanel } from '../visual/visualPanel';
import { SkillNode, SkillTreeNode } from './skillNode';
import { scanSkills, SKILL_FILE, skillsRoot } from './skillScanner';
import { SkillsConfigs } from './skillsConfigs';
import { SkillsWebviewProvider } from './skillsWebviewProvider';

export class SkillCommands {
  constructor(
    private readonly provider: SkillsWebviewProvider,
    private readonly extensionUri: vscode.Uri,
    private readonly skillsConfigs: SkillsConfigs,
    private readonly colorPreviewEmitter: vscode.EventEmitter<ColorPreview>,
    private readonly mentionIndex: MentionIndex
  ) {}

  // the skill row and empty-area action commands
  register(): vscode.Disposable {
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

        TemplatePanel.show(this.extensionUri, this.mentionIndex, target.skill.skillFile, this.slashCommand(target));
      }),

      vscode.commands.registerCommand('promptStudio.openSkillVisual', (target?: SkillTreeNode) => {
        if (target?.kind !== 'skill') {
          return;
        }

        const canvasContext = this.skillCanvasContext(target.absPath);
        if (canvasContext) {
          VisualPanel.show(this.extensionUri, canvasContext, target.absPath);
        }
      }),

      vscode.commands.registerCommand('promptStudio.sendSkillToClaude', async (target?: SkillTreeNode) => {
        if (target?.kind !== 'skill') {
          return;
        }

        await sendTextToClaude(this.slashCommand(target));
      }),

      vscode.commands.registerCommand('promptStudio.newSkill', (target?: SkillTreeNode) =>
        this.createSkill(target?.kind === 'project' ? target.skillsDir : undefined)
      ),
      vscode.commands.registerCommand('promptStudio.openSkillsCanvas', () => this.openSkillsCanvas())
    );
  }

  // the view title-bar commands
  registerViewCommands(): vscode.Disposable {
    return vscode.Disposable.from(
      vscode.commands.registerCommand('promptStudio.refreshSkills', () => this.provider.refresh()),
      vscode.commands.registerCommand('promptStudio.expandAllSkills', () => this.provider.expandAll()),
      vscode.commands.registerCommand('promptStudio.collapseAllSkills', () => this.provider.collapseAll())
    );
  }

  // prompt for a name and create the skill folder, defaulting to the workspace skills root
  private async createSkill(skillsDir?: string): Promise<void> {
    const root = skillsDir ?? skillsRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Prompt Studio: open a folder to create a skill.');
      return;
    }

    // Ask for a name
    const input = await vscode.window.showInputBox({
      title: 'New skill',
      prompt: 'Skill name',
      value: 'my-skill',
      validateInput: validateEntryName
    });
    if (!input) {
      return;
    }

    // Refuse a name already in use
    const name = input.trim();
    const dir = vscode.Uri.file(path.join(root, name));
    if (await pathExists(dir)) {
      void vscode.window.showErrorMessage(`A skill named "${name}" already exists.`);
      return;
    }

    // Write the SKILL.md and open it
    const skillFile = vscode.Uri.file(path.join(root, name, SKILL_FILE));
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(skillFile, new TextEncoder().encode(this.skillScaffold(name)));
    await vscode.commands.executeCommand('vscode.open', skillFile);
    await this.provider.refresh();
  }

  // open the skills root as a read-only canvas
  private async openSkillsCanvas(): Promise<void> {
    const root = skillsRoot();
    if (!root || (await scanSkills(root)).length === 0) {
      void vscode.window.showWarningMessage('Prompt Studio: no Claude skills found.');
      return;
    }

    const canvasContext = this.skillCanvasContext(root);
    if (canvasContext) {
      VisualPanel.show(this.extensionUri, canvasContext, root);
    }
  }

  // a read-only canvas context over a skill folder
  private skillCanvasContext(root: string): CanvasContext | undefined {
    const store = this.skillsConfigs.configFor(root);
    if (!store) {
      return undefined;
    }
    return { store, root, allowCrud: false, colorPreviewEmitter: this.colorPreviewEmitter };
  }

  // the slash command that invokes a skill in Claude Code
  private slashCommand(node: SkillNode): string {
    return `/${node.skill.name}`;
  }

  // a starter SKILL.md, yaml quotes the name safely
  private skillScaffold(name: string): string {
    const frontmatter = stringify({
      name,
      description: 'Describe what this skill does and when to use it.'
    });
    return `---\n${frontmatter}---\n\n# ${name}\n\n`;
  }
}
