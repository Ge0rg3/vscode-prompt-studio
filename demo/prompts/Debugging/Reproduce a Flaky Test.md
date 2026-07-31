# Reproduce a Flaky Test

{{test_name}} fails about {{failure_rate}} of runs and passes on a retry. Find the nondeterminism before
you touch the assertion.

Check these in order and tell me which one it is:

- State left behind by an earlier test - module globals, a shared fixture, rows never rolled back.
- Real clocks. Anything reading now(), sleeping, or comparing timestamps across a second boundary.
- Ordering assumptions on a dict, set, or query with no ORDER BY.
- Work that was started and never awaited - on a fast machine the assertion runs first.

Then give me the smallest change that makes it fail every single time - a forced ordering, a pinned clock,
a sleep in the right place. I want a reliable red before a fix.

If none of the four fit, say so and tell me what to log on the next failing run.
