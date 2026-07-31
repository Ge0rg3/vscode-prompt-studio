// Aurora - mobile navigation for the marketing site.
(function () {
  "use strict";

  const nav = document.querySelector("#site-nav");
  const toggle = document.querySelector("#nav-toggle");

  // A page without both elements gets no behaviour rather than an error.
  if (!nav || !toggle) {
    return;
  }

  // Route every state change through here so the class and the ARIA state cannot drift apart.
  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };

  // The button flips whichever state the nav is currently in.
  toggle.addEventListener("click", () => {
    setOpen(!nav.classList.contains("is-open"));
  });

  // Following a link should not leave the open menu covering the page it lands on.
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      setOpen(false);
    }
  });

  // Escape closes the menu from anywhere on the page.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
    }
  });

  // Start closed so the markup and the ARIA state agree on first paint.
  setOpen(false);
})();
