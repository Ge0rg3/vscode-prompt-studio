import * as vscode from 'vscode';

export interface NotePosition {
  x: number;
  y: number;
}

export interface CardSize {
  width: number;
  height: number;
}

// one store per visual canvas
export interface CardLayoutStore {
  readonly onDidChange: vscode.Event<void>;
  getPosition(absPath: string): NotePosition | undefined;
  setPosition(absPath: string, position: NotePosition): void;
  getSize(absPath: string): CardSize | undefined;
  setSize(absPath: string, size: CardSize): void;
  getZ(absPath: string): number | undefined;
  setZ(absPath: string, z: number): void;
  getColor(absPath: string): string | undefined;
  setColor(absPath: string, color: string | undefined): void;
}
