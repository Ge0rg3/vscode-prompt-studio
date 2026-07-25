# Prompt Studio - Agents Guide

This file is the canonical map of the codebase for LLM agents.
* For a human-facing overview, the repository layout, the tech stack, setup, and what each surface does, read [README.md](README.md).
* For the manifest itself (commands, views, menus), read [package.json](package.json).

Prompt Studio is one VSCode extension. The extension host, the webview sources, and the assets a webview loads at runtime live in three roots of the same repository and ship as one `.vsix`. This file documents how those roots fit together, the conventions that apply to all of them, and the constraints behind each surface that the code cannot state for itself.

---

## General Info
<details>
<summary><b>Documentation policy</b></summary>

Treat every `*.md` file as part of the codebase. After any feature, refactor, bug fix, or structural change, update the affected docs in the same commit. The two that matter:

- [AGENTS.md](AGENTS.md) - this file. Code map, conventions, project context.
- [README.md](README.md) - human-facing overview, setup, feature reference.

### Docs are a knowledge base

- Write what the system *is now*. Do not preserve past behaviour, leave "previously" notes, or call out recent changes.
- No "updated" / "as of X" / "this used to be" phrasing. No changelog entries inline.
- When something changes, edit the existing text to match. If a section no longer applies, delete it - don't leave a stale paragraph beside the new one.
- The git history is the journal. Docs are the source of truth.

### What earns a line

- The README covers what a reader needs in order to use a feature. Small automatic behaviour and interface polish stay out: a selection that follows the active editor, a panel that reopens after a window reload, a card that rises to the front on drag, a status-bar toast. These are obvious in use.
- Before adding a sentence, ask whether a reader would miss something without it. If not, leave it out.
- One short clause per capability. Don't restate in a parenthetical what the clause already said.

### Style

- Short paragraphs and bullets, written in fluid sentences.
- Plain ASCII: write `->` instead of an arrow, `-` instead of an em dash, `...` instead of an ellipsis.
- Use markdown tables when comparing values across categories.
- Link to other docs and to source files with relative paths.
- Restructure when sections grow. If a section straddles two concerns, split it. If two sections overlap, merge them.

### Check what you wrote

Prose drifts from these rules even when you just read them. After writing or reworking markdown or comments, re-read the diff and grep it for non-ASCII characters (the command is in AI2), semicolons in comments, `Label:` prefixes, and "X, not Y" mirroring.

Before closing out any non-trivial change, re-read this file and [README.md](README.md) end to end and fix anything now wrong, redundant, or misleading.

</details>

<details>
<summary><b>Code style</b></summary>

Prioritise readability over cleverness. Code is read far more than written - optimise for the next person scanning the file.

These apply across the whole repository - the extension host, the webview sources, the plain JS in `media/`, and the manifest.

Every rule carries an id (NM1, CP3, TS7, ...) so reviews can cite the exact rule a finding rests on.

Two goals sit behind all of them: a new reader can open any file and understand it in under a minute, and any module can be moved, replaced, or deleted without rippling through the rest of the codebase.

### Naming (NM)

- **NM1** Names describe what a thing is for. Prefer `visibleNotes` over `filteredArray`, `pendingDocuments` over `pd`. Never name one after its type or shape.
- **NM2** Booleans read as yes/no questions: `isVisible`, `hasPendingEdits`, `shouldRefresh`. Never `visible`, `flag`, `check`.
- **NM3** Functions are verbs, variables are nouns: `fetchNote`, `renderVaultTree`, `wikilinkMatch`.
- **NM4** Event handlers always indicate the event or action.
- **NM5** Single-letter names only in trivial callbacks (`n => n.id`), loop counters, and standard coordinates (`x`, `y`).
- **NM6** Avoid generic names (`data`, `info`, `item`, `result`, `value`, `tmp`, `obj`) when a specific name exists.
- **NM7** Use full words. `noteId` over `nid`, `failedDriveSyncs` over `errs`.

### Comments and Markdown Prose (CP)

Hold every comment and every line of markdown prose to these rules, and rewrite the ones that fail into the simplest correct form rather than just flagging them.

