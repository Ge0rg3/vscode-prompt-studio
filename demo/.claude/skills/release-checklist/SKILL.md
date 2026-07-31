---
name: release-checklist
description: Walk the pre-release steps in order and stop at the first one that fails.
---

# release-checklist

Read `checklist.md` in this folder and work through it top to bottom. Stop at the
first step that fails and report what broke - do not skip ahead or fix later steps
out of order.

1. Confirm the working tree is clean. Run `git status --porcelain` and refuse to
   continue if it prints anything.
2. Run the typechecks and the test suite. Both must pass with no warnings that
   were not already on `main`.
3. Bump the version. Patch for fixes, minor for new commands or settings, major
   only when a setting or command is removed.
4. Update the changelog from the commit range since the last tag. Group entries
   under Added, Changed, and Fixed. Drop chore and docs commits.
5. Commit the bump and changelog together, then tag and push.

```bash
git status --porcelain
npm version patch -m "chore: release v%s"
git push origin main --follow-tags
```

Leave the build config, the publisher id, and anything under `media/` alone. If
the changelog range is empty, say so and stop rather than tagging an empty release.
