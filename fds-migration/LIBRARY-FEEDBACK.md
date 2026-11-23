# Design system library feedback

What OpenCRQ needs from the Filigran Design System (`@filigran/design-system`) and `@filigran/ui`
that the libraries do not offer yet. Each entry names the stopgap OpenCRQ carries until the library
ships it, so the stopgap is removed in one place.

## DataTable (FDS ROADMAP priority 1, todo)

The FDS has no DataTable. OpenCRQ renders `@filigran/ui` `DataTable` through its single adapter,
`front/src/components/ui/data-page-layout.tsx` (`DataPageLayout`): the switch to the FDS table is a
renderer swap in that file. What a records list needs from the library table, stated here so this file
stands alone: the table fits the viewport and its body is the page's only vertical scroller, under a
pinned header; each filter is a typed pill reading "Label" unset and "Label: value" set, cut with its
full text in a tooltip, with an active-filter count and one Clear all; a search or filter that matched
nothing shows a no-results state that offers to clear them, distinct from the empty state. In detail:

- **One scroller, fit to viewport.** `DataTable` takes `sticky` (its wrapper gets `h-full`, its header
  cells `sticky top-0`), but its own outer `.twp` block is not a flex child, so a parent must force the
  flex chain from outside with descendant selectors. Stopgap: `DataPageLayout fillHeight`. Ask: a
  `fillHeight` (or `layout="fill"`) prop that makes the table a `min-h-0 flex-1` column with the body as
  the only vertical scroller.
- **Typed filter pills.** No filter pill, active-filter count or Clear all exists. Stopgap:
  `front/src/components/ui/filter-pill.tsx` (`FilterPill`, `FilterClearAll`) on the FDS `Menu`. Ask: a
  `FilterPill` family (enum, date, number, boolean, owner) and a toolbar slot that lays them out.
- **No-results state.** No component for "a search or filter matched nothing". Stopgap:
  `front/src/components/ui/list-no-results.tsx` (`ListNoResults`, with Clear filters). Ask: an empty
  and a no-results state built into the table, the toolbar kept above it.

## Icons (`@filigran/design-system@1.9.0`)

Every icon goes through the FDS `<Icon>`, never `lucide-react`. What the settings rails needed that the
vocabulary and the sizes do not offer yet:

- **Missing glyphs.** `factory` (Sectors), `trending-down` (Loss Drivers), `gauge` (CRQ Indicators) and
  `crosshair` (MITRE ATT&CK). Stopgaps: `custom/city`, `arrow-down-left`, `chart-column` and
  `custom/attack-pattern` in `front/src/components/shared/taxonomies-toolbar-menu.tsx` and
  `front/src/routes/_auth/$tenantId/{-$organizationId}/settings/engine/route.tsx`. Ask: add the four
  Lucide glyphs to the generated registry.
- **18px size.** The OpenAEV scope switch draws its icons at 18px; `<Icon>` allows 16, 20 and 24 only.
  Stopgap: 20px in `front/src/components/layout/settings-layout/scope-switcher.tsx`. Ask: an 18px size, or
  a stated FDS size for the scope switch tile.

## Popover (`@filigran/design-system@1.9.0`)

The FDS has no Popover: a hint that must stay up on a press, or that holds a link, can only be a
`Tooltip`, which closes on every press of its trigger. The cross-product emblems (OpenCTI, OpenAEV) need
both: a greyed `aria-disabled` emblem whose hint is the only answer a press gets, and a not-connected
teaser that carries a "Connect" link. Stopgap: `keepOpenOnPress` on `TooltipHint`
(`front/src/components/shared/tooltip-hint.tsx`), used by `front/src/features/xtm/xtm-counterparts.tsx`.
Ask: a `Popover` (trigger, content, open on hover, focus and press, dismiss on Escape and outside press)
so the stopgap goes.

## Chip (`@filigran/design-system@1.12.1`)

- **Runtime variable outside the `--fds-` namespace.** A data-coloured `Chip` sets its label colour
  inline as `--chip-data-ink-dark` and `--chip-data-ink-light`, while `Button` publishes
  `--fds-button-color-ink`. A host that namespaces the design system tokens (OpenCRQ prefixes every
  reference with `--fds-` in `front/scripts/generate-fds-css.ts`) reads an unset variable, and label
  chips lose their edge and ink in standard colours. Stopgap: `--chip-data-ink-` in
  `PRESERVED_NAMESPACES` of that script, guarded by `front/src/styles/fds.test.ts`. Ask: publish the
  Chip variable under the `--fds-` namespace, like Button, so the stopgap goes.
- **Usage contract out of date.** `usage-contracts/Chip.md` at 1.12.0 still says data colours are
  filled and do not change under pastel, which contradicts the 1.12.0 CHANGELOG (standard colours:
  inset edge and text in the label colour; pastel: the wash, default text, no edge). Ask: align the
  contract with the CHANGELOG.
- **Ink measured against the base surface only (fixed in 1.12.1).** In 1.12.0 `dataColorInk` picked
  the label ink against the base elevation surface only, so a black label chip on a raised dark card
  (Asset overview > Tags card) read 4.35:1, under the 4.5:1 text floor (#87, UX blocker B1 of #86).
  Fixed upstream by XTM-Foundation/filigran-design-system#430 in 1.12.1 (5.06:1 on the same card),
  consumed by #92. No product-side override.
- **No visible shape for a white label in light theme with Softer tones (open).** Light theme, Softer
  tones on: a white label's fill `rgba(255, 255, 255, 0.21)` on a white card gives the chip no visible
  edge or shape (advisory A1 of #87). Ask: give the pastel chip a visible edge when its fill cannot
  separate it from the surface it sits on.