**How it reads (comments and prose alike):**
- **CP1** Clear on the first pass. If you have to re-read it to parse it, rewrite it - don't leave it.
- **CP2** Casual, the way you would say it to someone sitting next to you. Never a specification or a press release.
- **CP3** Plain English, no jargon. Avoid internal identifiers and insider verbs ("relocates the key", "the node stranded") when a plain word works ("moves it", "the row is left behind"). Say it the way you would out loud.
- **CP4** Trade jargon counts as jargon. Say "the background behind the menu" instead of "the scrim", "load the cache from disk" instead of "hydrate the cache". Reach for the plain word every time one exists.
- **CP5** Our own coinages count too. A comment that needs decoding ("the self-write grace window", "round-trip the unread keys") gets swapped for the sentence a newcomer would write: "ignore the file change this write just caused".
- **CP6** An action, in the imperative - lead with a verb ("Drop stale entries before the new ones land", "Stop index failures blocking the tree render"). Never a noun-phrase label for a value.
- **CP7** Naming a thing is the exception. A class or a data shape just gets named: "One row in the skills tree", and stop at the noun.
- **CP8** One thought per comment. Cut decorative add-ons (", which ...", ", ready for ...") that only pad the line. A second clause stays when it carries the actual reason.
- **CP9** Never define a thing by what it isn't. "A short label, not a padded-out sentence" only says the first half back in the negative, and that mirrored rhythm is a loud tell. State the positive and stop.
  - A flat ban on its own is fine: "Never `any`".
  - So is naming the wrong turn when that carries real information: "Dim the marks with `color-mix`, not `opacity`, or the highlight notches at every `#`".
- **CP10** Say it plainly, then stop. Trim padding, but the moment trimming costs clarity, stop trimming - an ordinary sentence beats a compressed clever one.
- **CP11** Never say who reads the thing or what happens downstream ("ready for the renderer", "so the tree sees one shape"). A comment describes what is in front of it.
- **CP12** Explain the *why*. Skip whatever is already obvious from the code or the text around it. The why goes beside the line that needs it.
- **CP13** Don't fuss over punctuation. Drop the full stop at the end of a one-line comment. Keep full stops between sentences when a comment genuinely runs to two.

**Comments:**
- **CP14** Every file gets a short comment at the top (1-2 lines) describing its responsibility.
- **CP15** Brief comment above non-trivial functions explaining *why* the function exists. No line-by-line narration.
- **CP16** Walk a longer function in steps. When a function moves through stages, give each block a short heading comment - "Resolve the target folder", "Copy the entry", "Move its metadata across". The heading just says what the block does, and it is wanted even when the code below is clear.
- **CP17** A blank line goes before any comment that heads code, unless it opens the function or an indented block. The comment binds to the lines below it, and the gap keeps it off the block above.
- **CP18** Comment non-obvious logic: workarounds, regex patterns, magic numbers, VSCode API quirks.
- **CP19** No previous logic and no design justification. Don't restate old behaviour, don't defend the design against an alternative the reader never proposed, and don't over-explain just because the code is new. For bug fixes, comment what the code does now and leave the bug itself out of it.
- **CP20** `// increment counter` above `counter++` is noise - the echo of a single line. A step heading over a block of lines is not.
- **CP21** So is a bare label over a block of names that already say it - `/* Colors */` above `--ps-fill`, `/* Layout */` above `--sidebar-w`. Delete it.
- **CP22** Default to a single line, and there is no need to fill even that. Use two only when one genuinely can't carry it, three or more only in extraordinary cases. When in doubt, cut it down.
- **CP23** No `TODO`, `FIXME`, or `XXX` markers in merged code. If it is worth flagging, it is worth a tracked issue.

Prefer this:

```ts
// Resolve known note titles first, fall back to filename stems
```

Over this:

```ts
// Known note titles are resolved first; the rest fall back to filename stems, ready for the link pass.
```

And through a function that runs in stages, prefer this:

```ts
// Work out where the copy lands
const parent = resolvePasteDir(source, target);

// Copy the entry
const created = await copyEntry(source, parent);
```

Over a bare block with one clever aside:

```ts
// A folder pasted into itself drops to its sibling
const parent = resolvePasteDir(source, target);
```

**Markdown prose:**
- **CP24** 1-2 sentence paragraphs, or bullet points. No walls of text.
- **CP25** Clear sectioning: descriptive headings, one idea per section, easy to scan.
- **CP26** Same voice as the comments - casual and jargon-free. "Which folder is the vault" beats "the vault root resolution surface".

### Files and modules (FM)

