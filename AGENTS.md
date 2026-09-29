# Prompt Studio - Agents Guide

This file is the code conventions and the project context for LLM agents.
* For what the extension does, read [README.md](README.md).
* For the repository layout, the tech stack, setup, packaging, and releases, read [CONTRIBUTING.md](CONTRIBUTING.md).
* For the commands, views, menus, and settings, read [package.json](package.json).

Prompt Studio is one VSCode extension. The extension host (`src/`), the webview sources (`webview/`), and the files a webview loads at runtime (`media/`) live in three roots of the same repository and ship as one `.vsix`.

This file carries the conventions that apply to all three. The project-specific half is deliberately short: it holds only what the code cannot say for itself. For anything else, read the code.

---

## General Info
<details>
<summary><b>Documentation policy</b></summary>

Treat every `*.md` file as part of the codebase. After a feature, refactor, bug fix, or structural change, update the affected docs in the same commit.

Keep the edit surgical. Change the lines that are wrong now and leave the rest alone. Most updates shorten a doc or leave its length where it was, and a new paragraph has to clear **What earns a line** below.

- [AGENTS.md](AGENTS.md) - this file. Conventions, and what the code cannot say for itself.
- [README.md](README.md) - what the extension does. The marketplace renders it as the listing page, so keep it aimed at someone installing it.
- [CONTRIBUTING.md](CONTRIBUTING.md) - repository layout, tech stack, setup, packaging, releases.
- [CHANGELOG.md](CHANGELOG.md) - one entry per released version. The only doc that records history.

### Docs are a knowledge base

- Write what the system *is now*. No "previously", no "as of X", no changelog entries inline.
- When something changes, edit the existing text to match. Delete a section that no longer applies rather than leaving it beside the new one.
- The git history is the journal. Docs are the source of truth.
- Restructure when sections grow. Split a section that straddles two concerns, merge two that overlap.

### What earns a line

Write down what the code cannot say for itself: a rule that spans several files with nothing enforcing it, a decision that looks wrong until you know why, or behaviour belonging to VSCode, Chromium, CodeMirror, or Claude Code. Anything else stays out, since an agent can follow the code.

A comment counts as the code saying it. Every file and every non-obvious branch carries one (CP14, CP18), so a fact reworded from a comment does not belong here.

The README's bar is different. It covers what someone needs in order to use a feature. Automatic behaviour and interface polish stay out, since they are obvious in use. One short clause per capability, and don't restate it in a parenthetical.

### Style

- Prose follows the comment rules (CP24-CP26): short paragraphs and bullets, in fluid sentences.
- Plain ASCII throughout, the same as AI2 asks of the code.
- Name the file or the function you mean, and link to it with a relative path.
- Use markdown tables when comparing values across categories.

### Check what you wrote

Prose drifts from these rules even when you just read them. After writing or reworking markdown or comments, re-read the diff and grep it for non-ASCII characters (the command is in AI2), semicolons in comments, `Label:` prefixes, and "X, not Y" mirroring.

Before closing out a non-trivial change, re-read this file, [README.md](README.md), and [CONTRIBUTING.md](CONTRIBUTING.md) and fix whatever is now wrong or redundant.

</details>

<details>
<summary><b>Code style</b></summary>

Prioritise readability over cleverness. Code is read far more than written - optimise for the next person scanning the file.

These apply across the whole repository - the extension host, the webview sources, the plain JS in `media/`, and the manifest.

Every rule carries an id (NM1, CP3, TS7, ...) so reviews can cite the exact rule a finding rests on.

### Naming (NM)

- **NM1** Names describe what a thing is for, in full words. Prefer `visibleNotes` over `filteredArray`, `pendingDocuments` over `pd`. Never name one after its type or shape.
- **NM2** Booleans read as yes/no questions: `isVisible`, `hasPendingEdits`, `shouldRefresh`. Never `visible`, `flag`, `check`.
- **NM3** Functions are verbs, variables are nouns: `fetchNote`, `renderVaultTree`, `wikilinkMatch`.
- **NM4** Event handlers always indicate the event or action.
- **NM5** Single-letter names only in trivial callbacks (`n => n.id`), loop counters, and standard coordinates (`x`, `y`).
- **NM6** Avoid generic names (`data`, `info`, `item`, `result`, `value`, `tmp`, `obj`) when a specific name exists.

### Comments and Markdown Prose (CP)

