# Explain a Stack Trace

Read the stack trace below and tell me what actually went wrong, in plain language, before suggesting a fix.

```
{{stack_trace}}
```

Work through it in this order:

1. Name the line that threw, and what it was trying to do.
2. Walk back up the frames to the first one in our own code, at {{repo_path}}.
3. Say which of the arguments or state at that point could produce this.

Skip the frames inside libraries unless one of them is the actual cause. If the trace is truncated, say
what you would need to see.
