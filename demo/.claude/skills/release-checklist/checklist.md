# Release checklist

1. Working tree is clean and rebased on `main`.
2. Typechecks pass with `npm run typecheck`.
3. Test suite passes with `npm test`.
4. Version bumped in `package.json` and the lockfile.
5. Changelog written from the commit range since the last tag.
6. Release commit created with the bump and changelog together.
7. Tag created and named `vX.Y.Z`.
8. Artifact built with `npm run package`.
9. Artifact installed from the file and smoke-tested in a clean window.
10. Published, then the tag pushed with `git push --follow-tags`.

Tick the steps in order. Stop at the first one that fails and fix it before
moving on.

To back out an unpushed release, drop the tag with `git tag -d vX.Y.Z` and
reset the release commit.
