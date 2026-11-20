---
applyTo: "front/src/**/*.{tsx,css}"
description: 'Design system routing: where to read Filigran Design System (FDS) tokens and component contracts. Never state a design value from memory.'
---

# Filigran Design System (FDS) Routing

The visual reference for all new UI and design work is `@filigran/design-system` (FDS),
the design system shared across Filigran products (OpenCTI, OpenAEV, OpenCRQ, XTM One,
XTM Hub). `@filigran/ui` is the legacy library: it still powers most existing surfaces,
but it is on its way out.

This document intentionally contains **no design values**. Colors, typography, radii,
spacing, component variants: every value lives in the design system's own generated
artifacts and is read from there at the moment it is needed. Never state a design value
from memory, and never invent one. A value copied into a local document is stale the day
the design system moves.

## Where to read the design system

Two read modes, chosen by purpose.

### Release-accurate: what the app actually renders

The product depends on a published FDS version from the public npm registry
(`front/package.json`, key `@filigran/design-system`). After `yarn install`, read from the
repo-root `node_modules/@filigran/design-system/`:

- `dist/tokens/theme.css`: every design token (color, typography, radius, spacing) at that
  version.
- `dist/meta.mjs` (types in `dist/meta.d.ts`): per-component machine contracts, importable
  as `@filigran/design-system/meta`: variants, sizes, accessibility contrast pairs, Figma
  node links.
- `dist/components/<name>/<Name>.mjs`: the component's own implementation, shipped unminified
  one module per component. It is the only place that states what a component actually paints
  per state, and the reference for any class string copied into product code.

Use this mode when implementing or reviewing product code.

### Fresh: the design system's current main

The source repo is `XTM-Foundation/filigran-design-system` (private, read it with `gh`):

- `llms.txt`: generated component and token index, the entry point
  (`gh api repos/XTM-Foundation/filigran-design-system/contents/llms.txt --jq .content | base64 -d`).
- `llms-full.txt`: full standalone context.
- `packages/filigran-design-system/src/components/<Name>/<Name>.meta.ts`: the full
  per-component contract.
- `packages/filigran-design-system/src/tokens/theme.css`: token source of truth.
- `process/PRODUCT-IMPLEMENTATION-PLAYBOOK.md`: adopting a library component in a product.
- `process/TOKEN-MIGRATION-GUIDE.md`: legacy token to FDS token mapping.

Use this mode for design research, UX specifications and mockups.

Figma (`Design_System_2026`) is the designers' source. Agents work from the repo
artifacts, which are generated from the same contracts and carry per-component Figma node
links in their `meta.ts`.

## Design research targets main, code targets the installed version

Design work (UX specs, DESIGN.md spines, HTML mockups and planches) is authored against
the design system's **main**, so it always reflects the current system. Implementation is
authored against the **installed version**, which trails main: a release is cut from a commit,
and main keeps moving after it.

Every design deliverable therefore ends with a **Version gap** section: the components and
tokens it references that the installed release does not ship. That list is the bump and
adoption work item for implementation, not a surprise discovered mid-story.

## Non-negotiable rules

- **Missing component or pattern**: flag the gap upstream (issue on the design system
  repo). Never create a local fork or approximation of an FDS component.
- **Dark is the default theme.** No theme class means dark; `.light` must be set
  explicitly. Mockups default to dark and should show both themes when theming is at stake.
- **Fonts**: FDS ships no font files. Geologica and IBM Plex Sans are host-loaded; a
  mockup that does not load them silently demonstrates the wrong typography.
- **Tokens by name**: specs and mockups reference FDS tokens by their CSS custom-property
  name, with the resolved value read from `theme.css` at authoring time, so every choice
  stays traceable to the system.
- **No Tailwind defaults for color or type size**: FDS remaps Tailwind utilities onto its
  own tokens; the stock palette and `text-*` size scale are never a fallback.

## Typography boundary

