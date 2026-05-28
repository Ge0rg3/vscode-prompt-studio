# Prompt Studio

A VSCode extension that turns a folder of markdown files into an Obsidian-like vault for notes and reusable prompts.

## What it does

- **Vault.** Point it at any folder of `.md` files. Storage stays plain markdown on disk: portable, git-friendly, and readable without the extension.
- **Sidebar tree.** Browse, create, rename, delete, and drag-reorganize notes from a dedicated activity-bar panel.
- **Visual canvas.** Open any folder as a card canvas. Drag, resize, and color notes; layout persists as note metadata.
- **Wikilinks.** `[[Other Note]]` with completion, cmd-click navigation, hover preview, and rename refactoring.
- **Prompts.** Notes marked as prompts can declare `{{variables}}`. Pick a prompt, fill in the blanks, then copy to clipboard or insert into the active editor.

## Vault layout

A vault is a folder of `.md` files. Note bodies are pure markdown, no frontmatter, so a note can be pasted straight into an LLM without leaking metadata.

Per-note metadata (type, tags, visual layout) lives in a single `config.yml` at the vault root:

```yaml
notes:
  Welcome.md:
    tags: [intro]
  prompts/Refactor.md:
    type: prompt
    tags: [code, refactor]
    visual: { x: 200, y: 100, color: pink }
```

## Status

Early development. The current build ships a sidebar vault view and a read-only visual canvas, both backed by a configurable folder location. The sidebar is a webview styled to match the native tree, which lets it intercept right-clicks on empty space.

### Configure the vault

Open the activity-bar icon, click **Configure Vault** in the empty view (or run **Prompt Studio: Configure Vault** from the command palette), then pick one of three locations:

1. **Per-workspace default.** A vault is auto-created under the extension's global storage at `<extension storage>/<basename>-<hash>` (e.g. `myproject-a1b2c3d4`, derived from a short hash of the workspace path). Your project files stay untouched.
2. **Custom folder.** Any absolute path on disk.
3. **Folder inside this workspace.** A subfolder of the current workspace, e.g. `<workspace>/prompts`, so the vault is versioned alongside your code.

The path persists in the `promptStudio.vaultPath` setting (empty string means "per-workspace default"). The view reacts to setting changes immediately.

### Create and organize notes

Once a vault is set:

- **Title-bar buttons.** The view header shows **New Note** and **New Folder**. New entries land in the parent folder of the selected entry, or at the vault root when nothing is selected.
- **Right-click empty area.** Offers **New Note** and **New Folder** at the vault root.
- **Right-click a folder.** Offers **New Note**, **New Folder**, **Rename**, and **Reveal in Explorer**.
- **Right-click a note.** Offers **Open**, **Rename**, **Copy Contents** (copies the markdown body to the clipboard), and **Reveal in Explorer**.
- **Drag and drop.** Drag any note or folder onto another folder row to move it. Drop onto the empty area to lift to the vault root. Moves into a folder's own descendants or onto a colliding name are rejected.
- **Command palette.** **Prompt Studio: New Note**, **Prompt Studio: New Folder**, and **Prompt Studio: Configure Vault** are all available.

### Visual canvas

Open any folder (or the vault root) as a pinboard of cards in the editor area. Each note shows its title and a short text preview, each subfolder shows as a card you can drill into. Breadcrumbs across the top walk back toward the root. It is styled with the standard VSCode theme colors rather than the bright sticky-note look of similar tools.

Launch it from:

- **Title-bar button.** The **Open Visual Canvas** button in the view header opens the vault root.
- **Right-click a folder.** The **Open as Canvas** entry opens that folder. Right-clicking the empty area opens the root.
- **Command palette.** **Prompt Studio: Open Visual Canvas** opens the root.

The canvas is read-only for now: click a note card to open it in an editor, click a folder card to navigate into it. No drag, resize, color, or saved layout yet.

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
npm run vsix                                          # writes prompt-studio-<version>.vsix
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
