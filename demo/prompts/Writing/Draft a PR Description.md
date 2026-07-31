# Draft a PR Description

Write the description for `{{branch_name}}` from the commits below. Lead with what changed and why, in
three sentences at most. Everything else goes under headings after that.

```
{{commit_log}}
```

Include:

- **Why** - the problem this branch fixes, not a restatement of the diff.
- **Look at first** - the one or two files where the real decision was made.
- **Left out** - anything I deliberately did not do here, and where it should happen instead.

Don't list every commit. Fixup and rebase noise should not appear at all. If two commits undo each other,
describe the end state only.

Where the commits don't tell you the reason for a change, say so instead of inventing one.
