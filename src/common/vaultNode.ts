export interface VaultNode {
  kind: 'folder' | 'note';
  absPath: string;
  name: string;
}