- **FM1** One concern per file. Treat ~200 lines as a prompt to check whether a file has grown to cover two, rather than a hard cap. Split by concern, since a single cohesive file may run well past it.
- **FM2** Three roots, split by build target. `src/` is extension-host source (node), `webview/` is browser source with its own `tsconfig.json`, and `media/` is only what a webview loads at runtime.
- **FM3** One folder per feature surface, in `src/<feature>/`. Its commands, its providers, and its services live together.
- **FM4** Keep build inputs out of `media/`. It is the extension's `localResourceRoots` and everything in it ships.
- **FM5** Generic, stateless, domain-agnostic helpers go in `src/common/utils/`. Placement is by nature, not usage count: a helper with no domain meaning belongs there even when one feature uses it today.
- **FM6** The rest of `src/common/` holds shared infrastructure with state and shared domain types. Resist putting anything there until two feature folders import it.
- **FM7** No `utils.ts`, `helpers.ts`, or `misc.ts`. `src/common/utils/` is the folder for purpose-named helpers (`paths.ts`, `fs.ts`, `clipboard.ts`), and each file inside still earns its name.
- **FM8** No barrel `index.ts` re-exports to flatten import paths. The path reflects the structure.
- **FM9** Reconsider file and folder structure on every meaningful change. If a new function has no obvious home, the structure is wrong rather than the function.
- **FM10** Magic numbers and repeated strings become named module-level constants.
- **FM11** Never modify vendored files (`media/codicons/`). Override or extend in project files.
- **FM12** No half-finished implementations. If a command is wired up, every path off it works or is visibly disabled.
- **FM13** No speculative abstractions. Build for the features in the README.

### AI-tells to avoid (AI)

These patterns make code look obviously machine-generated. Don't do any of these.

**Formatting:**
- **AI1** No decorative comment separators: box-drawing, ASCII art, `========` section breaks. The hairline `// --- helpers ---` dividers TS2 calls for are structural markers and stay.
- **AI2** ASCII characters only, anywhere in the repo. No em or en dashes, arrows, ellipsis characters, curly quotes, box-drawing, degree or section signs, and no emoji. Codicons are the only iconography permitted. Grep before committing: `rg --pcre2 '[^\x00-\x7F]' .`
- **AI3** No auto-generated boilerplate headers or `END` markers.
- **AI4** Don't column-align trailing comments with extra spaces. Two spaces before `//`, left ragged.
- **AI5** No three-bullet executive summary at the top of a file or a PR. If a section needs framing, write one sentence.

**Comment style:**
- **AI6** No `Label: description` comments (`// Cleanup: remove stale entries`). Write the comment naturally without the prefix.
- **AI7** No trailing `, which ...` / `, so ...` clause hung off the end of a doc block. One correct thought, then it closes. This is the loudest tell there is.
- **AI8** No "X, not Y" flourish where Y is just X said back in the negative. Give the positive half and stop.
- **AI9** No comments that echo a single line of code. Step headings over a block are wanted - see Comments above.
- **AI10** No semicolons in comments or doc blocks. A semicolon joining two clauses reads as written-up prose, a reliable AI tell. Split the facts apart, drop one, or join with a comma.
- **AI11** No first-person plural narration: no `// Here we fetch the note`, `// Now we iterate over the rows`.
- **AI12** No hedged language: no `might`, `perhaps`, `you may want to`. Comments are assertions. If you are unsure, find out.
- **AI13** No filler adjectives that signal effort rather than meaning: `robust`, `comprehensive`, `seamless`, `elegant`, `powerful`, `leverage`, `utilize` (use `use`), `facilitate`, `streamline`.
- **AI14** No references to the task that produced the code: no `// added for the visual mode rollout`, `// fix for ticket PM-1234`, `// part of phase 2`.
- **AI15** No bold sub-headings inside bulleted lists in doc blocks or comments. The bullet is the structure.
- **AI16** No "this is a simple..." or "this is a basic..." preambles. Just write the thing.

**Unnecessary code:**
- **AI17** No try/catch around code that can't throw.
- **AI18** No `else` after a block that returns - use early return.
- **AI19** No default cases or fallbacks for values that are always defined.
- **AI20** No single-use abstractions or one-line pass-through wrappers. `export function listTitles() { return index.titles(); }` is noise. A wrapper earns its place only when it does work: composes, transforms, builds a typed shape, or unions several sources.
- **AI21** No defensive error handling at internal boundaries. Trust internal callers and validate only at the system boundary: filesystem I/O, VSCode API responses, and messages arriving from a webview.

### Coauthorship and attribution (AT)

- **AT1** Never reference Claude, Anthropic, or "AI assistance" in any artifact - no `Co-Authored-By` lines in commits, no mentions in PR descriptions, no inline comments, no docs. The work ships unattributed.

### TypeScript (TS)

- **TS1** `camelCase` for variables, functions, and module files (`vaultManager.ts`). `PascalCase` for classes and types (`VaultManager`, `NoteIndex`). `SCREAMING_SNAKE_CASE` only for true compile-time constants.
- **TS2** Module order, top to bottom: imports, types, helpers, then services and exports. A reader scrolling down meets every building block before the wiring that uses it.
  - *Types* are interfaces, type aliases, module-level constants, and any other static definitions the rest of the file references.
  - *Helpers* are anything the services below them call. Each carries a leading comment stating what it does in one line.
  - *Services and exports* are the public functions or classes the rest of the extension reaches for.
  - Mark the boundaries with hairline dividers when a file has more than a handful of helpers (`// --- helpers ---`, `// --- exports ---`).
