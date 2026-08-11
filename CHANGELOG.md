# Changelog

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
