<h1 align="center">VSCode Prompt Studio</h1>

<p align="center">
  An Obsidian-like vault of markdown notes and reusable prompts, inside VSCode.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="License: GPL-3.0">
  <img src="https://img.shields.io/badge/VS%20Code-1.85%2B-blue.svg" alt="VSCode 1.85 or newer">
  <img src="https://img.shields.io/badge/storage-plain%20markdown-blue.svg" alt="Stores plain markdown">
</p>

<p align="center">
  <img src="docs/canvas.png" alt="A folder of prompts open as a canvas of colored cards, with Claude Code alongside">
</p>

<p align="center">
  <i>Any folder, opened as a pinboard. Drag the cards where you want them.</i>
</p>

---

Your prompts and notes are plain `.md` files in a folder you choose, so the same vault reads fine from a text editor or from `git log`.

## What it does

- **A vault with no setup.** Point it at any folder of `.md` files. Open a workspace and one is created for you.
- **A canvas and a tree.** Open any folder as a pinboard of cards. Drag, resize, and tint them, and the layout is saved beside your notes.
- **An editor that leaves your text alone.** Markdown styles itself as you type and the marks stay visible, so `{{variables}}` reach the clipboard exactly as you wrote them.
- **One click into Claude Code.** Send a note or a skill straight to the chat input, images attached.
- **Your Claude skills, listed.** Every `.claude/skills` folder in the workspace and its sub-projects, in one sidebar section.
- **`@` mentions that resolve.** Type `@` to search the workspace the way you would in Claude Code. A mention naming a real path is tinted, and Ctrl+click opens it.
- **A vault per project.** The vault location lives in workspace state, so different projects point at different vaults.

<details>
<summary><b>See the sidebar and the template editor</b></summary>

<p align="center">
  <img src="docs/template-editor.png" alt="The vault tree and Claude Skills in the sidebar, with a prompt open in the template editor">
</p>

<p align="center">
  <i>Both sidebar sections on the left, a prompt open in the template editor, and Send to Claude in the bar along the bottom.</i>
</p>

</details>

## Requirements

- VSCode 1.85 or newer.
- The [Claude Code extension](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code), for the **Send to Claude** actions. Without it those actions fall back to the clipboard.
- On Linux, `wl-copy` or `xclip`, so a note's images can be attached to what you send. Without either, an image goes over as a path.

## The details

<details>
<summary><b>The vault and <code>config.yml</code></b></summary>

A vault is a folder of `.md` files. Note bodies are pure markdown with no frontmatter, so a note can be pasted straight into an LLM without leaking metadata.

A file attached to a note is stored in a hidden `.attachments` folder beside it, and taking it off the note deletes the file unless another note there uses it too.

Per-entry metadata lives in a single `config.yml` at the vault root. Notes and folders both get an entry, keyed by vault-relative path:

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

The extension reads and writes the `visual` block: card position, size, stacking order, and color.

- Any other keys survive a rewrite.
- An entry left with no metadata is dropped, and a vault with nothing to store never gets a `config.yml`.
- The file is watched, so a hand edit updates the tree and any open canvas.

### Choosing the vault location

With a folder open, a vault is created automatically. To move it, use the gear in the view title bar or run **Prompt Studio: Configure Vault**, then pick one of:

1. **Per-workspace default.** A vault under the extension's global storage at `<extension storage>/<basename>-<hash>`, the hash taken from the workspace path. Nothing is written into your project.
2. **Custom folder.** Any absolute path on disk.
3. **Folder inside this workspace.** A subfolder such as `<workspace>/prompts`, so the vault is versioned alongside your code. Offered only when a folder is open.

</details>

<details>
<summary><b>Sidebar</b></summary>

The **Vault** view lists the vault as a tree, with right-click menus on rows and on empty space.

Only `.md` files appear, and dotfiles are hidden.

