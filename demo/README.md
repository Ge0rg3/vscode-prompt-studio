# Aurora

The marketing site for Aurora, a fictional note-taking app. Two static pages, one stylesheet, and a small script for the mobile nav.

```
index.html      landing page
about.html      who built it
css/styles.css  tokens, components, one breakpoint, a dark mode block
js/main.js      mobile nav toggle
```

Open `index.html` in a browser. There is no build step.

## Using this for screenshots

This folder is the demo project behind the screenshots in the extension's [README](../README.md). Open **this folder** as the VSCode workspace, then set the vault to `prompts` through **Configure Vault > Folder inside this workspace**.

That fills both sidebar sections at once:

- **Vault** shows `prompts/`, with `Main` and `Review Past Prompts` at the root and five folders under them. Colors and card positions come from `prompts/config.yml`.
- **Claude Skills** shows the four skills in `.claude/skills/`, three of them tinted from `.claude/skills/config.yml`.

Notes worth knowing before shooting:

- Card titles come from each note's first heading, and the canvas layout lives in `prompts/config.yml`. Commit it, or a drag is lost and the next shoot starts over.
- `Main` is the one to open in the template editor. It has a heading, bold text, a list, an inline code span, a link, and a fenced block.
- `Code Review` holds a `Languages` folder, so a folder card previews a folder that previews its own notes.
- Some notes and one skill are left uncolored, so a screenshot catches the plain state next to the tinted one.
- `demo/` is in [.vscodeignore](../.vscodeignore), so none of it ships in the `.vsix`.