Hold every comment and every line of markdown prose to these rules, and rewrite the ones that fail rather than just flagging them.

**How it reads (comments and prose alike):**
- **CP1** Clear on the first pass. If you have to re-read it to parse it, rewrite it.
- **CP2** Casual, the way you would say it to someone sitting next to you. Never a specification or a press release.
- **CP3** Plain English, no jargon. Avoid internal identifiers and insider verbs ("relocates the key", "the node stranded") when a plain word works ("moves it", "the row is left behind").
- **CP4** Trade jargon counts as jargon. Say "the background behind the menu" instead of "the scrim", "load the cache from disk" instead of "hydrate the cache".
- **CP5** Our own coinages count too. A comment that needs decoding ("the self-write grace window") gets swapped for the sentence a newcomer would write: "ignore the file change this write just caused".
- **CP6** An action, in the imperative - lead with a verb ("Drop stale entries before the new ones land"). Never a noun-phrase label for a value, and never `// Here we fetch the note`.
- **CP7** Naming a thing is the exception. A class or a data shape just gets named: "One row in the skills tree", and stop at the noun.
- **CP8** One thought per comment. Cut decorative add-ons (", which ...", ", ready for ...") that only pad the line. A second clause stays when it carries the actual reason.
- **CP9** Never define a thing by what it isn't. "A short label, not a padded-out sentence" only says the first half back in the negative, and that mirrored rhythm is a loud tell. State the positive and stop.
  - A flat ban on its own is fine: "Never `any`".
  - So is naming the wrong turn when that carries real information: "Dim the marks with `color-mix`, not `opacity`, or the highlight notches at every `#`".
- **CP10** Say it plainly, then stop. Trim padding, but the moment trimming costs clarity, stop trimming - an ordinary sentence beats a compressed clever one.
- **CP11** Never say who reads the thing or what happens downstream ("ready for the renderer"). A comment describes what is in front of it.
- **CP12** Explain the *why*. Skip whatever is already obvious from the code around it.
- **CP13** Don't fuss over punctuation. Drop the full stop at the end of a one-line comment. Keep full stops between sentences when a comment genuinely runs to two.

**Comments:**
- **CP14** Every file gets a short comment at the top (1-2 lines) describing its responsibility.
- **CP15** Brief comment above non-trivial functions explaining *why* the function exists. No line-by-line narration.
- **CP16** Walk a longer function in steps. When a function moves through stages, give each block a short heading comment - "Resolve the target folder", "Copy the entry", "Move its metadata across". The heading says what the block does, and it is wanted even when the code below is clear.
- **CP17** A blank line goes before any comment that heads code, unless it opens the function or an indented block.
- **CP18** Comment non-obvious logic: workarounds, regex patterns, magic numbers, VSCode API quirks.
- **CP19** No previous logic and no design justification. Don't restate old behaviour, and don't defend the design against an alternative the reader never proposed. For a bug fix, comment what the code does now and leave the bug out of it, along with ticket ids and phase numbers.
- **CP20** `// increment counter` above `counter++` is noise - the echo of a single line. A step heading over a block of lines is not.
- **CP21** So is a bare label over a block of names that already say it - `/* Colors */` above `--ps-fill`. Delete it.
- **CP22** Default to a single line, and there is no need to fill even that. Use two only when one genuinely can't carry it. When in doubt, cut it down.
- **CP23** No `TODO`, `FIXME`, or `XXX` markers in merged code.

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

- **FM1** One concern per file. Treat ~200 lines as a prompt to check whether a file has grown to cover two, not a hard cap.
- **FM2** Three roots, split by build target. `src/` is extension-host source (node), `webview/` is browser source with its own `tsconfig.json`, and `media/` is what a webview loads at runtime, plus the icons the manifest names.
- **FM3** One folder per feature surface, in `src/<feature>/`. Its commands, its providers, and its services live together.
- **FM4** Keep build inputs out of `media/`. It is the extension's `localResourceRoots` and everything in it ships.
- **FM5** Generic, stateless, domain-agnostic helpers go in `src/common/utils/`. Placement is by nature, not usage count: a helper with no domain meaning belongs there even when one feature uses it today.
- **FM6** The rest of `src/common/` holds shared infrastructure with state, and shared domain types. Resist putting anything there until two feature folders import it.
- **FM7** No `utils.ts`, `helpers.ts`, or `misc.ts`. Helpers in `src/common/utils/` are purpose-named (`paths.ts`, `fs.ts`, `clipboard.ts`).
- **FM8** No barrel `index.ts` re-exports to flatten import paths. The path reflects the structure.
- **FM9** Reconsider file and folder structure on every meaningful change. If a new function has no obvious home, the structure is wrong rather than the function.
- **FM10** Magic numbers and repeated strings become named module-level constants.
- **FM11** Never modify vendored files (`media/codicons/`). Override or extend in project files.
- **FM12** No half-finished implementations. If a command is wired up, every path off it works or is visibly disabled.