- **Title bar.** **New Note**, **New Folder**, **Open Visual Canvas**, **Expand All**, **Collapse All**, and a **Configure Vault** gear. Entries created from the title bar land at the vault root.
- **Right-click empty area.** **Open as Canvas**, **New Note**, **New Folder**.
- **Right-click a folder.** A row of color swatches, then **Open as Canvas**, **New Note**, **New Folder**, **Rename**, **Duplicate Folder**, **Reveal in File Manager**, **Copy as Path**, **Delete**. Entries created here land inside that folder.
- **Right-click a note.** A row of color swatches, then **Open**, **Open as File**, **Send to Claude**, **Rename**, **Duplicate File**, **Copy Contents**, **Reveal in File Manager**, **Copy as Path**, **Delete**.
- **Copy as Path** offers **Static**, the absolute path on disk, or **Relative**, the path relative to the vault root.
- **Hover.** A note row shows **Open as File**, **Send to Claude**, and **Open Visual Canvas**. A folder row shows **Open Visual Canvas**.
- **Color swatches.** Hover to preview, click to apply, or pick the leftmost clear swatch to remove. The tint colors the entry's icon and is the same color the canvas uses.
- **Drag and drop.** Drag a note or folder onto another folder row to move it, or onto empty space to lift it to the vault root. A drop is refused when it would nest a folder inside itself or in one of its own subfolders, or when the name is already taken.
- **Keyboard.** **F2** renames inline, **Delete** deletes after a confirmation, and **Ctrl+C** then **Ctrl+V** duplicates. A paste lands in the selected entry's folder, named `<name> (Copy)` when the name is taken.
- **Command palette.** **New Note**, **New Folder**, **Open Visual Canvas**, and **Configure Vault**.

</details>

<details>
<summary><b>Template view</b></summary>

Clicking a note opens it in the template view: an editable tab of its own, titled `<note> (template)`. Edits stay in the tab until you save.

**Open as File** opens the raw markdown in a plain text editor instead.

The editor styles markdown inline as you type. The marks themselves (`#`, `**`, backticks) stay visible but dimmed, so Save and Copy hand off exactly what you wrote.

- **Inline styling.** Headings, emphasis, strikethrough, inline and fenced code, links, quotes, lists, and rules. Tables and images stay as plain markdown.
- **Attachments.** Paste or drop a file to attach it. Each one shows as a chip above the bottom bar, with an x to take it off again. Source mode shows the markdown that names it.
- **Fenced code.** Syntax-highlighted for JavaScript and TypeScript, Python, JSON, HTML, CSS, YAML, and shell.
- **Find and replace.** **Ctrl+F** opens a find box over the text, and **Ctrl+H** opens it with the replace row, or **Cmd+F** and **Cmd+Alt+F** on macOS.
- **Workspace mentions.** Type `@` to search the workspace by path. Pick a file to insert its path, or a folder to browse into it.
- **Matching.** Search matches the file name, the folder path, or the typed letters in order anywhere in the path, so `@tmplpanel` and `@template/temp` both find `src/template/templatePanel.ts`. An `@` inside code, mid-word, or naming a path that does not exist is left alone.
- **Absolute paths.** Start the path with a slash to browse the disk itself: `@/` lists the filesystem root, `@/usr/` lists what is in `/usr`. Each directory is read as you reach it. Case does not have to match, and picking from the popup inserts the path as it is spelled on disk.
- **Mention highlight.** A mention naming a real file or folder is tinted in both Rendered and Source mode, so you can see what Claude Code will resolve before you send.
- **Open a mention.** Ctrl+click a tinted mention, or Cmd+click on macOS, to open the file in an editor. A folder opens in the file manager.
- **Limits.** A path with a space in it cannot be mentioned. Search covers the first workspace folder, since that is where Claude Code runs.
- **Keyboard.** While the `@` popup is open, **Up** and **Down** move the selection, **Enter** or **Tab** accepts, and **Escape** closes it. Otherwise **Tab** at the start of a bullet nests it under the one above and **Shift+Tab** lifts it out. Anywhere else **Tab** inserts a tab or indents a selection, and **Shift+Tab** outdents. Press **Escape** first to move focus out of the editor instead.

A bar along the bottom offers:

- **Rendered / Source.** Names the mode you are looking at. Click it to read the note as plain markdown, and again to bring the inline styling back.
- **Attach.** Pick files off disk to attach to the note.
- **Save.** Write the current text back over the note. **Ctrl+S**, or **Cmd+S** on macOS, anywhere in the tab does the same.
- **Copy.** Put the current text on the clipboard.
- **Send to Claude.** Replace the Claude Code chat input with the current text. Images go over attached, other files as their path.

</details>

<details>
<summary><b>Visual canvas</b></summary>

Open any folder, or the vault root, as a pinboard of cards in the editor area. Breadcrumbs across the top walk back toward the root.

- **Note cards** show a title and the note body, scrolling when the text overflows. The title is the note's first heading, falling back to the filename.
- **Folder cards** preview their contents as a scaled-down render of their own canvas, inner cards at their saved spots.

The folder preview nests up to three layers deep. An empty folder, or one past that depth, shows a plain folder icon.

Every **Open Visual Canvas** and **Open as Canvas** action, in the sidebar or the palette, opens one. Launched from a note, it opens the note's parent folder.

Once open, cards respond to the pointer:

