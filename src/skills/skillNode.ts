export interface SkillRef {
  name: string;
  skillFile: string;
  description?: string;
}

// one row in the skills webview tree
export type SkillTreeNode =
  | { kind: 'skill'; name: string; absPath: string; skill: SkillRef; children: SkillTreeNode[] }
  | { kind: 'file'; name: string; absPath: string }
  | { kind: 'folder'; name: string; absPath: string; children: SkillTreeNode[] };

export type SkillNode = Extract<SkillTreeNode, { kind: 'skill' }>;
