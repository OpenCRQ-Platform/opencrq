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
