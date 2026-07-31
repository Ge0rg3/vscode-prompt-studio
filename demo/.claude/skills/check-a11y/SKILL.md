---
name: check-a11y
description: Audit a page for accessibility failures and report the failing selector with its fix
---

# check-a11y

Read `index.html` and `about.html` together in the same pass. They share the header and nav. A
fix to the header has to land in both files or it is not fixed.

1. Images. Every `<img>` needs an `alt`. Decorative art gets `alt=""`. A content image gets a
   short sentence carrying the same information as the picture. A filename is not alt text.
2. Headings. One `<h1>` per page, then no skipped levels - an `<h2>` cannot be followed by an
   `<h4>`. Read the order in the source, not the rendered sizes.
3. Controls. Every button, link, and input needs an accessible name. An icon-only button needs
   an `aria-label`. An input needs a `<label for>` pointing at its `id`.
4. Contrast. Body text and link text must reach 4.5 to 1 against the background behind them.
   Resolve the custom property to its hex value before comparing, and check hover states too.
5. Focus. Tab the page in source order and confirm that order matches the visual order. Every
   focusable element needs a visible ring. If a rule drops `outline`, something must replace it.
6. The nav toggle. Its `aria-expanded` must match the open state at all times - `false` on load,
   flipped by the same handler that adds or removes the open class. Setting only the class fails.

Report each failure as the failing selector, the rule it breaks, and the exact replacement markup
or CSS. One line each. Put the blocking failures - missing alt, missing name, contrast - first.

```html
<!-- before: icon-only button, no name, state never announced -->
<button class="nav-toggle">
  <span class="bar"></span>
</button>

<!-- after -->
<button class="nav-toggle" aria-label="Menu" aria-expanded="false" aria-controls="site-nav">
  <span class="bar" aria-hidden="true"></span>
</button>
```

Change only what a named failure requires. Do not restyle the page, rename classes, or edit the
copy.
