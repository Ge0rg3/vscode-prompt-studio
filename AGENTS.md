# AGENTS.md

Guidance for AI assistants and humans working in this repo.

## Keep the docs up to date

`AGENTS.md` and `README.md` describe how the project is *right now*. Update them in the same change that makes them stale, and treat them as a knowledgebase, not a log.

- **Update in the same commit.** If a command, folder, convention, manifest entry, feature, or build step changes, edit the relevant doc in the same change. A doc that disagrees with the code is a bug.
- **Document capabilities, not every behavior.** The README covers what a reader needs in order to use a feature, not every small automatic behavior or bit of interface polish. A selection that follows the active editor, a panel that reopens after a window reload, a card that rises to the front on drag: these are obvious in use, so they earn no line. Before adding a sentence, ask whether a reader would miss something without it, and if not, leave it out.
- **Edit in place, do not append.** When a section becomes wrong, rewrite it. Do not add a new paragraph below the old one, do not leave the old wording with a note that it has been superseded, do not stack "Update:" prefixes. The reader should see one coherent description, not an archaeology of past states.
- **No history, no narrative.** No "previously we did X", "this used to live at Y", "as of November we switched to Z". `git log` is the log; the doc states only what is true today.
- **Restructure when sections grow.** If a section starts straddling two concerns, split it. If two sections cover overlapping ground, merge them. The structure is part of the content; let it move.
- **Keep prose skimmable.** Prefer short paragraphs of one or two sentences, or a bullet list, over a dense block a tired reader has to wade through. When a paragraph piles several distinct points together (every gesture a card supports, every place a command lives), split them into bullets. A sustained single explanation may run longer, an enumeration may not.
- **Re-read before finishing.** Before closing out any non-trivial change, re-read this file and `README.md` end-to-end and fix anything that is now wrong, redundant, or misleading.

## Useful commands

All commands run from the project root.

```bash
npm install          # one-time
npm run build        # esbuild bundle: extension into dist/, template webview into media/template/
npm run watch        # rebuild on change, leave running during F5 debug
npm run vsix         # produce a local .vsix for sideloading
npm run publish      # publish to the VSCode Marketplace via vsce
```

To launch the extension, open this folder in VSCode and press **F5**. That opens an Extension Development Host window with the extension loaded. **Ctrl+R** inside that window reloads after a rebuild.

## Code style

Every decision here is in service of two goals: a new reader can open any file and understand it in under a minute, and any module can be moved, replaced, or deleted without rippling through the rest of the codebase. The conventions below apply to all TypeScript source, webview HTML / CSS / JS, and JSON manifests in this repo.

### General principles

- Readability beats cleverness. If a junior engineer would need to pause to parse it, rewrite it.
- DRY, but not prematurely. Two similar code paths are fine; three is the point at which extraction is justified.
- Modularity by feature, not by layer. Each surface (`vault`, `template`, `visual`, `skills`, `prompts`, etc.) owns its own commands, providers, views, and helpers in its own folder.
- Reconsider file and folder structure on every meaningful change. If a new function does not have an obvious home, the structure is wrong, not the function. Move things, rename folders, split a file once it has grown to cover more than one concern. Treat ~200 lines as a prompt to check whether that has happened, not a hard cap. A single cohesive file may run well past it when splitting would only scatter one concern across two, so split by concern, not by line count.
- No half-finished implementations. If a command is wired up, every code path off it must work or be visibly disabled.
- No speculative abstractions. Build for the features listed in the README, not for hypothetical future ones.
- Never add error handling, fallbacks, or validation for cases that cannot occur. Trust internal callers; validate only at the system boundary (filesystem I/O, VSCode API responses, webview messages from the renderer).

### File and folder structure

