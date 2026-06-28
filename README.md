# Prompt Studio

A VSCode extension that turns a folder of markdown files into an Obsidian-like vault for notes and reusable prompts.

## What it does

- **Vault.** Point it at any folder of `.md` files. Storage stays plain markdown on disk: portable, git-friendly, and readable without the extension.
- **Sidebar tree.** Browse, create, rename, delete, and drag-reorganize notes from a dedicated activity-bar panel.
- **Visual canvas.** Open any folder as a card canvas. Drag notes and folders to reposition them, OneNote style. Positions persist as entry metadata.
- **Wikilinks.** `[[Other Note]]` with completion, cmd-click navigation, hover preview, and rename refactoring.
- **Prompts.** Notes marked as prompts can declare `{{variables}}`. Pick a prompt, fill in the blanks, then copy to clipboard or insert into the active editor.

## Vault layout

A vault is a folder of `.md` files. Note bodies are pure markdown, no frontmatter, so a note can be pasted straight into an LLM without leaking metadata.

Per-entry metadata (type, tags, visual layout) lives in a single `config.yml` at the vault root. Notes and folders both get an entry, keyed by vault-relative path:

```yaml
notes:
  Welcome.md:
    tags:
      - intro
  prompts:
    visual:
      color: blue
  prompts/Refactor.md:
    type: prompt
    tags:
      - code
      - refactor
    visual:
      x: 200
      y: 100
      z: 3
      width: 280
      height: 200
      color: orange
```

The extension reads and writes the `visual` block (card position, size, stacking order, and color) today. Any other keys (`type`, `tags`) are left untouched when it rewrites the file.

## Status

Early development. The current build ships a sidebar vault view and a draggable visual canvas, both backed by a configurable folder location.

The sidebar is a webview styled to match the native tree, which lets it intercept right-clicks on empty space.

### Configure the vault

Open the activity-bar icon, click **Configure Vault** in the empty view (or run **Prompt Studio: Configure Vault** from the command palette), then pick one of three locations:

1. **Per-workspace default.** A vault is auto-created under the extension's global storage at `<extension storage>/<basename>-<hash>` (e.g. `myproject-a1b2c3d4`, derived from a short hash of the workspace path). Your project files stay untouched.
2. **Custom folder.** Any absolute path on disk.
3. **Folder inside this workspace.** A subfolder of the current workspace, e.g. `<workspace>/prompts`, so the vault is versioned alongside your code.

The path persists in the `promptStudio.vaultPath` setting (empty string means "per-workspace default").

### Create and organize notes

Once a vault is set:

- **Title-bar buttons.** The view header shows **New Note** and **New Folder** for creating entries, plus **Expand All** and **Collapse All** to toggle every folder in the tree at once. New entries land in the parent folder of the selected entry, or at the vault root when nothing is selected.
- **Right-click empty area.** Offers **New Note** and **New Folder** at the vault root, plus **Open as Canvas** (detailed under Visual canvas).
- **Right-click a folder.** Offers **New Note**, **New Folder**, **Rename**, **Reveal in Explorer**, **Copy as Path** (a submenu offering **Static**, the absolute path on disk, or **Relative**, the path relative to the vault root), and **Delete**, plus **Open as Canvas** (detailed under Visual canvas).
- **Right-click a note.** Offers **Open**, **Open as Template** (opens an editable copy in its own tab, detailed under Template view), **Send to Claude** (pastes the note into the Claude Code chat input), **Rename**, **Copy Contents** (copies the markdown body to the clipboard), **Reveal in Explorer**, **Copy as Path**, and **Delete**. Hovering a note row also shows quick **Open as Template** and **Send to Claude** buttons.
- **Drag and drop.** Drag any note or folder onto another folder row to move it. Drop onto the empty area to lift to the vault root. Moves into a folder's own descendants or onto a colliding name are rejected.
- **Command palette.** **Prompt Studio: New Note**, **Prompt Studio: New Folder**, and **Prompt Studio: Configure Vault** are all available.

### Template view

**Open as Template** on a note opens an editable copy in its own editor tab, titled `<note> (template)`. Edits live only in the tab and never write back to the note, so there is nothing to save.