### AI-tells to avoid (AI)

These patterns make code look obviously machine-generated. Don't do any of these.

**Formatting:**
- **AI1** No decorative comment separators: box-drawing, ASCII art, `========` section breaks. The hairline `// --- helpers ---` dividers TS2 calls for are structural markers and stay.
- **AI2** ASCII characters only, anywhere in the repo. Write `->` for an arrow, `-` for an em dash, `...` for an ellipsis, and use no curly quotes or emoji. Grep before committing: `rg --pcre2 '[^\x00-\x7F]' .`
- **AI3** No auto-generated boilerplate headers or `END` markers.
- **AI4** Don't column-align trailing comments with extra spaces. Two spaces before `//`, left ragged.

**Comment style:**
- **AI5** No `Label: description` comments (`// Cleanup: remove stale entries`). Write the comment naturally without the prefix.
- **AI6** No trailing `, which ...` / `, so ...` clause hung off the end of a doc block. One correct thought, then it closes. This is the loudest tell there is.
- **AI7** No "X, not Y" flourish where Y is just X said back in the negative (CP9).
- **AI8** No comments that echo a single line of code (CP20). Step headings over a block are wanted (CP16).
- **AI9** No semicolons in comments or doc blocks. A semicolon joining two clauses reads as written-up prose, a reliable AI tell.
- **AI10** No hedged language: no `might`, `perhaps`, `you may want to`. If you are unsure, find out.
- **AI11** No filler adjectives that signal effort rather than meaning: `robust`, `comprehensive`, `seamless`, `elegant`, `powerful`, `leverage`, `utilize` (use `use`), `facilitate`, `streamline`, and no "this is a simple..." preambles.

**Unnecessary code:**
- **AI12** No try/catch around code that can't throw.
- **AI13** No `else` after a block that returns - use early return.
- **AI14** No default cases or fallbacks for values that are always defined.
- **AI15** No single-use, speculative, or pass-through abstractions. `export function listTitles() { return index.titles(); }` is noise. A wrapper earns its place when it does work: composes, transforms, builds a typed shape, or unions several sources.
- **AI16** No defensive error handling at internal boundaries. Trust internal callers and validate only at the system boundary: filesystem I/O, VSCode API responses, and messages arriving from a webview.

### Coauthorship and attribution (AT)

- **AT1** Never reference Claude, Anthropic, or "AI assistance" in any artifact - no `Co-Authored-By` lines in commits, no mentions in PR descriptions, no inline comments, no docs. The work ships unattributed.

### TypeScript (TS)

- **TS1** `camelCase` for variables, functions, and module files (`vaultManager.ts`). `PascalCase` for classes and types (`VaultManager`, `NoteIndex`). `SCREAMING_SNAKE_CASE` only for true compile-time constants.
- **TS2** Module order, top to bottom: imports, types, helpers, then services and exports. A reader scrolling down meets every building block before the wiring that uses it.
  - Types are the interfaces, aliases, and module constants the rest of the file references. Helpers are whatever the services below them call. Services and exports are what the rest of the extension reaches for.
  - Mark the boundaries with hairline dividers when a file has more than a handful of helpers (`// --- helpers ---`, `// --- exports ---`).
