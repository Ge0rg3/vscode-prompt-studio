---
name: new-section
description: Add a section to a page, matching the markup and CSS conventions already used in this project
---

# new-section

Read an existing section in `index.html` before writing anything and copy its shape. The pattern
is the same across every section on the site, and a new one that invents its own is wrong.

1. Pick the closest existing section and match it element for element - same nesting, same
   heading level, same class naming.
2. Wrap the content in `section.<name> > div.container`. The section carries the name. The
   container holds the width. Nothing sits directly on the section.
3. Open the container with an `<h2>`. Sections never start with an `<h1>`.
4. Give the section an `id` matching its class when the nav needs to link to it.
5. Add the rules to `css/styles.css` in the same order the markup appears. A section sitting
   between the hero and the features gets its rules between theirs. Do not append at the end.
6. Reuse the custom properties declared in `:root` for colour, spacing, and radius. Typing a raw
   hex value or a pixel gap means the token you want already exists and you missed it.
7. Put the responsive rule inside the media query already at the bottom of the file. Do not open
   a second one.
8. If the section belongs in the nav, add the link to `index.html` and `about.html` both.

```html
<section class="pricing" id="pricing">
  <div class="container">
    <h2>Pricing</h2>
    <p class="section-intro">One plan, billed yearly.</p>
    <ul class="pricing-list">
      <li class="pricing-item">Unlimited notes across every device</li>
    </ul>
  </div>
</section>
```

Leave the other sections, the `:root` block, and `js/main.js` alone. If the section needs
behavior, follow the event listener pattern already in `main.js` rather than an inline handler.
