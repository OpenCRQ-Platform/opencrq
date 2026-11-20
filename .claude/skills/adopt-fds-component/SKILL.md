---
name: adopt-fds-component
description: Install, adopt or bump a Filigran Design System component alongside the legacy @filigran/ui. Use when replacing a legacy component with its FDS counterpart, when adding the design system to a surface, or when raising the FDS version.
---

# Adopting an FDS component

The cohabitation bridge these procedures rely on is described by the `fds-migration` conventions,
which load on the stylesheet files. The collisions a call site meets are in `design-system`.

## Installation

An ordinary exact-version npm dependency on the public registry (Apache-2.0, published from
the private `XTM-Foundation/filigran-design-system` repo):

```jsonc
// front/package.json, and read the pin from the file: it moves with every bump
"@filigran/design-system": "1.1.0"
```

- `.yarnrc.yml` lists the package under `npmPreapprovedPackages`. `npmMinimalAgeGate` holds any
  release back for three days, and a design system version is normally adopted sooner.
- The tarball ships a prebuilt `dist/`, so nothing is compiled at install time: no credentials,
  no git, and no ceiling on the Node version running `yarn install`.
- Yarn resolves the package to the repo-root `node_modules/`, not `front/node_modules/`.
- Post-install sanity check: `import('@filigran/design-system')` resolves and exposes the
  components the surface uses. Count the exports against the previous release rather than against
  a number written here, which is stale one bump later.

## Adapter patterns (Navbar pilot, transferable to any FDS component)

- **Selection is `aria-current`, not a prop, and the reference behavior is precise.** FDS
  rows style themselves on `aria-current="page"` (CSS attribute selectors). The 1:1
  reference (the design-system docs site, which dogfoods the Navbar) is: the active leaf
  link is highlighted, and the group trigger is NEVER highlighted, expanded or collapsed.
  The library's `hasActiveDescendant` reads the JSX props of `NavbarSubmenu`'s direct
  children, so to match the reference, never pass `aria-current` as a prop on the Links:
  let TanStack `Link` set the attribute at runtime (invisible to the prop inspection,
  styled by the CSS). TanStack's own matching must agree with the intended semantics:
  always pass `activeOptions={{ exact }}` (its default is prefix matching, which wrongly
  lights Dashboard on every tenant page).
  - Keep `NavbarSubmenuItem` as the DIRECT child of `NavbarSubmenu` (helper function, not a
    wrapper component): the collapsed flyout wraps each child in a Radix DropdownMenu item
    slot whose props must merge onto a prop-forwarding element.
- **`asChild` disables `icon`/`showIcon`/`chevron`.** Row internals must be hand-composed;
  every copied FDS class string lives in ONE file (`navbar-row-content.tsx`) that must be
  re-checked on every version bump against `dist/components/navbar-item/NavbarItem.mjs` and
  `dist/components/navbar-submenu/NavbarSubmenu.mjs`, which the package ships unminified, one
  readable module per component.
- **`tooltipLabel` is mandatory** on `asChild` rows (collapsed-mode tooltip is silently
  skipped otherwise).
- **Do not control `NavbarSubmenu.open` while collapsed** (breaks the hover flyout). The
  pilot leaves submenus uncontrolled.
- **The nav model is pure data** (`nav-model.tsx`): entries built inside functions (i18n
  rule), `filterVisibleEntries` unit-tested without React.
- Collapse state reuses the existing `menuStatusCollection` (localStorage
  `app:menu-open`); FDS `Navbar` is fully controlled and remembers nothing.
