# Plan a Migration

Get us from {{from_system}} to {{to_system}} without a cutover weekend. Assume we ship every day and
cannot stop.

Give me numbered steps. Each step must be shippable on its own and safe to leave in place for a month.
For every step, tell me:

1. What changes, and what stays untouched.
2. Whether both systems are running at once here, and which one is the source of truth.
3. How I verify it worked in production - a query, a metric, a log line.
4. How I roll it back, and how long the rollback stays available.

Call out the step where the source of truth flips. That is the one that scares me. Say what has to
be true before we do it.

If any step cannot be reversed, mark it and explain why.
