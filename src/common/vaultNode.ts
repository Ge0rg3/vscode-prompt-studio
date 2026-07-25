// One vault entry, a folder or a note with its absolute path and name
export interface VaultNode {
  kind: 'folder' | 'note';
  absPath: string;
  name: string;
}
