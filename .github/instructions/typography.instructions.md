---
applyTo: "front/src/**/*.tsx"
description: 'Legacy @filigran/ui typography (txt-* classes) for existing surfaces; FDS surfaces use the Text component instead. Never Tailwind text-* size classes.'
---

<!-- Generated from .agents/instructions/typography.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

# Typography (legacy `@filigran/ui` surfaces): `txt-*` Utility Classes

**Scope**: surfaces still styled by the legacy `@filigran/ui` library, which is most of the existing app. Surfaces built on `@filigran/design-system` (FDS) use the FDS `Text` component instead; read its variant list from the design system, per [Design System routing](.github/instructions/design-system.instructions.md). The rules below stay mandatory wherever `@filigran/ui` powers the surface.

The legacy surfaces use custom typography utility classes provided by `@filigran/ui`'s CSS. **Never use Tailwind's native `text-sm`, `text-base`, `text-lg`, `text-xl`, etc. to control font size or font family.** Always use the `txt-*` classes below.

The `txt-*` classes are defined in `@filigran/ui/index.css` and made available via `@reference '@filigran/ui/index.css'` in `styles.css`. Do not re-declare them locally.

## Class Reference

| Class | Size | Weight | Font | Notes |
|---|---|---|---|---|
| `txt-jumbo` | 2.5rem | — | Geologica | Hero/landing headings only |
| `txt-title` | 1.375rem | 400 | Geologica | Page-level title — applied to `h1` by default |
| `txt-subtitle` | 1rem | 500 | Geologica | Section title — applied to `h2` by default |
| `txt-subtitle2` | 1.125rem | 400 | Geologica | Alternative subtitle variant |
| `txt-category` | 0.875rem | 600 | Geologica | Category labels, section headers |
| `txt-tab` | 0.875rem uppercase | — | Geologica | Tab labels |
| `txt-h3` | 0.8125rem | 400 | Geologica | Heading level 3 variant |
| `txt-h4` | 0.75rem | 500 | IBM Plex Sans | Heading level 4 variant |
| `txt-h5` | 1rem | 700 | Geologica | Heading level 5 variant |
| `txt-container-title` | 0.75rem uppercase | — | IBM Plex Sans | Table headers, panel/card column titles |
| `txt-default` | 0.9rem | — | IBM Plex Sans | Body text — applied to `<p>` by default |
| `txt-body2` | 0.8rem | — | IBM Plex Sans | Compact body text variant |
| `txt-sub-content` | 0.75rem | — | IBM Plex Sans | Secondary/supporting text inside content areas |
| `txt-table` | 0.8125rem | — | IBM Plex Sans | Table cell text (already applied by `Table` component) |
| `txt-mini` | 0.5625rem | — | IBM Plex Sans | Badges, micro labels |

> `h1` → `txt-title`, `h2` → `txt-subtitle`, `p` → `txt-default` are set globally in `styles.css`. No class needed on those elements unless overriding.

## Rules

1. **Use semantic HTML tags** matched to the visual role:
   - Page/section title → `<h1>` / `<h2>` (styled automatically)
   - Body copy, descriptions → `<p>` (styled automatically)
   - Supporting info, sub-labels → `<p className="txt-sub-content">` or `<span className="txt-sub-content">`
   - Category name, bold group header → `<span className="txt-category">`
   - Tab label → `<span className="txt-tab">`
   - Table/panel column header → element with `txt-container-title`

2. **Do not add `txt-default` to `<p>` elements** — it is already the default.

3. **Never use Tailwind text-size classes** (`text-sm`, `text-xs`, `text-base`, `text-lg`, `text-2xl`, …) for typography. These classes conflict with the design system and must be replaced by the appropriate `txt-*` class.

4. **`font-bold`, `font-medium`, etc. may be combined** with `txt-*` classes when a weight variant is needed, but the size/family must always come from a `txt-*` class.

5. **`text-muted-foreground`, `text-primary`, etc.** (color utilities) are fine to combine with `txt-*` classes.

## Code Review Checklist

When reviewing frontend code, flag the following as bugs:

- [ ] Any use of `text-sm`, `text-xs`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl` on a non-component element
- [ ] Any use of `font-size` inline styles that should be a `txt-*` class
- [ ] A `<div>` or `<span>` used as a text container when a `<p>` would be semantically correct
- [ ] `txt-default` applied explicitly to a `<p>` (redundant)
- [ ] Missing `txt-sub-content` on secondary/supporting text that currently has `text-xs` or `text-sm`
- [ ] `txt-container-title` missing on panel column headers or table `<th>` content

## Examples

```tsx
// ✅ Correct
<h1>Page Title</h1>                                    // txt-title applied automatically
<h2>Section</h2>                                       // txt-subtitle applied automatically
<p>Some description text.</p>                          // txt-default applied automatically
<p className="txt-sub-content">Supporting detail.</p>  // smaller secondary text
<span className="txt-category">Risk</span>             // bold category label
<span className="txt-tab">Overview</span>              // tab label
<span className="txt-container-title">Name</span>      // table/panel column header

// ❌ Wrong — replace with txt-* classes
<p className="text-sm">Some description text.</p>
<span className="text-xs text-gray-500">Supporting detail.</span>
<div className="text-base font-bold">Risk</div>
```