- **TS3** Never interleave helpers between or after services. If you find yourself adding a helper next to its caller, move it up into the helpers block.
- **TS4** A helper only one class calls belongs on that class as a `private` method, `private static` when a static factory needs it.
- **TS5** A function does one thing. If you need the word "and" to describe it, split it. Aim for under 50 lines, and treat 80 as a signal to extract.
- **TS6** Prefer explicit parameters over an options-bag object you destructure once.
- **TS7** Separate logical groupings inside a function body with a blank line, so the reader's eye chunks it into "read the folder", "build the lookup", "return". A grouping is a multi-line statement, a `try`/`catch`, an accumulator and the loop that fills it, an `if`/`for`/`while` block, a cluster of one-liners computing one named thing, or a trailing return. Don't over-fragment: a run of one-liners serving one purpose is one block.
- **TS8** Prefer plain `for` / `for...of` loops over chained `.map().filter().reduce()` pipelines once the chain runs to more than one step, builds a non-trivial shape, or carries logic the reader has to follow line by line. A chain forces the reader to parse the output expression before the iteration that produces it, in reverse of how it executes. Build the result with a named accumulator and `.push()`.
  - `const ids = notes.filter(p).map(f)` becomes `const ids: string[] = []` then `for (const n of notes) { if (p(n)) ids.push(f(n)); }`.
  - Trivially short single-step expressions like `notes.map((n) => n.id)` are fine.
- **TS9** Type annotations on every exported function signature. Inferred return types are fine for non-exported helpers when the body makes the type obvious.
- **TS10** Prefer named `interface` or `type` aliases for in-memory shapes. Don't pass around inline anonymous object types.
- **TS11** No `any` unless you are at the boundary of an untyped library, with a comment saying why. Prefer `unknown` plus a narrow.
- **TS12** No annotation on a local whose right-hand side already pins the type. Annotate empty initializers (`const out: string[] = []`), narrowed locals, and boundaries.
- **TS13** `readonly` and `as const` for data that does not mutate. Skip them on locals that obviously never escape the function.
- **TS14** Imports sit at the top level only, never inside a function. They group as standard (`node:fs`, `node:path`), then third-party (`vscode`, `yaml`), then local, separated by a blank line and alphabetised within each group.
- **TS15** No wildcard `import * as X` unless the namespace import is the documented usage (`import * as vscode from 'vscode'`). Prefer named imports over default imports for local modules.
- **TS16** Class members, top to bottom: fields, constructor, private methods, public methods.
- **TS17** A doc comment only when the contract is non-obvious: what it returns under an edge condition, what it throws, an ordering constraint the signature cannot express. One sentence. No `@param` or `@returns` ceremony when the types already say it.
- **TS18** Ternaries only when short and on one line. Never nest them.
- **TS19** Catch only where something can actually fail: a filesystem read, a VSCode API call, a message from a webview. A bare `catch` needs a sensible fallback, such as skipping the entry or returning an empty list.
- **TS20** No `console.log` in merged code. There is no output channel, so a failure the user needs to know about surfaces through `vscode.window.showErrorMessage` or a status-bar message.

### VSCode extension (VS)

- **VS1** All command, view, and menu declarations live in `package.json` under `contributes`. Adding a feature means editing the manifest and the source in the same commit.
- **VS2** Register commands, providers, and disposables inside `activate(context)` and push every disposable onto `context.subscriptions`. Never instantiate a VSCode-API consumer at module load time.
- **VS3** Command handlers are thin: parse the trigger context, call a service in `src/<feature>/`, dispatch the result back through the VSCode API. Business logic stays out of them.
- **VS4** A feature's commands become a service class when they share a dependency set (`SkillCommands`, `VisualCommands`). Independent registrations stay free functions (`entryActions.ts`, `createEntries.ts`).
- **VS5** Webview message handling follows the same split: the host validates the incoming message shape, calls a service, and posts back a typed reply. The renderer in `media/` only renders and emits intent.
- **VS6** Treat every field of a webview message as untrusted. Re-resolve a node from its path and re-run the same containment and name checks the host would run for a command.
- **VS7** Filesystem operations go through `vscode.workspace.fs` rather than raw `node:fs`, unless the operation is specifically about the extension's own storage on the local disk.
- **VS8** The extension contributes no settings today, and the vault location lives in workspace state. If a setting is added, read it through `vscode.workspace.getConfiguration('promptStudio')` at the boundary and pass plain values down.
- **VS9** Icons come from the product codicon font. No custom glyphs.

### Webview JavaScript (JS)

