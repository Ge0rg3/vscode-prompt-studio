# Trace a Performance Regression

Something between {{good_ref}} and {{bad_ref}} made {{endpoint}} slower. Narrow it down from the numbers,
not from reading the diff and guessing.

Start with the timing I have:

```bash
git checkout {{good_ref}} && hyperfine --warmup 3 'make bench'
git checkout {{bad_ref}}  && hyperfine --warmup 3 'make bench'
```

Then:

1. List the commits in the range that touch code on this path. Ignore tests and docs.
2. For each one, say in a sentence whether it could plausibly cost time, and where - an extra query, a
   copy that used to be a reference, a cache that stopped being hit.
3. Rank them, and pick the bisect point that splits the suspects rather than the commit count.

If the numbers overlap within noise, say the measurement is not good enough yet and tell me what to
measure instead.