A bar along the bottom offers:

- **Preview / Edit.** Toggle between the raw markdown and a rendered preview of it.
- **Copy.** Put the current text on the clipboard.
- **Send to Claude.** Drop the current text into the Claude Code chat input.

### Visual canvas

Open any folder (or the vault root) as a pinboard of cards in the editor area. Breadcrumbs across the top walk back toward the root.

- **Note cards** show the title and the note body, scrolling when the text overflows the card.
- **Folder cards** drill in on click, and preview their contents as a scaled-down render of their own canvas, inner cards at their saved spots.

The folder preview recurses up to three layers deep (`PREVIEW_DEPTH` in [src/visual/folderContents.ts](src/visual/folderContents.ts)). An empty folder, or one past that depth, shows a plain folder glyph.

Launch it from:

- **Title-bar button.** The **Open Visual Canvas** button in the view header opens the vault root.
- **Hover a folder.** An **Open Visual Canvas** icon appears on the right of the row in the sidebar tree, opening that folder.
- **Hover a note.** The same icon opens the note's parent folder.
- **Right-click a folder.** The **Open as Canvas** entry opens that folder. Right-clicking the empty area opens the root.
- **Command palette.** **Prompt Studio: Open Visual Canvas** opens the root.

Once open, cards respond to pointer gestures:

- **Drag.** Reposition a card anywhere, OneNote style.
- **Resize.** Drag the handle at a card's bottom-right corner. A folder card keeps its preview at a fixed scale anchored to the top-left, so resizing reveals more or less of its contents instead of scaling them.
- **Click.** Without dragging, act on a card: a note opens in an editor, a folder card navigates into it.

Position, size, and stacking order save to the card's `visual` block in `config.yml`, so the layout survives reopening and follows the card when you rename or move it in the tree.

Right-click a card for its context menu:

- **Both note and folder cards** offer a row of color swatches, **Rename**, **Reveal in Explorer**, **Copy as Path**, and **Delete**.
- **Note cards** add **Open**, **Open as Template**, **Send to Claude**, and **Copy Contents**.

Right-click the empty canvas for the open folder's menu: a row of color swatches, **New Note**, **New Folder**, **Reveal in Explorer**, and **Copy as Path**. New entries land in the open folder, their card placed where you right-clicked.

Hover a swatch to preview that color, click to apply it, or pick the leftmost clear swatch to remove it. A card swatch tints the card, a background swatch tints the open folder and washes the canvas. The menu stays open after a pick so you can try several, and clicking the selected swatch again confirms it and closes the menu.

The color saves to the entry's `visual` block and tints its icon in the sidebar tree too.

Wikilinks and prompts are not built yet.

## Develop

```bash
npm install        # one-time
npm run build      # esbuild bundle into dist/
npm run watch      # rebuild on change, leave running during F5 debug
```

To launch the extension, open this folder in VSCode and press **F5**. That opens an Extension Development Host window with the extension loaded. **Ctrl+R** inside that window reloads after a rebuild.

## Install locally

Build a `.vsix` and install it into your everyday VSCode:

```bash
yes | npm run vsix                                  # writes prompt-studio-<version>.vsix
code --install-extension prompt-studio-0.0.1.vsix
```

Reload VSCode and the Prompt Studio icon appears in the activity bar.

## Publish

The extension publishes to the [VSCode Marketplace](https://marketplace.visualstudio.com/vscode) via `vsce`. Before the first publish:

1. Register a publisher at https://marketplace.visualstudio.com/manage and replace `publisher` in [package.json](package.json) with that publisher id.
2. Create an Azure DevOps personal access token with **Marketplace > Manage** scope. See the [vsce docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token).
3. Authenticate vsce once:
   ```bash
   npx vsce login <publisher>
   ```
4. Add a 128x128 `media/icon.png` and set `"icon": "media/icon.png"` in [package.json](package.json). The marketplace listing requires a PNG.

Cut a release:

```bash
npm version patch                                     # or minor / major
npm run publish                                       # vsce publish
```

`vsce publish` runs `vscode:prepublish` (production build) automatically.
