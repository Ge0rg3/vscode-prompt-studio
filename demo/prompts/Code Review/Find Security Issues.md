# Find Security Issues

Read {{file_path}} and look only for security problems. It is {{language}}. Use the usual traps for
that language.

Check for:

1. Input that reaches a query, a shell command, or an eval without being validated or parameterised.
   Trace where the value comes from.
2. Secrets in the source - API keys, tokens, passwords, connection strings, private URLs.
3. Paths built from user input that could escape the intended directory.
4. Handlers or routes that read or write someone's data without checking who is asking.

For each finding, give me the exploit path: what an attacker sends, which line takes it, and what they
get. "Possible SQL injection" on its own is not useful.

If the file is clean, say so and stop. Do not pad the answer with hardening suggestions I did not ask for.
