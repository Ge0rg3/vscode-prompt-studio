# Contributing to Prompt Studio

Build, run, packaging, and release instructions for working on the extension itself.

* For what the extension does, read [README.md](README.md).
* For the conventions and the code style, read [AGENTS.md](AGENTS.md).

## Quickstart

```bash
npm install                 # one-time
npm run watch               # rebuild on change, leave running during F5 debug
npx tsc --noEmit            # typecheck the extension host (esbuild does not check types)
./install.sh                # package a .vsix and install it into VSCode
```

Press **F5** in VSCode to launch an Extension Development Host with the extension loaded. **Ctrl+R** in that window reloads it after a rebuild.

## Prerequisites

- Node 18+ and npm
- VSCode 1.85 or newer

## Repository layout

```
vscode-prompt-studio/
+-- README.md               # Human-facing overview and feature reference
+-- CHANGELOG.md            # What changed in each released version. The marketplace renders it
+-- CONTRIBUTING.md         # This file. Setup, build, packaging, releases
+-- AGENTS.md               # Conventions, code style, and what the code cannot say for itself
+-- LICENSE                 # GPL-3.0
+-- package.json            # Manifest: commands, views, menus, settings
+-- esbuild.js              # Two bundles (host, template webview) + copies codicons into media/
+-- install.sh              # Package a .vsix and install it into VSCode
+-- .vscodeignore           # What stays out of the packaged .vsix
+-- tsconfig.json           # Extension host: ES2022 target, Node16 modules, no DOM
+-- .vscode/                # launch.json for the F5 debug flow, plus the npm: watch build task
+-- .github/workflows/      # publish.yml, the release workflow for a push to main
+-- docs/                   # README screenshots served from GitHub, plus the marketplace icon art. Not packaged
+-- demo/                   # The demo project the screenshots are shot against
|
+-- src/                    # Extension host source (node)
|   +-- extension.ts        # activate(): builds the shared services, registers every provider and command
|   +-- common/             # Shared state, domain types, and helpers
|   |   +-- vaultConfig.ts      # The config.yml store, with debounced writes and metadata that moves with an entry
|   |   +-- vaultManager.ts     # Which folder is the vault, remembered per workspace
|   |   +-- cardLayoutStore.ts  # The interface a canvas needs from a metadata store
|   |   +-- cardColors.ts       # The seven-color palette and its shared messages
|   |   +-- noteAttachments.ts  # The files stored beside a note, and dropping the unused ones
|   |   +-- sendToClaude.ts     # Paste a prompt and its attached files into the Claude Code chat input
|   |   +-- noteView.ts         # Whether a plain open lands in the template editor or the raw file
|   |   +-- vaultNode.ts        # The node shape passed between host, webviews, and commands
|   |   +-- utils/              # Purpose-named stateless helpers: paths, fs, webview, clipboard,
|   |                           # imageClipboard, compare
|   +-- vault/              # Vault sidebar host, create/rename/delete, move/copy, vault location
|   +-- template/           # Template panel host, mention index, on-disk path browsing, attachment storage
|   +-- visual/             # Canvas panel host and the folder-to-cards reader
|   +-- skills/             # Skills sidebar host, skill and sub-project scanners, per-root config
|   |                       # stores, skill commands
|   +-- settings/           # The settings page panel and the command that opens it
|
+-- webview/                # Browser source bundled into media/ (own tsconfig: DOM, no node types)
|   +-- template/           # main.ts, livePreview.ts, codeHighlight.ts, listIndent.ts,
|                           # fileMentions.ts, directoryCache.ts, findReplace.ts,
|                           # attachments.ts, attachmentStrip.ts
|
+-- media/                  # Everything a webview loads at runtime, plus the icons the manifest names. All of it ships
|   +-- icon.svg            # Activity-bar icon, named by the manifest
|   +-- marketplaceIcon.png # 128x128 marketplace icon, exported from docs/marketplace-icon.svg
|   +-- common/             # contextMenu + noteOpen + palette + toolbar, shared by more than one webview
|   +-- vault/              # tree.html/.css/.js. tree.css also styles the skills view
|   +-- skills/             # tree.html/.js for the Claude Skills sidebar
|   +-- visual/             # canvas.html/.css/.js for the card canvas, viewport.js for its pan and
|   |                       # zoom, folderZoom.js for moving between folders, noteEditing.js for
|   |                       # the text fields on its cards
|   +-- template/           # template.html/.css plus the generated template.js bundle
|   +-- settings/           # settings.html/.css/.js for the settings page
|   +-- codicons/           # VSCode icon font, copied from node_modules at build time
|
+-- dist/                   # Built extension bundle
```

