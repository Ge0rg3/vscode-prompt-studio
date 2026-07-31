# Review Past Prompts

Go through every note in {{folder_path}} and tell me which ones are dead weight. Read them all first,
then answer in one pass.

1. Duplicates. Two notes asking for the same thing in different words - name the pair and say which one
   to keep.
2. Stale. Any prompt naming a file, command, or convention that no longer exists in {{codebase_name}}.
   Quote the line that is wrong.
3. Mergeable. Prompts that differ by one detail only and could be a single note with that detail pulled
   out into a variable.
4. Vague. Anything that would give a different answer on every run because it never says what to
   produce.

For each one give me the file name, the problem in a sentence, and the edit you would make. Do not
rewrite anything yet.

Leave the short ones alone. A four line prompt that still works is not a problem.
