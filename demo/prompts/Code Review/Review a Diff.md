# Review a Diff

Review the diff below from {{branch_name}} and tell me what is wrong with it. Assume the change compiles
and the tests pass.

```diff
{{diff}}
```

Go in this order:

- Correctness. Does the new code do what the surrounding code expects of it? Check the return values and
  the error paths, not just the happy path.
- Edge cases. Empty input, a null where the old code had a default, off-by-one on any new loop or slice,
  and anything that changes behaviour on the first or last iteration.
- Naming. Flag any name that describes the implementation instead of the meaning, or that now contradicts
  what the function does after this change.

Skip style nits. No formatting, no import order, no comment wording, no opinions about line length -
the formatter already ran.

If a line looks wrong but you need the caller to be sure, say which file you want to see.
