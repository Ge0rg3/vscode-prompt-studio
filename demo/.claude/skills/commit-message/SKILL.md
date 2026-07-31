---
name: commit-message
description: Write a conventional commit subject line from the staged diff, without inventing scope
---

# commit-message

Read the staged changes first, then write the message. Never guess at the contents.

```bash
git diff --staged
```

1. Read the full staged diff. If nothing is staged, stop and say so.
2. Pick one type prefix from `feat`, `fix`, `refactor`, `docs`, `chore`. Choose by what the
   diff does, not by which files it touches. A rename that changes no behavior is `refactor`,
   a comment-only edit is `docs`.
3. Add a scope only when the diff is confined to one named module or directory that already
   exists in the tree. If the change spans several areas, drop the scope. Do not shorten,
   pluralize, or coin a scope name.
4. Write the subject as one imperative lowercase line under 72 characters:
   `type(scope): add retry to the upload queue`. No trailing period.
5. Leave the body empty. Add one only when the diff cannot explain its own reason - a
   workaround for an upstream bug, a revert, a deliberate performance tradeoff. Two or three
   lines at most, wrapped at 72.
6. Do not mention file names, line counts, or the number of files changed. The diff already
   carries that.
7. Print the message for review. Do not run `git commit` unless asked.

Leave the staged set alone. Do not stage, unstage, or edit files while writing the message.