- Three roots, split by build target. `src/` is extension-host source (node): `src/extension.ts` for `activate` / `deactivate`, `src/<feature>/` for each feature folder (commands, providers, views, services that belong to that feature). `webview/` is browser source, one folder per webview, with its own `tsconfig.json` (DOM types, no node types). `media/` is only what a webview loads at runtime: HTML, CSS, icons, fonts, and built bundles. Keep build inputs out of `media/`, it is the extension's `localResourceRoots` and everything in it ships.
- One folder per feature surface. The folder, its commands, its providers, and its services live together.
- Generic, stateless, domain-agnostic helpers go in `src/common/utils/` (parsing, formatting, path builders, filesystem predicates, etc.). Placement here is by nature, not usage count: a helper with no domain meaning belongs in `utils/` even when only one feature uses it today.
- The rest of `src/common/` holds shared infrastructure with state (the vault root resolver, file watcher, settings reader, the `config.yml` metadata store) and shared domain types. Resist putting anything there until it is imported by at least two feature folders.
- A webview has up to three parts: the host that opens the panel and brokers messages in `src/<feature>/`, the markup and styles it loads from `media/<feature>/`, and, when it needs one, a bundled script whose source is `webview/<feature>/`. Styles and scripts shared by more than one webview live in `media/common/` (the color palette, the context menu), mirroring `src/common/`.
- A webview earns a bundle only when it needs a real dependency. Simple renderers stay plain committed JS in `media/<feature>/` (the trees, the canvas). The template editor is the one bundled webview today: `webview/template/` holds `main.ts` (the entry), `livePreview.ts` for the inline markdown styling, `codeHighlight.ts` for fenced-code languages and token colors, `listIndent.ts` for tab and shift-tab on bullets, and `fileMentions.ts` for the `@` path popup and the tint on a resolved mention. esbuild bundles it to `media/template/template.js`, gitignored and rebuilt like `dist/`. To add another, drop a `webview/<feature>/main.ts` beside it and add one build config in `esbuild.js`.
- No `utils.ts`, `helpers.ts`, or `misc.ts`. If a helper does not have a specific name, it does not have a clear purpose. `src/common/utils/` is the *folder* for purpose-named helpers (`parse.ts`, `format.ts`, `paths.ts`); each file inside still earns its name.
- No barrel `index.ts` re-exports to "flatten" import paths. The path reflects the structure; do not hide it.

### Naming

- Use full, descriptive names. `noteId` not `nid`, `pendingDocuments` not `pd`, `failedDriveSyncs` not `errs`.
- Single-letter names are permitted only for tight loop indices (`for (let i = 0; ...)`) and standard math conventions (`x`, `y` for coordinates).
- Functions are verbs, variables are nouns: `fetchNote`, `renderVaultTree`, `wikilinkMatch`.
- Booleans read as predicates: `isVisible`, `hasPendingEdits`, `shouldRefresh`.
- Avoid generic names: no `data`, `info`, `result`, `tmp`, `temp`, `obj`, `item`, `value` unless the surrounding context makes the meaning unambiguous.
- File names are camelCase for modules (`vaultManager.ts`, `wikilinkCompletion.ts`). Classes and types inside are PascalCase (`VaultManager`, `NoteIndex`). Constants are `SCREAMING_SNAKE_CASE` only for true compile-time constants; otherwise camelCase.

### Functions and modules

- A function does one thing. If you need the word "and" to describe it, split it.
- Aim for functions under 50 lines. A function over 80 lines is a signal to extract.
- Prefer explicit parameters over options-bag objects you only destructure once. The reader should be able to see what a function takes without chasing a chain.
- **Module order is imports to types to helpers to services / exports**, top to bottom. A reader scrolling down the file meets every building block before the wiring that uses it; jumping from a helper definition to its caller is always a forward scroll.
  - *Imports* sit at the top, in the standard / third-party / local groups described under Imports below.
  - *Types* are interfaces, type aliases, module-level constants, and any other static definitions the rest of the file references.
  - *Helpers* are anything called by the services below them: private functions, small utilities, query-shape builders, formatters. Each helper carries at least one leading comment that states what it does in one line; a reader scanning only the helper comments should be able to navigate the file.
  - *Services / exports* are the public functions or classes the rest of the extension reaches for.
  - Mark the boundaries with hairline divider comments when the file has more than a handful of helpers (`// --- helpers ---`, `// --- exports ---`).
  - Do not zigzag: helpers must not appear *between* or *after* services. If you find yourself adding a helper next to its caller, move it up into the helpers block.
- A helper used by only one class goes inside it as a `private` method (`private static` if a static factory needs it), not a module-level function.
- No one-line pass-through wrappers. `export function listTitles(): string[] { return index.titles(); }` is noise; the caller can call `index.titles()` directly. Wrappers are only justified when they *do work* (compose, transform, build a typed shape, union multiple sources). If the body is one return statement, delete the wrapper and update its callers.

### Spacing inside functions

