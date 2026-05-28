export type VaultNodeKind = 'folder' | 'note';

export interface VaultNode {
  kind: VaultNodeKind;
  absPath: string;
  name: string;
}
