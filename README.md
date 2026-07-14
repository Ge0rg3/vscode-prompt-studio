# Prompt Studio

A VSCode extension that turns a folder of markdown files into an Obsidian-like vault for notes and reusable prompts.

## What it does

- **Vault.** Point it at any folder of `.md` files. Storage stays plain markdown on disk: portable, git-friendly, and readable without the extension.
- **Sidebar tree.** Browse, create, rename, delete, and drag-reorganize notes from a dedicated activity-bar panel.
- **Visual canvas.** Open any folder as a card canvas. Drag notes and folders to reposition them, OneNote style. Positions persist as entry metadata.
- **Claude skills.** When the workspace has Claude skills in `.claude/skills`, a sidebar section lists them. Browse and edit a skill, open it as a canvas or template, or send its slash command to Claude.
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

Early development. The current build ships a sidebar vault view and a draggable visual canvas, both backed by a configurable folder location, plus a Claude Skills sidebar section that surfaces the workspace's `.claude/skills`.

The sidebar is a webview styled to match the native tree, which lets it intercept right-clicks on empty space.

### Configure the vault

Open the activity-bar icon, click **Configure Vault** in the empty view (or run **Prompt Studio: Configure Vault** from the command palette), then pick one of three locations:

1. **Per-workspace default.** A vault is auto-created under the extension's global storage at `<extension storage>/<basename>-<hash>` (e.g. `myproject-a1b2c3d4`, derived from a short hash of the workspace path). Your project files stay untouched.
2. **Custom folder.** Any absolute path on disk.
3. **Folder inside this workspace.** A subfolder of the current workspace, e.g. `<workspace>/prompts`, so the vault is versioned alongside your code.

Each workspace remembers its own choice, so different projects can point at different vaults.

### Create and organize notes

Once a vault is set:

- **Title-bar buttons.** The view header shows **New Note** and **New Folder** for creating entries, plus **Expand All** and **Collapse All** to toggle every folder in the tree at once. New entries land in the parent folder of the selected entry, or at the vault root when nothing is selected.
- **Right-click empty area.** Offers **New Note** and **New Folder** at the vault root, plus **Open as Canvas** (detailed under Visual canvas).
- **Right-click a folder.** Offers a row of color swatches, **New Note**, **New Folder**, **Rename**, **Reveal in Explorer**, **Copy as Path** (a submenu offering **Static**, the absolute path on disk, or **Relative**, the path relative to the vault root), and **Delete**, plus **Open as Canvas** (detailed under Visual canvas).
- **Right-click a note.** Offers a row of color swatches, **Open**, **Open as Template** (opens the note in an editable tab of its own, detailed under Template view), **Send to Claude** (pastes the note into the Claude Code chat input), **Rename**, **Copy Contents** (copies the markdown body to the clipboard), **Reveal in Explorer**, **Copy as Path**, and **Delete**. Hovering a note row also shows quick **Open as Template** and **Send to Claude** buttons.
- **Color swatches.** Hover a swatch to preview a color, click to apply it, or pick the leftmost clear swatch to remove it. The tint colors the entry's icon and is the same color used by the visual canvas.
- **Drag and drop.** Drag any note or folder onto another folder row to move it. Drop onto the empty area to lift to the vault root. Moves into a folder's own descendants or onto a colliding name are rejected.
- **Keyboard.** Press **F2** on the selected note or folder to rename it.
- **Command palette.** **Prompt Studio: New Note**, **Prompt Studio: New Folder**, and **Prompt Studio: Configure Vault** are all available.

### Template view

**Open as Template** on a note opens it in an editable tab of its own, titled `<note> (template)`. Edits stay in the tab until you save, which overwrites the note.

The editor styles markdown inline as you type. The marks themselves (`#`, `**`, backticks) stay visible but dimmed, so Save, Copy, and Send hand off exactly what you wrote, `{{variables}}` and all.

- **Inline styling.** Headings render large, emphasis bold or italic, and code, quotes, and links formatted. Tables and images stay as plain markdown.
- **Fenced code.** Syntax-highlighted for JavaScript and TypeScript, Python, JSON, HTML, CSS, YAML, and shell.
- **Workspace mentions.** Type `@` to search the workspace by path, the way you would in Claude Code. Search matches the file name, the folder path, or a loose subsequence of either, so `@tmplpanel` and `@template/temp` both find `src/template/templatePanel.ts`. Picking a file inserts its path, picking a folder browses into it. Mentions inside code, mid-word (an email address), or naming a path that does not exist are left alone.
- **Absolute paths.** Start the path with a slash to browse the disk itself instead of the workspace: `@/` lists the filesystem root, `@/home/` lists what is in `/home`. Each directory is read as you reach it, so anything on disk can be mentioned, not just workspace files. Case does not have to match, and picking from the popup inserts the path as it is spelled on disk.
- **Mention highlight.** A mention that names a real file or folder is tinted, in both Rendered and Source mode, so you can see what Claude Code will resolve before you send. A path with a space in it cannot be mentioned, and workspace search covers the first workspace folder, since that is the folder Claude Code runs in.
- **Keyboard.** While the `@` popup is open, **Up** and **Down** move the selection, **Enter** or **Tab** accepts, and **Escape** closes it. Otherwise **Tab** at the start of a bullet nests it under the one above, **Shift+Tab** lifts it back out. Anywhere else **Tab** inserts a tab, or indents every line of a selection, and **Shift+Tab** outdents. Press **Escape** first to move focus out of the editor instead.

A bar along the bottom offers:

- **Rendered / Source.** Names the mode you are looking at. Click it to read the note as plain markdown, and again to bring the inline styling back.
- **Save.** Write the current text back over the note. **Ctrl+S** anywhere in the tab does the same.
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

### Claude skills

A second sidebar section, **Claude Skills**, appears whenever the workspace has skills in `<workspace>/.claude/skills`. Each skill is a folder holding a `SKILL.md`.

- A skill row shows the name from its `SKILL.md` frontmatter.
- Hover a skill for quick **Open SKILL.md**, **Open as Canvas**, and **Send to Claude** buttons, or expand it to browse and open every file in the skill folder.
- Right-click a skill, or a file or folder inside it, for a row of color swatches. A skill also offers **Open SKILL.md**, **Open as Template**, **Open as Canvas**, **Send to Claude**, **Reveal in Explorer**, and **Copy as Path**.
- The view header carries **New Skill**, **Open Visual Canvas** (the skills root as a card canvas), **Expand All**, and **Collapse All**. Right-clicking the empty area offers **Open as Canvas** and **New Skill**.
- **New Skill** scaffolds `.claude/skills/<name>/SKILL.md` and opens it for editing.

Opening a `SKILL.md` or a supporting file opens the real file in an editor, so edits save straight to disk. The skill actions reuse the shared views and Claude integration:

- **Open as Template** opens the `SKILL.md` in the template view. Its **Send to Claude** button sends the skill's slash command, not the text.
- **Open as Canvas** opens the skill folder as a visual canvas. The skill canvas lets you rearrange, resize, recolor, and open cards but not create, rename, or delete. Its card layout saves to a `config.yml` in `.claude/skills`, the same per-entry metadata file the vault canvas uses, so the layout commits alongside your skills.
- **Send to Claude** drops the skill's slash command (`/<name>`, taken from the `SKILL.md` frontmatter) into the Claude Code chat.

Wikilinks and prompts are not built yet.

## Develop

```bash
npm install        # one-time
npm run build      # esbuild bundle: extension into dist/, template webview into media/template/
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