- Separate logical groupings inside a function body with a blank line. The reader's eye uses the blank to chunk the function: "fetch the rows", then "build the lookup", then "gap-fill", then "return". Without the blank, all the lines blur into one wall of statements and the structure has to be reverse-engineered.
- A logical grouping is one of: a multi-line statement, a `try`/`catch` block, an accumulator pattern (`const out: T[] = []` immediately followed by the `for` that fills it; the init line stays glued to its loop), an `if`/`for`/`while` block, a related cluster of one-liners that compute one named thing, or a trailing `return`.
- Comments stay glued to the block they describe; the comment leads the block, no blank between. An early-return guard (`if (!x) return ...`) is followed by a blank before the rest of the function continues.
- Do not over-fragment. A run of one-liners that all serve the same purpose (destructuring fields from one object, computing related percentages from the same denominator) is one block, not five. Use blanks to chunk the function into "what it's doing now" sections, not to space every assignment.

### Loops over chained array methods

- Prefer plain `for` / `for...of` loops over chained `.map().filter().reduce()` pipelines when the chain has more than one step, builds a non-trivial shape, or carries logic the reader needs to follow line by line. Build the result with a named accumulator and `.push()` / `[key] = value` so the reader follows the data top-to-bottom.
- A chain forces the reader to parse the *output* expression before the *iteration* that produces it, in reverse of how the code executes. The cognitive cost is not paid back by the saved line.
- Trivially short single-step expressions like `notes.map((n) => n.id)` or `notes.filter((n) => n.isPinned)` are fine; the threshold is when chains start carrying real logic or a `.reduce` callback.
- Loop counterpart for the patterns that show up most often:
  - `const ids = notes.filter(p).map(f)` becomes `const ids: string[] = []` then `for (const n of notes) { if (p(n)) ids.push(f(n)); }`.
  - `const byId = notes.reduce((acc, n) => ({ ...acc, [n.id]: n }), {})` becomes `const byId: Record<string, Note> = {}` then `for (const n of notes) { byId[n.id] = n; }`.

### Types and data shapes

- Type annotations on every exported function signature. Inferred return types are fine for non-exported helpers when the body makes the type obvious.
- Prefer named `interface` or `type` aliases for in-memory shapes; do not pass around inline anonymous object types with implicit fields.
- No `any` unless you are at the boundary of an untyped library, and add a comment explaining why. Prefer `unknown` plus a narrow when you need to defer typing.
- No inline annotations on local variables when the right-hand side already pins the type. `const items: Note[] = await loadNotes()` is noise; `const items = await loadNotes()` reads the same. Annotate empty initializers (`const out: string[] = []`), narrowed locals, and boundaries (function signatures, interface fields, module-level constants).
- `readonly` and `as const` are preferred for data that does not mutate; do not reach for them on locals that obviously never escape the function.

### Comments

The single most important rule in this section: **the code is the explanation; a comment is at most a one-line label on a block.** A reader who knows the language and the domain should be able to read the function top-to-bottom and understand it without the comments. Comments exist to chunk the function visually and to flag the rare non-obvious *why*; they do not exist to teach the reader what the next three lines do, why this approach was chosen over an alternative, what the upstream system's quirks are, or what the history of the code is. If you find yourself writing a third comment line on one block, the code is wrong or the explanation belongs in `AGENTS.md` / `README.md`, not glued to the function body.

**Hard limits.**

- **One line per comment block, full stop.** A comment block is a contiguous run of `//` lines (or one `/* ... */` block). Two lines is the absolute maximum and only justified when one line genuinely cannot fit the label. Three or more is a bug. Subtle code that needs paragraphs of comment is code that needs to be rewritten or documented in the AGENTS.md section that owns the concept.
- **JSDoc / TSDoc: forbidden by default.** Only add a doc block when the function's *contract* (what it returns under edge conditions, what it throws, an ordering or threading constraint the signature cannot express) is non-obvious from the name and signature. One sentence. If the doc restates the function name or describes the implementation, delete it. No `@param` / `@returns` ceremony when the types already say it.
- **Interface / class doc blocks: forbidden by default.** An `interface` or `class` with well-named fields is self-documenting. Add a one-sentence doc block only when the type represents a non-obvious concept (e.g. a discriminated-union sentinel) that the name does not convey.
- **No background, no history, no justification, no upstream-quirk essays in code.** If the *why* is load-bearing, write it once in AGENTS.md and let the code reference the concept by name (`// see AGENTS section on vault metadata`). If the why is not load-bearing enough for AGENTS.md, it does not belong in the codebase at all.
- **No "no/avoid/never X" rationale comments.** Do not explain why the code is *not* doing something. The reader is not arguing with you. State the current behaviour, not the rejected alternative.

