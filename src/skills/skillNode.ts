// The row shapes the skills tree passes between the host and its webview.
export interface SkillRef {
  name: string;
  skillFile: string;
  description?: string;
}

// one row in the skills webview tree
export type SkillTreeNode =
  | { kind: 'project'; name: string; absPath: string; skillsDir?: string; children: SkillTreeNode[] }
  | { kind: 'skill'; name: string; absPath: string; skill: SkillRef; color?: string; children: SkillTreeNode[] }
  | { kind: 'file'; name: string; absPath: string; color?: string }
  | { kind: 'folder'; name: string; absPath: string; color?: string; children: SkillTreeNode[] };

export type SkillNode = Extract<SkillTreeNode, { kind: 'skill' }>;