- **TS3** Never interleave helpers between or after services. If you find yourself adding a helper next to its caller, move it up into the helpers block.
- **TS4** A helper only one class calls belongs on that class as a `private` method, `private static` when a static factory needs it.
- **TS5** A function does one thing. If you need the word "and" to describe it, split it. Aim for under 50 lines, and treat 80 as a signal to extract.
- **TS6** Prefer explicit parameters over an options-bag object you destructure once.
- **TS7** Separate logical groupings inside a function body with a blank line, so the reader's eye chunks it into "read the folder", "build the lookup", "return". Don't over-fragment: a run of one-liners serving one purpose is one block.
- **TS8** Prefer plain `for` / `for...of` loops over chained `.map().filter().reduce()` pipelines once the chain runs to more than one step. A chain forces the reader to parse the output expression before the iteration that produces it, in reverse of how it executes. Build the result with a named accumulator and `.push()`. A trivial single-step expression like `notes.map((n) => n.id)` is fine.
- **TS9** Type annotations on every exported function signature. Inferred return types are fine for non-exported helpers when the body makes the type obvious.
- **TS10** Prefer named `interface` or `type` aliases for in-memory shapes. Don't pass around inline anonymous object types.
- **TS11** No `any` unless you are at the boundary of an untyped library, with a comment saying why. Prefer `unknown` plus a narrow.
- **TS12** No annotation on a local whose right-hand side already pins the type. Annotate empty initializers (`const out: string[] = []`), narrowed locals, and boundaries.
- **TS13** `readonly` and `as const` for data that does not mutate. Skip them on locals that never escape the function.
- **TS14** Imports sit at the top level only, never inside a function. They group as standard (`node:fs`, `node:path`), then third-party (`vscode`, `yaml`), then local, separated by a blank line and alphabetised within each group.
- **TS15** No wildcard `import * as X` unless the namespace import is the documented usage (`import * as vscode from 'vscode'`). Prefer named imports over default imports for local modules.
- **TS16** Class members, top to bottom: fields, constructor, private methods, public methods.
- **TS17** A doc block (`/** */`) only when the contract is non-obvious: what it returns under an edge condition, what it throws, an ordering constraint the signature cannot express. One sentence. No `@param` or `@returns` ceremony when the types already say it.
- **TS18** Ternaries only when short and on one line. Never nest them.
- **TS19** A bare `catch` needs a sensible fallback, such as skipping the entry or returning an empty list.
- **TS20** No `console.log` in merged code. There is no output channel, so a failure the user needs to know about goes through `vscode.window.showErrorMessage` or a status-bar message.

### VSCode extension (VS)

- **VS1** All command, view, menu, and setting declarations live in `package.json` under `contributes`. Adding a feature means editing the manifest and the source in the same commit.
- **VS2** Register commands, providers, and disposables inside `activate(context)` and push every disposable onto `context.subscriptions`. Never instantiate a VSCode-API consumer at module load time.
- **VS3** Command handlers are thin: parse the trigger context, call a service in `src/<feature>/`, dispatch the result back through the VSCode API. Business logic stays out of them.
- **VS4** A feature's commands become a service class when they share a dependency set (`SkillCommands`, `VisualCommands`). Independent registrations stay free functions (`entryActions.ts`, `createEntries.ts`).
- **VS5** Webview message handling follows the same split: the host validates the incoming message shape, calls a service, and posts back a typed reply. The renderer in `media/` only renders and emits intent.
- **VS6** Treat every field of a webview message as untrusted. Re-resolve a node from its path and re-run the same containment and name checks the host would run for a command.
- **VS7** Filesystem operations go through `vscode.workspace.fs` rather than raw `node:fs`, unless the operation is about the extension's own storage on the local disk.
- **VS8** Read a setting through `vscode.workspace.getConfiguration('promptStudio')` at the boundary and pass plain values down. The project vault location lives in workspace state rather than a setting.
- **VS9** Icons come from the product codicon font. No custom glyphs.

### Webview JavaScript (JS)

- **JS1** A webview earns a bundle only when it needs a real dependency. Simple renderers stay plain committed JS in `media/<feature>/`. To add a bundle, drop a `webview/<feature>/main.ts` beside the others and add one build config in `esbuild.js`.
- **JS2** Plain webview scripts are a single IIFE with no imports and no framework.
- **JS3** `const` over `let`, never `var`.
- **JS4** Call `acquireVsCodeApi()` once at the top, and finish setup by posting `{ type: 'ready' }`. The host answers with a full state push, and the renderer re-renders from scratch.
- **JS5** Messages are flat JSON with a `type` discriminator: `{type, ...fields}`. No nested envelopes.
- **JS6** Send a node as the minimal serialized subset the host needs. The host re-resolves it (VS6).
- **JS7** Styles and scripts shared by more than one webview live in `media/common/`, mirroring `src/common/`.
- **JS8** `function` declarations for named module-scope functions. Arrows only for inline callbacks.
- **JS9** `addEventListener` for event binding.

### CSS (CS)

