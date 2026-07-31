# JavaScript Review

Trace {{file_path}} from {{entry_point}} and find the bugs that only show up once the page has been open
a while.

1. addEventListener with no matching remove. Say what keeps the node alive and when it gets re-added.
2. A querySelector result used without a null check - the markup shifts and the handler dies quietly.
3. State read back out of the DOM: a class name, a data- attribute, or textContent standing in for the
   variable that should own it.
4. await inside a for loop where the calls do not depend on each other. Those want Promise.all.
5. A scroll, resize, input, or mousemove handler doing layout reads or a fetch on every single event.

```js
for (const id of ids) {
  const user = await fetchUser(id);
  document.querySelector('#list').append(row(user));
}
```

Give me the fix as a snippet the size of a diff hunk, not a rewrite. If a listener is fine because the
element lives as long as the page, say that and leave it alone.