- **JS1** A webview earns a bundle only when it needs a real dependency. Simple renderers stay plain committed JS in `media/<feature>/`. To add a bundle, drop a `webview/<feature>/main.ts` beside the others and add one build config in `esbuild.js`.
- **JS2** Plain webview scripts are a single IIFE with no imports and no framework.
- **JS3** `const` over `let`, never `var`.
- **JS4** Call `acquireVsCodeApi()` once at the top, and finish setup by posting `{ type: 'ready' }`. The host answers with a full state push, and the renderer re-renders from scratch.
- **JS5** Messages are flat JSON with a `type` discriminator: `{type, ...fields}`. No nested envelopes.
- **JS6** Send a node as the minimal serialized subset the host needs. The host re-resolves the real entry from its path.
- **JS7** Styles and scripts shared by more than one webview live in `media/common/`, mirroring `src/common/`.
- **JS8** `function` declarations for named module-scope functions. Arrows only for inline callbacks.
- **JS9** `addEventListener` for event binding.

### CSS (CS)

- **CS1** Per-webview stylesheets. No monolithic sheet.
- **CS2** Never modify the vendored codicon CSS. Override in project files.
- **CS3** Prefer classes over inline styles.
- **CS4** Every rule reading `--vscode-editor-font-family` carries a fallback stack outside the `var()`. See **Webview fonts** below.

### Git commits (GC)

- **GC1** Single-line commit messages in `<type>: <description>` format. Description is imperative, lowercase, with no trailing period. Examples: `fix: rewrite incoming wikilinks on note rename`, `feat: add visual canvas pan controls`.
- **GC2** Allowed types: `feat` (new user-facing feature), `fix`, `refactor` (no behaviour change), `perf`, `docs`, `style` (formatting only), `test`, `chore` (tooling, deps, manifest plumbing).

</details>

<details>
<summary><b>Workflow rules</b></summary>

### Verifying changes

Type-checking proves the code compiles. It says nothing about whether the feature works.

Press **F5** to launch an Extension Development Host and exercise the change by hand. Most of this extension is interface, so if you cannot visually verify a change, say so rather than claiming it works.

Skills discovery needs a workspace with sub-projects that own their own `.claude/skills`. Create one to test against.

### Typechecking

```bash
npx tsc --noEmit                              # extension host
npx tsc --noEmit -p webview/tsconfig.json     # webview source
```

esbuild strips types without checking them, so the build never fails on a type error. Run both before committing.

### Tests and linting

There is no test suite, no test runner, no linter, no formatter, and no CI. Don't claim a change is verified by tests.

If a test suite is added later, document the runner here and in [README.md](README.md).

### Building

```bash
npm run build        # one-shot build of both bundles
npm run watch        # rebuild on change, leave running during F5 debug
npm run vsix         # produce a local .vsix for sideloading
npm run publish      # publish to the marketplace via vsce
```

</details>

## Project-Specific Info
<details>
<summary><b>Architecture</b></summary>

Three roots, split by build target:

- **`src/`** is extension-host source, running on node. `src/extension.ts` holds `activate`, and each feature surface owns a folder: `vault`, `template`, `visual`, `skills`. `src/common/` holds shared state and domain types, `src/common/utils/` holds stateless helpers.
- **`webview/`** is browser source with its own `tsconfig.json` (DOM types, no node types), bundled by esbuild.
- **`media/`** is what a webview loads at runtime: HTML, CSS, icons, fonts, and built bundles.

A webview has up to three parts: the host in `src/<feature>/` that opens it and passes its messages, the markup and styles in `media/<feature>/`, and a bundled script from `webview/<feature>/` when it needs one.

The template editor is the one bundled webview. `webview/template/` holds:

- `main.ts` - the entry
- `livePreview.ts` - the inline markdown styling
- `codeHighlight.ts` - fenced-code languages and token colors
- `listIndent.ts` - tab and shift-tab on bullets
- `fileMentions.ts` - the `@` path popup and the tint on a resolved mention
- `directoryCache.ts` - the cached listings behind the absolute-path popup

esbuild bundles it to `media/template/template.js`, gitignored and rebuilt like `dist/`.

The trees and the canvas stay plain committed JS in `media/`, because none of them needs a dependency.

### Activation

`activate` builds the shared services in dependency order, pushing each onto `context.subscriptions` as it goes, then registers every provider and command in one final push. There is no `deactivate` - cleanup runs entirely through the subscriptions.

The order matters: `VaultManager` resolves the vault root and publishes `promptStudio.hasVault`, `VaultConfig` opens the vault's `config.yml`, then two shared emitters carry the active canvas folder and live color previews between the sidebar and any open canvas. `VaultWebviewProvider`, `SkillsConfigs`, `SkillsWebviewProvider`, and `MentionIndex` follow in that order. All but `SkillsConfigs` set up their own watchers in the constructor, and its per-root stores are built on demand.