- **"Made by Filigran" signature** (`made-by-filigran.tsx`) mirrors the docs site's
  `NavbarSignature`: rendered in the `footer` slot above the built-in collapse toggle,
  hidden entirely while collapsed, caption typography + `text-default-secondary`, wordmark
  assets `public/filigran-{light,dark}.svg` (copied from the DS repo's `docs/public/`)
  picked by `effectiveTheme`.
- The FDS rail is 180px expanded / 48px collapsed (legacy was 192/56). Add `shrink-0` via
  `className` (the nav does not defend its width in a flex row, known upstream gap).

### FDS fields on a legacy surface need the elevation context declared

FDS surfaces (Dialog, Paper) put a `layer-N` class on their root, which rebinds the
elevation tokens (`--fds-bg-elevation-*`, borders) for the subtree; form fields read their
resting fill from those tokens (`bg-input-default` → `--fds-bg-elevation-highlight`). A
legacy container declares nothing, so a field inside it resolves to the `:root` layer-0
binding — and an `Input` at rest (`border-transparent`) is then invisible on the legacy
sheet, whose background is the exact layer-0 highlight colour. Fix on the container, once:
add the `layer-N` class whose `bg-elevation-default` equals the legacy surface's own
background (`layer-2` for the sheet/drawer, the layer the FDS Dialog itself uses). Never
per-field overrides.

### The legacy `Badge` maps onto `Chip`, never onto the FDS `Badge`

The two libraries give the name to different things. `@filigran/ui`'s `Badge` is a label pill;
the FDS `Badge` is a notification marker (a count or a dot pinned onto another element, the MUI
`Badge` replacement). The label pill is the FDS `Chip`, and the system states the boundary itself:
a Chip labels, a Badge marks.

`Chip` takes `label: string`, so JSX children have to be flattened (an icon moves to `startIcon`,
a `<Trans>` becomes a `t` macro). It has no outlined form (`disabled` is the one recessed
rendering), it is fixed at 24px high with a 14px label, so `txt-*` and `px-*` overrides on a call
site stop doing anything, and it truncates its own label at 250px behind the library's Tooltip.
An `onClick` turns it into a `<button>`; an `onDelete` adds a delete control as a DOM sibling.

Tone crosswalk, applied across the app:

| legacy variant | colour | FDS `severity` |
|---|---|---|
| `outline` | grey outline | `neutral` |
| `secondary` | turquoise | `low` on an ordinal ladder, `neutral` on a plain label |
| `warning` | orange | `high` |
| `destructive` | red | `critical` |
| `default` | dark blue | `info` on an ordinal ladder, `neutral` on a plain label |

Severity bands read straight off the FDS axis (`critical`/`high`/`medium`/`low`), which is what
`severity-ramp.ts` already declared for the figure and the arc. A closed product vocabulary
(compliance status, TLP) goes through `severity`; `color` is reserved for a hex the DATA carries.

### `AlertDialog` maps onto `Dialog`, and loses the alert contract with it

There is no FDS counterpart to Radix's `AlertDialog`: the FDS `Dialog` wraps
`@radix-ui/react-dialog`, so a confirmation migrated onto it drops four behaviours the alert
primitive hard-codes (`node_modules/@radix-ui/react-alert-dialog/dist/index.mjs`): the
`alertdialog` role, the forced `preventDefault` on `onPointerDownOutside` *and*
`onInteractOutside`, and the `onOpenAutoFocus` override that puts initial focus on Cancel.
Do not rebuild any of them by hand; the FDS `Dialog` is the system's answer for a confirmation
and the gap belongs upstream.

| legacy | FDS |
|---|---|
| `AlertDialogHeader` | nothing — `DialogTitle` / `DialogDescription` are direct children of `DialogContent` |
| `AlertDialogFooter` | `DialogFooter` |
| `AlertDialogCancel` | `Button priority="secondary"` inside `DialogClose asChild` |
| `AlertDialogAction` | `Button` |
| `AlertDialogOverlay` / `AlertDialogPortal` | internal to `DialogContent`, not ported |

`AlertDialogAction` is a `DialogPrimitive.Close` under the name, so it closed the dialog on
click. A call site whose `onConfirm` only fires a mutation and never touches `open` depends on
that, so its confirm button needs `DialogClose asChild` too; a handler that already closes takes
a plain `Button`. Conversely an action that called `e.preventDefault()` did so to *suppress* that
close (form validation may reject), and a plain `Button` gives the same result with nothing to
carry over.

Sizes are fixed widths, not max-widths: `sm` 420px for a confirmation (the size the `Dialog`
contract's own confirm example uses), the default `md` 640px once there is a form or a long body,
`lg` 960px. A legacy `max-w-*` override cannot narrow them: the design system wins every shared utility name.

### A stretched `Card` hands its height to its content only when asked

Since Card v2 (1.6.0) the parts sit in an inner region, the card's first child when it has no
banner or media, which keeps its content height. A card made taller than its content, by `h-full`
or by its grid row, leaves that slack under the region: an `mt-auto` block or a `grow` chart inside
it no longer reaches the bottom, and a `CardMetaBar` floats up. Such a card adds
`CARD_CONTENT_FILLS` (`components/ui/card-content-fills.ts`) to its `className`. `CardFooter` pins
itself and needs nothing.

A header action that should sit on the title's line takes `min-h-6 items-center`, the height of a
`title-sm` line: `CardHeader` aligns its items to the top, so a wrapper as tall as the old 48px
header pushes the action under the title. An action taller than that line, such as a segmented
switch, centres on the title with `className="items-center"` on the `CardHeader`.

## Accepted behavior deltas (pilot)

- Accordion groups are multi-open and unpersisted (legacy had an exclusive accordion).
- Collapsed mode is a hover flyout (legacy: click-pinnable popover); `OrgSelect` renders in
  the expanded accordion only (a Select cannot live inside a Radix dropdown item).
- The built-in collapse toggle label is hardcoded English (upstream gap).
- The collapsed flyout panel has no border/shadow by FDS design and visually merges with
  same-color page backgrounds.
- Every confirmation announces as `dialog`, not `alertdialog`; a click outside or the corner
  close button dismisses it, and initial focus lands on that close button rather than on Cancel.
  All three are dismissal paths, so no confirmation can be *accepted* by accident — the one
  surface where a dismissal itself loses something, the once-shown API token, keeps its own
  `onPointerDownOutside` guard.

## Version bump procedure

1. Pick the new version on npm, update it in `front/package.json`.
2. `yarn install`, then `cd front && yarn fds:css` and commit the regenerated
   `src/styles/fds.css`.
3. Re-read the FDS row anatomy in the new dist against `navbar-row-content.tsx` (its class
   strings are a copy).
4. `yarn check-ts && yarn lint && yarn test && yarn build:prod`, then the cascade probes above
   and a visual pass (expanded, collapsed, flyout, both themes).

No class copied into product code is generated by our own Tailwind build; they resolve only
because `fds.css` carries the design system's compiled rules. Adding one means checking it is
actually in that sheet, or it silently does nothing.

## Upstream feedback worth filing

1. `NavbarSubmenu.hasActiveDescendant` is dead in practice: it reads JSX props, and both the
   docs site and every router integration set `aria-current` at runtime or behind wrappers,
   so the trigger never activates anywhere. Either remove it or document the intended
   contract (trigger never active) explicitly.
2. `asChild` vs `icon`/`chevron`: a row-body slot or exported row-content component would
   remove the copied-markup debt.
3. Collapse toggle label is not localizable.
4. The nav does not defend its width (`shrink-0`) in a flex host.
5. A documented token-prefixing story (or a namespaced build) would make cohabitation with a
   legacy Tailwind token sheet a supported path instead of a host-side rewrite.
6. The delivered stylesheet is built against whatever `^4.3.1` resolves to at release time, and
   the release does not say which. An exact Tailwind pin, stated in the release notes, would let
   a host reconcile the two builds without reading the banner out of the shipped CSS.
7. Removing Chip's `tone` axis left the component with no "emphasised" state. A call site marking
   one chip among its siblings has no colour-level answer left.
8. `Input` and `Textarea` apply `className` to their outer wrapper only, and pass nothing to
   the control, so a call site cannot restyle the field itself: a monospace face on a licence
   paste box and a `resize-none` on a fixed-height comment box both had to be dropped. A `className` for the control, or the one or two properties worth
   exposing, would close it.
9. A caller's `aria-invalid` is overwritten, and `error` is a string that always renders a
   message, so there is no way to put a field in the error state without printing copy under
   it. A validation that spans several fields (min ≤ likely ≤ max, one message for the row)
   consequently cannot tone the fields it is about.
10. `SearchField` hardcodes English for the accessible name of its `role="search"` landmark
   and for its clear button, so a localized host either accepts two English strings or
   invents an `aria-label` per call site.
11. `ComboboxContent` is a non-modal Radix Popover portalled to `<body>`, so inside a Radix
   modal Dialog it is unusable: the Dialog sets `pointer-events: none` on `<body>`, Radix
   carves that out for its own modal layers and for `Select`'s content but not for a
   non-modal Popover, and the panel then paints over the Dialog while every click falls
   through to it. `ComboboxContent.mjs` already reasons about this failure shape for the
   z-index axis; the pointer axis needs the same treatment, since the FDS `Dialog` itself
   is a modal Radix Dialog and hits it (host workaround: `fds-patches.css`).
12. The input background aliases (`--bg-input-default/hover/disabled`) are declared on `:root`
   only, so the browser resolves their `var(--bg-elevation-*)` reference against the layer-0
   bindings and inherits the finished colour: a `.layer-N` context never reaches them, and an
   Input at rest inside the FDS Dialog (layer-2) paints the exact colour of the Dialog surface.
   Fixed in 1.3.0 (the aliases are restated in every `.layer-N` rule), host workaround removed.
13. The same portalled panel cannot be scrolled with the wheel inside a Radix modal Dialog:
   `react-remove-scroll`, which the Dialog arms, cancels every wheel event whose target lies
   outside the overlay and outside the shards the Dialog declares, and the panel is neither.
   `ComboboxContent` accepting a shard ref, or declaring itself one, would close it (host
   workaround: `ComboboxPanel` stops the event at the panel).
14. Card v2's main region does not grow, so a card stretched by its grid keeps the slack under
   its content instead of inside it, and `CardMetaBar`, unlike `CardFooter`, does not pin itself
   to the bottom. Main taking `flex-1` would close both (host workaround: `CARD_CONTENT_FILLS`).
