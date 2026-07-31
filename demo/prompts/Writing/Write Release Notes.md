# Write Release Notes

Turn the commits between `{{previous_tag}}` and `{{current_tag}}` into notes a user can read. Group them
by what someone notices when they upgrade:

- **New** - things they can now do.
- **Fixed** - things that used to go wrong for them.
- **Changed** - behaviour that moved, including anything they have to redo.

Rules:

1. Name the behaviour, not the code. "Search now matches folder names" beats "refactor SearchIndex".
2. Drop CI, test, dependency bump, and internal refactor commits unless a user would feel them.
3. One line each. No commit hashes, no PR numbers.
4. Put anything breaking at the top of Changed, with what to do about it.

If a commit message is too thin to tell what the user gets, list it at the bottom under "needs a line
from me" and leave it out of the notes.