The watchers set up at activation cover the vault root, the vault's `config.yml`, three `.claude` patterns, and `**/*` for the mention index. Canvas and per-skills-root `config.yml` watchers are created lazily.

### Both sidebars are webviews

Neither sidebar is a `TreeView`. Both are `WebviewViewProvider`s rendering a tree that matches the native one. That is what lets them intercept right-clicks on empty space and draw their own menus. There are no `view/item/context` contributions in the manifest, and the right-click menus are built in `media/common/contextMenu.js`.

</details>

<details>
<summary><b>Per-entry metadata</b></summary>

`src/common/vaultConfig.ts` is the store behind every `config.yml` in the repo, whichever root owns it. It is constructed with a function returning its root, so the same class serves the vault and each `.claude/skills` directory.

Everything below is load-bearing:

- **It ignores the file change its own write causes.** Writes are debounced, and for a moment after each write the watcher event it caused is ignored. Drop that and every card drag reloads the file it just wrote.
- **Unknown keys survive a rewrite.** The file is rewritten whole, so `type`, `tags`, and anything else a user adds are read back and re-emitted. An entry left with no metadata is dropped, and a root with nothing to store never gets a file.
- **Metadata follows the entry.** `relocate` and `duplicate` remap the keys of an entry and all its descendants after a move or a copy. A code path that moves a file without calling them leaves its position and color behind, with no warning.
- Keys are root-relative and always forward-slashed, on every platform.

</details>

<details>
<summary><b>Claude skills discovery</b></summary>

The sub-project scan ([src/skills/projectScanner.ts](src/skills/projectScanner.ts)) walks the first workspace folder breadth-first, capped at depth 5 and 2000 directories read, skipping dot directories and `node_modules`. A deeper skills root does not appear. There is no cache, so the walk re-runs on every debounced refresh. The walk starts at the workspace root, and the root itself never becomes a project row, since its own skills render as the flat list below. A symlinked directory counts as a directory in both scans.

A directory qualifies as a sub-project when it holds a `.claude` directory whose `.claude/skills` yields at least one skill. That last filter is what hides the whole view on a workspace that only has a `.claude` directory, since the view's `when` clause only passes once the tree has rows.

`SkillsConfigs` hands out one `VaultConfig` per skills root, so a sub-project's colors and canvas layout write to that project's own `config.yml` rather than landing as `../`-keyed entries in the workspace one. Four constraints hold it up:

- **`configFor` must keep caching what it builds.** Creating a config fires its change event. That schedules a refresh, the refresh rebuilds the tree, and the rebuild calls `configFor` again. Without the cache that loops forever.
- **Nothing evicts a config.** A deleted sub-project's config and its `config.yml` watcher live until the extension shuts down.
- **A skills config's root never changes.** Each one is handed a root-change event that is never fired, so it loads its file once at construction and afterwards only through its own watcher. This is safe because a skills directory path does not move.
- **A newly seen root paints twice.** The config is created lazily during the tree build and loads its file asynchronously, so the colors arrive on the second render. The subscription to the merged change event is what delivers it. Drop that and a sub-project's skill colors never appear on first expand.
- **A skill canvas needs its root's config.** The canvas context is built from `configFor`, so a folder outside every `.claude/skills` opens nothing, and a restored read-only panel whose root is gone is disposed rather than left with no store.

Two separate guards stop `config.yml` writes from causing refresh storms: the store ignores its own write, and the skills provider drops any watcher event whose basename is `config.yml`. Without the second, every card drag on a skill canvas re-walks every project in the workspace.

The watchers cover three patterns: `**/.claude`, `**/.claude/skills`, and `**/.claude/skills/**`. The bare `**/.claude` is what makes a newly created sub-project appear at all. Deleting a whole sub-project fires no event under any of them, so its row lingers until the next skills event or a manual **Refresh Skills**.

Two smaller constraints:

- **`skillsDir` has to survive serialization.** The skills renderer puts it on every node it sends, and **New Skill** reads it to pick which skills root to create in. Remove the field and New Skill on a sub-project row quietly creates the skill in the workspace `.claude/skills`.
- **A compressed row keeps the deepest segment's path.** A run of folders that each hold only one child renders as one `a/b/c` row carrying the last directory's path, so expand state and **Reveal in Explorer** both key off the deepest directory.

The skills host intercepts **Copy as Path > Relative** before it reaches the registered command, because the shared menu emits the vault's command id and that handler resolves against the vault root. The interception measures the path from the skills directory that owns the row, or from the workspace folder for a sub-project row, which sits above every skills directory. Remove it and the entry copies a wrong `../`-prefixed path and still reports success.

</details>

<details>
<summary><b>Workspace mentions</b></summary>