- **CS1** Per-webview stylesheets. No monolithic sheet.
- **CS2** Prefer classes over inline styles.
- **CS3** Every rule reading `--vscode-editor-font-family` carries a fallback stack outside the `var()`. See **Webview gotchas** below.

### Git commits (GC)

- **GC1** Single-line commit messages in `<type>: <description>` format. Description is imperative, lowercase, with no trailing period. Examples: `fix: rewrite incoming wikilinks on note rename`, `feat: add visual canvas pan controls`.
- **GC2** Allowed types: `feat` (new user-facing feature), `fix`, `refactor` (no behaviour change), `perf`, `docs`, `style` (formatting only), `test`, `chore` (tooling, deps, manifest plumbing).

</details>

<details>
<summary><b>Workflow rules</b></summary>

Setup, the build commands, packaging, and how a release is cut are in [CONTRIBUTING.md](CONTRIBUTING.md).

### Verifying changes

Typechecking proves the code compiles. It says nothing about whether the feature works.

Press **F5** to launch an Extension Development Host and try the change by hand. Most of this extension is interface, so if you cannot verify a change by looking at it, say so rather than claiming it works.

Skills discovery needs a workspace with sub-projects that own their own `.claude/skills`. Create one under `test-projects/`, which `.vscodeignore` keeps out of the package.

### Typechecking

```bash
npx tsc --noEmit                              # extension host
npx tsc --noEmit -p webview/tsconfig.json     # webview source
```

esbuild strips types without checking them, so the build never fails on a type error. Run both before committing.

There is no test suite, no test runner, no linter, and no formatter. Don't claim a change is verified by tests.

</details>

## Project-Specific Info
<details>
<summary><b>The sidebars</b></summary>

Both sidebars are webviews rather than `TreeView`s, because a `TreeView` cannot catch a right-click on empty space. That is also why [media/vault/tree.js](media/vault/tree.js) and [media/skills/tree.js](media/skills/tree.js) are two files rather than one renderer with options for two trees. They stay apart until a third tree webview turns up.

A command a webview asks for has to be in that host's allowed list as well as in `package.json`. An unlisted one hits a bare `return`, with no message and no error, so the menu row just does nothing.

The project-or-global switch sits in both title bars on purpose. The Claude Skills view disappears when the project collection holds nothing, so the one on the Vault view is the only button always on screen.

</details>

<details>
<summary><b>Rules nothing enforces</b></summary>

Three obligations that no type and no call site checks, and all of them fail quietly.

- **Any code that renames, moves, copies, or deletes an entry has to call `relocate`, `duplicate`, or `remove`** on the store in [src/common/vaultConfig.ts](src/common/vaultConfig.ts). `moveEntry.ts`, `copyEntry.ts`, and a plain delete know nothing about it, so a new caller compiles, runs, and leaves the card's position and color behind under the old key.
- **Any code that moves, copies, or deletes a note has to call `carryNoteAttachments` or `dropNoteAttachments`** in [src/common/noteAttachments.ts](src/common/noteAttachments.ts). Skip it and the note's stored files are left orphaned, or the moved note points at nothing.
- **Anything describing the project vault has to read `projectVaultRoot` on [src/common/vaultManager.ts](src/common/vaultManager.ts)**, never `getVaultRoot`. The two answer differently while the global scope is on, so the settings page would name the global folder under the project vault heading.

</details>

<details>
<summary><b>Claude skills discovery</b></summary>

- **`configFor` in [src/skills/skillsConfigs.ts](src/skills/skillsConfigs.ts) has to keep caching what it builds.** The map reads as ordinary memoisation, but building a config fires a change event, the event schedules a refresh, and the refresh builds the config again. Without the cache that never stops.
- **Deleting a whole sub-project fires none of the skills watchers**, so its row stays until the next skills event or a manual **Refresh Skills**.
- **`skillsDir` has to stay on the node the renderer sends.** The field is optional on the type and the fallback is silent, so trimming the field list in [media/skills/tree.js](media/skills/tree.js) makes **New Skill** on a sub-project row create the skill in the workspace `.claude/skills`.
- **The watcher on `~/.claude` has to keep the plain pattern `skills`.** A pattern carrying `**` or a slash makes VSCode watch its base folder recursively, and `~/.claude/projects` holds the session transcripts Claude Code rewrites on every turn.
- **The global scan has to stay flat.** Claude Code keeps the skill sets synced from claude.ai under `~/.claude/skills/synced/<id>/`, and several of them hold copies of the same skill names.

</details>