**What a good comment looks like.**

```ts
// resolve known note titles first, fall back to filename stems for the rest
const resolved: Record<string, string> = {};
for (const link of links) {
  ...
}
```

One line. Labels the block. Does not restate the loop. A reader scrolling past sees "ah, this loop resolves the link targets" and moves on.

**Sentence shape inside a comment.** The one line is short, active, and reads like something a tired engineer typed, not like polished prose.

- **No semicolons in comments or doc blocks.** A semicolon joins two clauses into one sentence and reads as written-up prose. A tired engineer types a comma, a period, or splits into two short labels. The semicolon-joined two-clause shape `// [short fact]; [elaboration or caveat]` is the single most reliable AI fingerprint left in comments after the multi-line essays are gone; treat any `;` inside a `//` or `/* ... */` as a bug.

  ```ts
  // bad, semicolon-joined two-clause prose
  // group notes by folder; un-foldered notes fall through to root
  // open the webview; failure leaves the tree in place

  // good, comma, or drop the second clause, or two separate labels
  // group notes by folder, others fall through to root
  // open the webview (no-op on failure)
  ```

- **Active imperative, not passive declarative.** Comments describe what the code *does* in the imperative ("validate the path", "drop the entry", "load the cache"), or as a short noun phrase labelling the block ("idempotent write", "sort whitelist"). Avoid `must not`, `should not`, `needs to`, `is intended to`, `is responsible for`, `ensures that`, `is used to`, `is meant to`, `in order to`, `this is to`.

  ```ts
  // bad, passive declarative rule-statement
  // index failures must not block the tree render
  // this is to ensure stale entries are dropped before the new ones land

  // good, active imperative or noun-phrase label
  // stop index failures blocking the tree render
  // drop stale entries before the new ones land
  ```

- **Plain words, not jargon.** A comment has to land on the first read for someone who knows TypeScript but not this codebase. Skip abstract jargon (`round-trip`, `hydrate`, `reify`) and tangled relative clauses (`keys this build does not interpret`) in favour of the concrete action. If you have to read it twice, rewrite it.

  ```ts
  // bad, jargon plus a clause that needs a second read
  // round-trip keys this build does not interpret
  // hydrate the cache from the persisted snapshot

  // good, plain concrete action
  // keep any keys it does not use
  // load the cache from disk
  ```

- **Name the thing, not a vague stand-in.** When a comment refers to a parameter or value, call it what it is in the domain, not a cute or generic placeholder noun. The reader should not have to map "a metadata bag" back to the `NoteMetadata` it stands for.

  ```ts
  // bad, vague placeholder noun plus a redundant return branch
  // pull a finite stacking order out of a metadata bag, else undefined

  // good, names the actual value, the signature already carries the empty case
  // the stacking order saved in a note's metadata
  ```

If you are unsure, read the comment aloud. If it sounds like a sentence from a design doc, rewrite it as a fragment a person would jot on a sticky note.

**Other rules.**

- Comments explain *why* a block exists, or what it accomplishes at a higher level than the code itself. They never restate the code.
- Do not append the null/undefined return branch a signature already declares. A helper typed `: number | undefined` needs no trailing `// ..., else undefined` or `// ..., or null`. Name what it yields, the type carries the empty case. Mention the empty case only when *when* it happens is the non-obvious point (`// the visual block, or undefined if absent or malformed`).
- Comments stay glued to the block they describe (no blank line between the comment and its block; one blank line before the comment to separate it from the previous block).
- No "Label: explanation" format. Write `// validate the path` not `// Validation: validates the path`.
- No first-person plural ("we fetch", "we iterate"). Imperative or noun phrase only.
- Do not leave `TODO`, `FIXME`, or `XXX` markers in merged code. If it is worth flagging, it is worth a tracked issue.
- Before writing a comment, ask: would deleting it make the code harder to understand for someone who knows TypeScript and has read AGENTS.md? If no, delete it. The default is no comment.

### Imports

- Standard / built-in (`node:fs`, `node:path`), then third-party (`vscode`, `gray-matter`), then local (`./...`, `../...`) - separated by a blank line, alphabetized within each group.
- No wildcard `import * as X` unless the namespace import is the documented usage (`import * as vscode from 'vscode'`, `import * as path from 'node:path'`).
- Prefer named imports over default imports for local modules; defaults make rename refactors and find-usages noisier.
- No re-exporting from a barrel `index.ts` to "flatten" the import path. The path reflects the structure; do not hide it.

