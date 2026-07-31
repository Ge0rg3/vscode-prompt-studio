# Main

Prompts I reuse. If I have typed it out twice, it belongs in here.

## Folders

- **Architecture** - tradeoffs between two designs, where a new module should live.
- **Code Review** - diff reviews and the checks I want run before I push.
- **Debugging** - stack traces, flaky tests, things that worked yesterday.
- **Refactoring** - splitting files, moving logic out of handlers, renames.
- **Writing** - commit messages, changelogs, replies on issues.

## House rules

- Name a variable after the thing that changes. `{{file_path}}` beats `{{input}}` every time.
- One prompt, one job. If it needs an "and then", it is two prompts.
- Paste the code in. Describing it gets me an answer about code the assistant never saw.

Every month or so I run [Review Past Prompts](<Review Past Prompts.md>) over the folders and throw out
whatever has gone stale.

## Starting a new prompt

```text
Read {{file_path}} and {{task}}. Show me the diff before you touch anything else.
```
![prompt-flow](.attachments/prompt-flow.svg) ![folder-map](.attachments/folder-map.svg)