<details>
<summary><b>The template editor</b></summary>

Five things in [webview/template/](webview/template/) that read as tidy-up material and are not.

- **`isOutsideAttachments` has to stay one shared function.** CodeMirror's `SearchQuery.eq` compares `test` by identity, so building the filter inline makes every query unequal, and a replace then rewrites an attachment path and deletes the file with it.
- **`verifiedPaths` hands back the `Set` it already had when the host finds nothing new.** The mention scan runs again whenever that field changes identity, so a fresh `Set` with nothing new in it restarts the scan, finds the same unresolved path, and asks again every 200ms forever.
- **Browsing ignores case, and a mention is only colored as resolved when the case matches exactly.** Claude Code reads the written path literally, so a wrong-case mention has to show as unresolved.
- **A saved version shows in its own read-only `EditorView` in [webview/template/versionStepper.ts](webview/template/versionStepper.ts).** Loaded into the live editor, it would go into the undo history, mark the note unsaved, and make the attachment strip delete every file the old text leaves out.
- **Every popup rule in [media/template/template.css](media/template/template.css) is prefixed `.cm-editor`, and the selected row carries both `.cm-tooltip` and `.cm-tooltip-autocomplete`.** They are outranking CodeMirror's own injected theme. Flatten the selectors and the popup reverts to its colors.

</details>

<details>
<summary><b>Visual canvas</b></summary>

- **New Note and New Folder sit on the canvas background menu**, not on a folder card, because the folder watcher only watches direct children. Anything made inside a folder card would not show up.
- **`allowCrud` gates the folder's structure, and `saveNote` is deliberately left outside it**, so a read-only skills canvas still saves what is typed into a card.
- **`root` and `allowCrud` go into `vscode.setState` for the host, not the webview.** The renderer never reads them back, so they look like dead payload. The panel serializer needs them: without `allowCrud` a reloaded skills canvas comes back editable, and without `root` it closes.
- **Saving a card never prunes the note's attachments**, since the canvas saves between keystrokes and would read a link the user is still typing.
- **`.card` and `.mini-card` in [media/visual/canvas.css](media/visual/canvas.css) change together, down to the title row and the note text inside them.** Zooming into or out of a folder swaps a live card for its copy in a folder preview, so any difference between the two shows as a jump.

</details>

<details>
<summary><b>Note history</b></summary>

- **Code that saves, moves, or deletes a note needs no history call.** [src/history/noteHistory.ts](src/history/noteHistory.ts) snapshots the vault from a file watcher.
- **A note renamed and more than half rewritten between two snapshots starts a fresh history.** Git spots a moved note by its text alone.
- **Every git call has to go through `runGit` in [src/history/git.ts](src/history/git.ts).** The vault often sits inside the user's own repository, so a plain `git` run from the vault folder commits there.

</details>

<details>
<summary><b>Send to Claude</b></summary>

What [src/common/sendToClaude.ts](src/common/sendToClaude.ts) has to work around, all of it Claude Code's own behaviour:

- A deep link or an editor-open call opens a second Claude window. That is why the send focuses the view, copies to the clipboard, and runs the paste command instead.
- Claude Code takes no file handed to it by an extension, so an image has to travel on the system clipboard.
- Attachments already in the chat input cannot be taken back off. There is no command, no message, and no keystroke for it, and Claude Code clears them only once a message is sent.
- The focus check only rules out an open editor. With some other panel focused, the prompt goes nowhere and the user is never told.

</details>

<details>
<summary><b>Webview gotchas</b></summary>

- **The editor font.** `--vscode-editor-font-family` reaches a webview as the raw `editor.fontFamily` setting, often a single bare family name, since VSCode appends the platform default stack only inside its own editor. If the user does not have that font, Chromium falls back to Times New Roman, and Electron resolves a bare `monospace` to Courier New. That is why the stack in CS3 ends in named faces.
- **The editor's selection.** The template editor leaves selection to the browser. CodeMirror's `drawSelection()` paints into a layer behind the text, so fenced code, inline code, and resolved mentions look unselected under it. `basicSetup` pulls `drawSelection` in with it, so neither can be added back. `.cm-content` sets its own `caret-color` for the same reason: CodeMirror's base theme forces a black caret, which is invisible on a dark theme.
- **Card colors.** Keep a new accent clear of neutral grey. The sidebar shows a row's color on its icon alone, so a grey accent looks like no color at all. That is why `gray` is a blue-grey.

</details>