`dist/`, `media/codicons/`, and `media/template/template.js` are build output and gitignored, but they still ship in the `.vsix`. What the `.vsix` leaves out is listed in [.vscodeignore](.vscodeignore).

## Tech stack

| Layer | Technology |
|-------|------------|
| Extension host | TypeScript 5.5, targeting Node 18, VSCode API `^1.85` |
| Bundler | esbuild 0.24 - `cjs` for the host, `iife` for the template webview |
| Sidebar, canvas, and settings views | Webviews rendering hand-written plain JS, no framework |
| Template editor | CodeMirror 6: markdown + GFM, autocomplete, search, seven fenced-code languages |
| Per-entry metadata | YAML (`yaml` 2.9), one `config.yml` per root |
| Icons | `@vscode/codicons` font, copied into `media/` at build |
| Packaging | `@vscode/vsce` |

`yaml` is the only entry under `dependencies`. Both bundles inline everything they use, and `vsce` packages with `--no-dependencies`, so no `node_modules` ships.

## Setup

```bash
npm install
npm run build      # one-shot build
npm run watch      # rebuild on change, leave running during F5 debug
```

`npm run build` produces two bundles: the extension host into `dist/extension.js`, and the template webview into `media/template/template.js`. Both builds first copy the codicon font out of `node_modules` into `media/codicons/`, since `media/` is the resource root every webview is given.

## Running locally

Open this folder in VSCode and press **F5**. That runs the `npm: watch` task, then opens an Extension Development Host window with the extension loaded.

The Prompt Studio icon appears in that window's activity bar. Open a folder there before testing the vault, since the vault location is resolved per workspace.

## Typechecking and tests

```bash
npx tsc --noEmit                            # extension host
npx tsc --noEmit -p webview/tsconfig.json   # webview source
```

esbuild strips types without checking them, so nothing in the build catches a type error. Run these before committing.

There is no test suite, no test runner, no linter, and no formatter. Verify changes by running the extension. CI runs both typechecks, but only on a commit that publishes.

## Packaging

Install the extension into your everyday VSCode:

```bash
./install.sh
```

That packages a `.vsix` and installs it over any previous copy of the same version. Reload VSCode and the Prompt Studio icon appears in the activity bar.

The script calls `code`, so set `CODE_CLI=code-insiders` when your VSCode CLI goes by another name. It builds the package through `npm run vsix`, piping `yes` in to answer the confirmation `vsce` puts up.

`vsce` packages from disk rather than from git, so anything added at the repo root that a user should not receive needs a line in [.vscodeignore](.vscodeignore).

## Releases

Only the maintainer can cut a release, since it goes out under their personal marketplace account.

[.github/workflows/publish.yml](.github/workflows/publish.yml) publishes on a push to `main` when the version in [package.json](package.json) has no `v<version>` release yet, then cuts that release with the `.vsix` attached. So leave the version and the [CHANGELOG.md](CHANGELOG.md) entry alone in a pull request.

A release is a version bump:

```bash
npm version patch -m "chore: release %s"  # or minor / major
git push
```

Commit the version's [CHANGELOG.md](CHANGELOG.md) entry first, since `npm version` refuses a dirty tree.

The workflow publishes with the `VSCE_PAT` repository secret, an [Azure DevOps token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token) with **Marketplace > Manage** scope. A token lasts a year at most, so a publish step failing with a `401` means it is time for a new one. Publishing by hand is `npm run publish`, which needs `npx vsce login` first.

## Not built yet

Two features named in the project's goals have no implementation:

- **Wikilinks.** `[[Other Note]]` with completion, navigation, hover preview, and rename refactoring.
- **Prompts.** Notes marked as prompts declaring `{{variables}}`, picked from a list and filled in before copying or inserting. The `type` and `tags` keys already survive a `config.yml` rewrite, but nothing reads them.

## License

Contributions are accepted under the GNU General Public License v3.0. See [LICENSE](LICENSE).