- Existing `@filigran/ui` surfaces follow [Typography](.github/instructions/typography.instructions.md)
  (`txt-*` classes) until they migrate.
- FDS surfaces use the FDS `Text` component; read the current variant list from the
  `Text` contract, never from memory.
- In both worlds, Tailwind's native size classes (`text-sm`, `text-base`, ...) are
  forbidden for typography.

## Implementation bridge

Cohabitation of the FDS and `@filigran/ui` stylesheets, install and version-bump mechanics,
adapter patterns: [FDS Migration](.github/instructions/fds-migration.instructions.md).

## Two FDS class collisions that fail silently

`fds.css` is imported unlayered and our own build is layered, so **the design system wins every
utility name both ship**. A class of ours that collides is accepted, applied nowhere, and reports
nothing. Two shapes account for almost every occurrence.

### Overriding a spacing an FDS component already sets

The same "FDS wins every shared name" rule bites when a call site overrides a base class of an
FDS component. The components merge `cn(baseClasses, className)` through `tailwind-merge`, so an
override works only if twMerge recognises the two classes as the same group and drops the base
one. It does that for a class of the *same or wider* reach, never for a narrower one: passing
`px-*` / `pt-*` / `pb-*` against `Paper`'s base `p-6` leaves that `p-6` in the list, and since it
comes from `fds.css` unlayered it then beats the app's own layered utility. The per-side classes
silently do nothing, except where `fds.css` happens to ship the same name (`pt-4` does apply,
which makes the failure look like an inconsistency rather than a rule).

Pass one arbitrary class covering the whole property instead: `p-[16px_18px_18px]` replaces
`p-6` outright. The same reasoning covers `rounded-*`, `gap-*` and any other shorthand an FDS
base class sets. Arbitrary values whose name FDS does not also generate (a `border-[color:…]`
with your own token) are safe either way, since nothing unlayered competes for that selector.

### A responsive variant cannot override a plain name FDS ships

The same rule bites a second way, and this one involves no FDS component and no `tailwind-merge`:
both classes sit on one element in our own markup. `fds.css` is unlayered and our build is
layered, so a **plain** utility the design system ships beats a **variant** of ours whatever the
viewport. `hidden ... sm:inline` therefore renders nothing at any width, and the element is
invisible on desktop where the author expected it to appear.

An unlayered **variant** beats our variants too, so the rule is not only about plain names.
`fds.css` ships `.md\:grid-cols-2`, which pins a card grid at two columns from `md` up and wins
against a `lg:`/`xl:` rule of ours declared after it. The escape is the arbitrary form of the same
utility, a name the design system does not generate: `md:grid-cols-[repeat(2,minmax(0,1fr))]`, as
`data-page-layout.tsx` and `findings-kpi-panel.tsx` both do.

So read the sheet, never a memory of what it ships, and read it before reaching for any utility FDS
might also carry. It is minified onto one line, so match occurrences rather than lines, and let the
pattern cover the escaped colon a variant's selector carries:

```bash
grep -oE '\.[a-z:\\]*hidden\{[^}]*\}' front/src/styles/fds.css     # → .hidden{display:none}, it collides
grep -oE '\.[a-z:\\]*grid-cols-[0-9]+' front/src/styles/fds.css    # → .grid-cols-8 and .md\:grid-cols-2
```

`fds.css` ships the whole display family (`block`, `flex`, `grid`, `hidden`, `inline`), so any
responsive switch of `display` against one of them is dead on arrival.

The fix is to stop pairing a variant against a shared plain name. State the value the wide
viewport needs as the base class and, if the narrow case genuinely differs, use a `max-*` variant
for it. On a desktop-first surface, dropping the responsive switch entirely is usually the honest
answer: `wizard-step-indicator.tsx` carried `hidden txt-body2 sm:inline` on its step labels, which
meant no wizard in the app had ever shown them.

The bridge that makes this so, and what to check after a version bump, are in the `fds-migration`
conventions, which load on the stylesheet files themselves.
