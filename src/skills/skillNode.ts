// The rows in the skills tree, a project, a skill, and the files and folders under one
export interface SkillRef {
  name: string;
  skillFile: string;
  description?: string;
}

export type SkillTreeNode =
  | { kind: 'project'; name: string; absPath: string; skillsDir?: string; children: SkillTreeNode[] }
  | { kind: 'skill'; name: string; absPath: string; skill: SkillRef; color?: string; children: SkillTreeNode[] }
  | { kind: 'file'; name: string; absPath: string; color?: string }
  | { kind: 'folder'; name: string; absPath: string; color?: string; children: SkillTreeNode[] };

export type SkillNode = Extract<SkillTreeNode, { kind: 'skill' }>;