A relative `@path` in the template editor resolves against the first workspace folder, because that is the one directory Claude Code runs in. Extra roots are not offered, since a path from the second root would not resolve for Claude anyway.

`src/template/mentionIndex.ts` scans that folder and `TemplatePanel` posts the whole list to the webview. The renderer never queries the host per keystroke, because the tint has to answer "is this a real path" synchronously on every document change, so it needs the set locally regardless. A burst of file creates or deletes drops the cached scan and announces the change once it settles, and the rescan itself runs when a panel next asks for the list.

The index is capped at 20000 files and filtered by the enabled `files.exclude` and `search.exclude` patterns, so a large or heavily excluded workspace silently offers a partial list. Both the index and the on-disk browser also drop any path containing whitespace or an `@`, because the mention patterns in the renderer stop at those characters. Change either pattern and both filters go stale.

A leading slash (`@/home/`) browses the disk instead, which no index can cover, so `src/template/mentionFilesystem.ts` reads one directory per request. The webview caches the last 100 listings it receives and answers keystrokes through the completion result's `update` hook, which re-ranks the cached listing synchronously. Both halves are load-bearing: without the cache each keystroke is a host round trip, and without the hook CodeMirror re-queries and debounces every keystroke, greying the popup while it waits.

- A listing refreshes in the background once it is two seconds old, so the popup can briefly offer a just-deleted file.
- The folder under the popup highlight is prefetched once the arrows rest, so stepping into it is instant.
- A listing request that never gets a reply times out, so a dead mount cannot wedge its directory for the session.

A relative mention is tinted straight from the pushed index. An absolute one is tinted only after a debounced existence check of a path actually written in the note, never from a popup listing, so the verified set only ever holds paths the note names. Only the host touches the filesystem, and the webview holds what it has been told.

Browsing ignores case everywhere: the workspace popup ranks against lowercased paths, and a failed absolute read retries with each segment matched to its on-disk casing, so `@/HOME/` still lists `/home` on a case-sensitive disk. A picked completion always inserts the on-disk spelling. The tint stays exact-case on purpose, because Claude Code reads the written path literally, so a wrong-case mention has to show as unresolved.

The popup is CodeMirror's, restyled in `media/template/template.css` to match the VSCode suggest widget. Every rule there is prefixed with `.cm-editor` to reach the specificity of CodeMirror's own base theme, and the selected-row rule carries both `.cm-tooltip` and `.cm-tooltip-autocomplete` to outrank its light and dark variants. Drop a class from those selectors and the popup reverts to CodeMirror's colors.

</details>

<details>
<summary><b>The two sidebar trees</b></summary>

[media/vault/tree.js](media/vault/tree.js) and [media/skills/tree.js](media/skills/tree.js) are two files on purpose. The vault tree is a read-write explorer with selection, inline rename, delete, clipboard, and drag-moves. The skills tree is a read-only browser whose mutations are a color tint and **New Skill** on a sub-project row. They share row chrome and the color-preview protocol and nothing of their interaction model. Merging them means a config-driven abstraction over two genuinely different behaviours, so they stay separate until a third tree webview justifies the extraction.

They do share a stylesheet: the skills host is served [media/vault/tree.css](media/vault/tree.css), and there is no `media/skills/tree.css`. Editing that file restyles both sidebars.

### Sidebar note click

A single click on a note opens its template view with `preserveFocus`, so the sidebar webview keeps focus and F2 can rename the row just clicked. The menu's explicit **Open** omits the flag and moves focus to the editor. The note's **Open as File** hover button opens the raw file rather than the template.

### Sidebar copy and paste

Ctrl+C records the entry's path in the tree webview, not the OS clipboard, and Ctrl+V pastes it from there. The menu's **Duplicate File** and **Duplicate Folder** run the same paste with the entry as its own target, so the copy lands beside it without touching the clipboard.

Paste resolves its target the way `createEntries.ts` places a new note, dropping to the source's parent when that would nest a folder inside itself. That parity is two copies of one rule rather than shared code, so a change to either has to be made twice. After `src/vault/copyEntry.ts` copies the entry, the host deep-copies its `config.yml` metadata onto the new path, mirroring how a move relocates it.

</details>

<details>
<summary><b>Visual canvas</b></summary>

**New Note** and **New Folder** sit on the canvas background menu rather than on a folder card, because the canvas watcher is not recursive. A note created inside a folder card would not show up until the canvas navigated into it.

The canvas the sidebar highlights flows through a shared emitter, so the active canvas folder wins over the active editor when the two disagree.

A canvas opened from a skill is read-only. The renderer strips every mutating entry from both menus when the host says so, so the same canvas code serves the vault and the skills view.

</details>

<details>
<summary><b>Send to Claude</b></summary>