### VSCode extension specifics

- All command, view, and configuration declarations live in `package.json` under `contributes`. Adding a feature means editing both the manifest and the source in the same commit.
- Register commands, providers, and disposables inside `activate(context)` and push every disposable onto `context.subscriptions`. Never instantiate VSCode-API consumers at module load time.
- Routes are thin: a command handler parses the trigger context, calls a service in `src/<feature>/`, and dispatches the result back through the VSCode API. Business logic does not live in command handlers.
- Webview message handling is the same pattern: the host validates the incoming message shape, calls a service, posts back a typed reply. The renderer (in `media/`) only renders and emits intent messages.
- Settings come from `vscode.workspace.getConfiguration('promptStudio')` at the boundary; pass plain values down. Do not read configuration from arbitrary call sites.
- Filesystem operations go through `vscode.workspace.fs` (URI-based, works across remote workspaces) rather than raw `node:fs`, unless the operation is specifically about the extension's own storage on the local disk.

### Avoiding common AI tells

These are stylistic patterns that read as machine-generated and undermine the architectural-precision feel of the project. Avoid them in code, comments, commit messages, and any prose written into the repo.

- **ASCII characters only.** No non-ASCII typographic characters anywhere in the repo, code or prose. A tired engineer types ASCII; smart-typography characters are an AI fingerprint. Forbidden characters and their ASCII replacements:
  - em dash and en dash -> comma, period, colon, or `-` / `--` where structurally needed
  - rightwards / leftwards / up / down arrows -> `->`, `<-`, `^`, `v` (or rephrase so no arrow is needed; in prose, "to" often reads better than `->`)
  - ellipsis -> three ASCII dots `...`
  - plus-minus -> `+/-` or `~`
  - greater/less-or-equal -> `>=`, `<=`
  - approximately equal -> `~=` or `~`
  - not equal -> `!=`
  - multiplication -> `x` or `*`
  - degree symbol -> `deg`
  - middle dot, bullet glyphs -> markdown `-` / `*` or a comma
  - section sign -> the word `section`
  - curly quotes -> straight `'` and `"`
  - copyright / trademark / registered -> `(c)`, `(tm)`, `(r)`
  - box-drawing characters for diagrams -> plain `|`, `-`, `+`, `>`, `v`
  - any other Unicode symbol -> spell it out in ASCII or rephrase
  - emoji of any kind anywhere

  This rule applies to TypeScript source, webview HTML / CSS / JS, JSON, YAML, Markdown docs, commit messages, and PR descriptions. Before committing, grep for non-ASCII (`rg --pcre2 '[^\x00-\x7F]' .`) and fix anything that surfaces.
- No "Label: explanation" comment format. Write `// validate the path before hitting the FS` not `// FS: validates the path before hitting the disk`. The capitalized prefix is a tell.
- No "Note that...", "It's worth noting...", "Keep in mind...", "Importantly,...". State the fact directly.
- No first-person plural narration in comments: no `// Here we fetch the note`, `// Now we iterate over the rows`, `// Let's parse the response`. Just describe what the block does, in the imperative or as a noun phrase.
- No filler adjectives that signal effort rather than meaning: avoid `robust`, `comprehensive`, `seamless`, `elegant`, `powerful`, `leverage`, `utilize` (use `use`), `facilitate`, `streamline`.
- No hedged language in code comments: no `might`, `perhaps`, `you may want to`, `it could be argued`. Comments should be assertions; if you are unsure, find out.
- No emojis anywhere - not in code, not in comments, not in commit messages, not in webview UI. Codicons (the VSCode icon font) are the only iconography permitted.
- No bold sub-headings inside bulleted lists in doc blocks or comments. The bullet itself is the structure.
- No trailing summary lines that restate what the function or block does. The code already says it.
- No references to the task that produced the code: do not write `// added for the visual mode rollout`, `// fix for ticket PM-1234`, `// part of phase 2`. That belongs in the commit message and rots when the code is moved.
- No change-narrative or justification comments. Write comments as if the code has always been this way: describe the *current* behaviour, never "this was added because of X", "previously this did Y", "we changed this so that...". Comments that read like a code-review reply (defending a choice against an alternative the reader never proposed) are the same anti-pattern. State the current flow plainly; the history lives in `git log`.
- No three-bullet executive summary at the top of files or PRs. If a section needs framing, write one sentence.
- No restating the prompt back at the reader. Doc blocks describe the function, not the engineering goal that motivated it.
- No "this is a simple..." or "this is a basic..." preambles. Just write the thing.

