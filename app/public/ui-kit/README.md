# OpsLab UI kit

This folder packages the OpsLab visual language as framework-free, reusable CSS.

## Use it

Copy `opslab-ui.css` into a project and load it after any reset stylesheet:

```html
<link rel="stylesheet" href="/ui-kit/opslab-ui.css">
```

Add `ops-theme` to the page root, then compose the prefixed primitives:

```html
<body class="ops-theme">
  <article class="ops-card ops-card--lifted">
    <header class="ops-card__header">
      <h2 class="ops-heading">Service health</h2>
      <span class="ops-badge ops-badge--success">Healthy</span>
    </header>
    <div class="ops-card__body">Everything is operational.</div>
  </article>
</body>
```

## Customize it

Override tokens in a stylesheet loaded after the kit:

```css
:root {
  --ops-accent: #7cf5ff;
  --ops-paper: #f7f7f2;
  --ops-page-width: 1440px;
}
```

Useful primitives include `ops-container`, `ops-section`, `ops-stack`,
`ops-cluster`, `ops-grid`, `ops-card`, `ops-button`, `ops-badge`, form fields,
`ops-table`, `ops-terminal`, `ops-progress`, and the typography classes.

## Style rules

- Use acid green for the primary action or current state, not everywhere.
- Keep corners square and hierarchy structural: borders, spacing, and type scale.
- Pair Manrope display/body text with DM Mono metadata and technical values.
- Use offset shadows only on high-priority interactive surfaces.
- Always pair status color with a label or icon.
- Respect reduced-motion preferences and visible keyboard focus.

The live gallery is available at `/ui-kit` while the app is running.
