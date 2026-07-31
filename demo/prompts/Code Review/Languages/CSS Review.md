# CSS Review

Read {{file_path}} for the rules that cost someone an hour later. The layout has to hold down to
{{breakpoint}}.

- A hex or rgb() written inline that duplicates a value already sitting in a custom property.
- Specificity climbing: a selector that only wins by stacking a class or an id in front of an earlier
  rule. Count every !important.
- The same pixel value in three places with no name on it - that is a token nobody wrote down.
- Two media queries both true at one width, where the winner is whichever came last in the file.
- Fixed heights and nowrap that break the moment a label runs long or gets translated.

```css
.card { padding: 24px; height: 96px; }
@media (max-width: 720px) { .sidebar .card { padding: 24px; } }
```

Name the line and say what the page does when it goes wrong - text overflowing, a column squashed, a
colour drifting off the palette. Rules that are only redundant go in one list at the end.
