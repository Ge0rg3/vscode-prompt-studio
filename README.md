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

Early development. The current build ships a sidebar tree backed by a configurable vault location. Open the activity-bar icon, click **Configure Vault** (or run **Prompt Studio: Configure Vault** from the command palette), then pick one of three locations:

1. **Per-workspace default.** A vault is auto-created under the extension's global storage at `<extension storage>/<basename>-<hash>` (e.g. `myproject-a1b2c3d4`, derived from a short hash of the workspace path). Your project files stay untouched.
2. **Custom folder.** Any absolute path on disk.
3. **Folder inside this workspace.** A subfolder of the current workspace, e.g. `<workspace>/prompts`, so the vault is versioned alongside your code.

The path persists in the `promptStudio.vaultPath` setting (empty string means "per-workspace default"). The view reacts to setting changes immediately. No context menus, wikilinks, prompts, or visual mode yet.

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