- **Drag.** Reposition a card anywhere, OneNote style.
- **Resize.** Drag the handle at a card's bottom-right corner. Resizing a folder card reveals more of its preview.
- **Click.** Without dragging, a note opens in an editor and a folder card navigates into it.

Position, size, and stacking order save to the card's `visual` block in `config.yml`, so the layout survives reopening and follows the card when you rename or move it in the tree.

- **Card menu.** Color swatches, **Rename**, **Reveal in File Manager**, **Copy as Path**, and **Delete**, with **Open**, **Open as Template**, **Send to Claude**, and **Copy Contents** on note cards.
- **Background menu.** Color swatches, **New Note**, **New Folder**, **Reveal in File Manager**, and **Copy as Path**. New entries land in the open folder, their card placed where you right-clicked.

A card swatch tints the card, and a background swatch tints the open folder and the canvas behind it. Each color saves to that entry's `visual` block.

A canvas opened from a skill drops **New Note**, **New Folder**, **Rename**, and **Delete** from its menus. You can still move, resize, recolor, and open the cards.

</details>

<details>
<summary><b>Claude skills</b></summary>

A second sidebar section, **Claude Skills**, appears whenever the workspace has skills in `<workspace>/.claude/skills`, or a sub-project inside it has its own. Each skill is a folder holding a `SKILL.md`.

- A skill row shows the `name` from its `SKILL.md` frontmatter, falling back to the folder name, with the `description` as its tooltip.
- **Sub-projects** with their own `.claude/skills` (nested repos, monorepo packages) sit above the workspace skills as a folder tree, showing only the folders that lead to skills. A run of folders that each hold only one child collapses into one `a/b/c` row.
- **Scan limits.** The search covers the first workspace folder, skips dot directories and `node_modules`, and stops at five levels or 2000 directories. A skills root past those limits never appears.
- Expand a skill to browse and open the files in its folder, dotfiles aside. Clicking a file opens it directly.
- **Hover a skill** for **Open SKILL.md**, **Open as Canvas**, and **Send to Claude**.
- **Right-click a skill** for color swatches, **Open SKILL.md**, **Open as Template**, **Open as Canvas**, **Send to Claude**, **Reveal in File Manager**, and **Copy as Path**. A file inside a skill gets swatches plus **Open**, **Reveal in File Manager**, and **Copy as Path**. A folder gets the same without **Open**.
- **Right-click a sub-project** for **New Skill**, created inside that project, plus **Reveal in File Manager** and **Copy as Path**. A grouping row that owns no skills of its own offers only the last two.
- **Copy as Path** offers **Static**, the absolute path, or **Relative**, measured from the `.claude/skills` root that owns the row. A sub-project row is measured from the workspace folder.
- **Title bar.** **New Skill**, **Open Visual Canvas**, **Expand All**, **Collapse All**, and **Refresh Skills**.
- **Right-click empty area** for **Open as Canvas** and **New Skill**.

Opening a `SKILL.md` or a supporting file opens the real file in an editor, so edits save straight to disk.

- **New Skill** creates `.claude/skills/<name>/SKILL.md` with `name` and `description` frontmatter, and opens it. It refuses a name already in use.
- **Open as Template** opens the `SKILL.md` in the template view, where **Send to Claude** still sends the slash command.
- **Open as Canvas** opens the skill folder as a read-only canvas.
- **Send to Claude** drops the skill's `/name` slash command into the Claude Code chat.

Each `.claude/skills` root keeps its own `config.yml`, so a sub-project's colors and card layout commit inside that sub-project.

The title-bar **Open Visual Canvas** and **New Skill** always act on the workspace's own `.claude/skills`. A sub-project's skills are reached from its own row.

A deleted sub-project's row lingers until **Refresh Skills** clears it.

</details>

## Settings

The extension has no settings. The vault location is set through **Prompt Studio: Configure Vault**.

## Contributing

Build instructions and the repository layout are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Third-party notices

This extension bundles the following, with thanks:

| Component | Copyright | License |
|-----------|-----------|---------|
| [CodeMirror 6](https://codemirror.net) | Marijn Haverbeke and contributors | MIT |
| [Lezer](https://lezer.codemirror.net) | Marijn Haverbeke and contributors | MIT |
| crelt, style-mod, w3c-keyname, find-cluster-break | Marijn Haverbeke | MIT |
| [VSCode codicons](https://github.com/microsoft/vscode-codicons) | Microsoft Corporation | CC-BY-4.0 |
| [yaml](https://eemeli.org/yaml/) | Eemeli Aro | ISC |

## License

Prompt Studio is released under the GNU General Public License v3.0. See [LICENSE](LICENSE) for the full text.