When in doubt, read the comment or sentence aloud. If it sounds like a polished assistant explaining its work, rewrite it as something a tired engineer would type at 4pm.

### Git commits

- Single-line commit messages in `<type>: <description>` format. Description is imperative mood, lowercase, no trailing period. Examples: `fix: rewrite incoming wikilinks on note rename`, `feat: add visual canvas pan controls`, `docs: refresh README to match config.yml format`.
- Allowed types:
  - `feat` -- new user-facing feature
  - `fix` -- bug fix
  - `refactor` -- restructuring without behaviour change
  - `perf` -- performance improvement
  - `docs` -- docs/comments only
  - `style` -- formatting/whitespace, no logic change
  - `test` -- adding or updating tests
  - `chore` -- tooling, deps, config, manifest plumbing
- Do not append `Co-Authored-By:` trailers (or any other "generated by" footer) to commit messages.

## Feature notes

What a surface does is in the README. This section holds the constraints behind it that the code cannot state for itself, so a comment can point here by name rather than carry an explanation inline. Everything below is load-bearing: change it and something breaks quietly.

### Workspace mentions

A relative `@path` in the template editor resolves against the first workspace folder, because that is the one directory Claude Code runs in. Extra roots are not offered: a path from the second root would not resolve for Claude anyway.

`src/template/mentionIndex.ts` scans that folder on startup, and again once a burst of file creates or deletes settles, and `TemplatePanel` posts the whole list to the webview. The renderer never queries the host per keystroke, because the tint has to answer "is this a real path" synchronously on every document change, so it needs the set locally regardless.

A leading slash (`@/home/`) browses the disk instead, which no index can cover, so `src/template/mentionFilesystem.ts` reads one directory per request and the editor asks for each level as the user walks down. The same file confirms the absolute paths already sitting in a note, since the tint cannot know they exist otherwise. Only the host touches the filesystem, the webview holds what it has been told.

The popup is CodeMirror's, restyled in `media/template/template.css` to match the VSCode suggest widget. Every rule there is prefixed with `.cm-editor` to reach the specificity of CodeMirror's own base theme, and the selected-row rule carries both `.cm-tooltip` and `.cm-tooltip-autocomplete` to outrank its light and dark variants. Drop a class from those selectors and the popup silently reverts to CodeMirror's colors.

### Editor selection

The template editor selects with the browser's native selection, not CodeMirror's `drawSelection()`. That extension paints the highlight into a layer *behind* `.cm-content`, so any opaque background on the content covers it, and a select-all leaves fenced code, inline code, and resolved mentions looking unselected. The native highlight paints above an element's background and below its glyphs, which covers all three at once.

Three rules in `media/template/template.css` hold it up, and the selection breaks if any of them goes:

- `.cm-editor ::selection` sets the background only, so the fenced-code token colors survive underneath it.
- `.cm-content` sets `caret-color`, since the caret is the browser's now and CodeMirror's base theme would otherwise force it black on a dark theme.
- `.cm-syntax` dims the markdown marks with a `color-mix` alpha rather than `opacity`. An `opacity` below 1 groups the span and composites its own selection background down with the glyphs, which notches the highlight at every `#`, `-`, `**`, and backtick.

The toolbar cancels its `mousedown` for the same reason: a click on Copy or Send would otherwise pull focus out of the editor, and the native highlight only stays lit while the editor holds focus.

### Webview fonts

VSCode hands `--vscode-editor-font-family` to a webview as the raw `editor.fontFamily` setting, which is often one bare family name (`IBM Plex Mono`). The editor itself appends the platform default stack behind it, a webview gets nothing. So when that font is not installed, Chromium falls back to its default *standard* font, Times New Roman, not to a monospace one.

Every webview rule that reads the var therefore carries a fallback stack outside it: `font-family: var(--vscode-editor-font-family, monospace), Menlo, Consolas, monospace`. The `monospace` inside `var()` only covers the variable being undefined, so it is the list after the `var()` that catches a missing font. The named families lead because an Electron renderer resolves the bare `monospace` generic to Courier New.