Sending pastes into the existing Claude Code chat input: copy to the clipboard, focus the Claude view, then run the paste command. A deep link or an editor-open call opens a new Claude window instead.

If Claude Code is missing, the action falls back to leaving the text on the clipboard and saying so.

The transport lives in `src/common/sendToClaude.ts` and takes plain text. What gets sent differs by caller: a vault note sends its contents, a skill sends its `/name` slash command, and the template panel sends the slash command when it was opened from a skill and the edited text otherwise.

</details>

<details>
<summary><b>Editor selection</b></summary>

The template editor selects with the browser's native selection rather than CodeMirror's `drawSelection()`. That extension paints the highlight into a layer behind `.cm-content`, so any opaque background on the content covers it, and a select-all leaves fenced code, inline code, and resolved mentions looking unselected. The native highlight paints above an element's background and below its glyphs, which covers all three at once.

Three rules in `media/template/template.css` hold it up, and the selection breaks if any of them goes:

- `.cm-editor ::selection` sets the background alone, so the fenced-code token colors survive underneath it. A high-contrast-only rule beside it does set a color, since those themes need the contrast.
- `.cm-content` sets `caret-color`, since the caret is the browser's now and CodeMirror's base theme would otherwise force it black on a dark theme.
- `.cm-syntax` dims the markdown marks with a `color-mix` alpha. An `opacity` below 1 groups the span and composites its own selection background down with the glyphs, which notches the highlight at every `#`, `-`, `**`, and backtick.

The toolbar cancels its `mousedown` for the same reason: a click on Copy or Send would otherwise pull focus out of the editor, and the native highlight only stays lit while the editor holds focus.

</details>

<details>
<summary><b>Webview fonts</b></summary>

VSCode hands `--vscode-editor-font-family` to a webview as the raw `editor.fontFamily` setting, which is often one bare family name (`IBM Plex Mono`). The editor itself appends the platform default stack behind it, and a webview gets nothing. So when that font is not installed, Chromium falls back to its default standard font, Times New Roman.

Every webview rule reading that var therefore carries a fallback stack outside it: `font-family: var(--vscode-editor-font-family, monospace), Menlo, Consolas, monospace`. The `monospace` inside `var()` only covers the variable being undefined, so it is the list after the `var()` that catches a missing font. The named families lead because an Electron renderer resolves the bare `monospace` generic to Courier New.

This applies to code spans and canvas previews. Prose and interface text read `--vscode-font-family`, which arrives as a full stack already.

Form controls need more: VSCode injects an `!important` control-font rule, so an `<input>` or `<textarea>` needs the font declared inline with `!important` plus a `, monospace` fallback. The template editor is a CodeMirror contenteditable, so it is exempt.

</details>

<details>
<summary><b>Palette accents</b></summary>

A palette class in `media/common/palette.css` sets two vars. `--ps-fill` backs the cards, the swatches, and the canvas wash. `--ps-accent` colors the icon of a tinted row in the sidebar and the scrollbar thumb of a tinted card.

The accent is the only thing carrying a color into the tree, so no accent sits on the neutral grey axis. An accent close to `--vscode-icon-foreground` leaves a tinted icon looking untinted, and that swatch then reads as the clear swatch at the other end of the row. `gray` is a slate blue-grey to stay clear of it.

</details>

<details>
<summary><b>Where to look next</b></summary>

- Activation and the service graph -> [src/extension.ts](src/extension.ts)
- Vault metadata, moves, and copies -> [src/common/vaultConfig.ts](src/common/vaultConfig.ts)
- Which folder is the vault -> [src/common/vaultManager.ts](src/common/vaultManager.ts), [src/vault/configureVault.ts](src/vault/configureVault.ts)
- Sidebar host, watchers, and the message allowlist -> [src/vault/vaultWebviewProvider.ts](src/vault/vaultWebviewProvider.ts), [src/skills/skillsWebviewProvider.ts](src/skills/skillsWebviewProvider.ts)
- Skills and sub-project discovery -> [src/skills/skillScanner.ts](src/skills/skillScanner.ts), [src/skills/projectScanner.ts](src/skills/projectScanner.ts), [src/skills/skillsConfigs.ts](src/skills/skillsConfigs.ts)
- Template editor internals -> [webview/template/](webview/template/), [src/template/templatePanel.ts](src/template/templatePanel.ts)
- Canvas cards and folder previews -> [src/visual/folderContents.ts](src/visual/folderContents.ts), [media/visual/canvas.js](media/visual/canvas.js)
- Shared menu, swatches, and webview HTML -> [media/common/](media/common/), [src/common/utils/webview.ts](src/common/utils/webview.ts)
- Repository layout, tech stack, setup, packaging, and the feature reference -> [README.md](README.md)

</details>
