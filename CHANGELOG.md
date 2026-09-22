# Changelog

## 0.4.0

- A globe button in the Vault and Claude Skills title bars swaps both sidebars to a global vault shared by every project, and to your own `~/.claude/skills`. The home button swaps back.
- A `promptStudio.globalVaultLocation` setting, also on the settings page, picks where the global vault lives.

## 0.3.2

- A new note opens in the default note view, so it starts as a blank template when the template editor is the default.

## 0.3.1

- The `@` mention list no longer drops files in large workspaces, untracked ones included. It leaves out Python virtual environments, tool caches, and bare git repos to make room.
- A mention of a file the list leaves out, such as one in `node_modules`, still turns blue and opens with ctrl+click.

## 0.3.0

- The canvas pans and zooms. Drag the background or hold the middle button to pan, ctrl+wheel or the bottom bar to zoom, and **Fit** to frame every card.
- Zooming into a folder card opens it as its own canvas, and zooming back out returns to the parent.
- Note cards take text directly while **Edit** is on in the bottom bar, saved back to the note as you type.
- A canvas comes back to the folder, the view, and the edit mode it was left at after a window reload.

## 0.2.1

- Refreshed the README screenshots and the demo vault behind them.

## 0.2.0

- A `promptStudio.defaultNoteView` setting picking whether a note opens in the template editor or as raw markdown. The view you skip sits on the row's hover button and in the right-click menu.
- A settings page behind the Vault title-bar gear, holding that setting and the vault location. It replaces **Prompt Studio: Configure Vault**.

## 0.1.0

First public release.

- A vault of plain `.md` files, created for you when a workspace opens. Move it with **Prompt Studio: Configure Vault**.
- A sidebar tree with color swatches, inline rename, drag-moves, copy and paste, and right-click menus on rows and on empty space.
- A visual canvas that opens any folder as a pinboard of cards you can drag, resize, and tint. The layout saves to `config.yml`.
- A template editor that styles markdown as you type while leaving the text exactly as you wrote it. It carries attachments, find and replace, and `@` mentions that resolve against the workspace.
- A **Claude Skills** sidebar listing every `.claude/skills` folder in the workspace and its sub-projects.
- **Send to Claude** on notes, skills, and the template editor, with images attached.
