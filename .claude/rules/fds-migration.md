---
paths:
  - "front/src/components/layout/main-layout/fds-navbar/**"
  - "front/src/styles/**"
  - "front/scripts/generate-fds-css.ts"
  - "front/src/styles.css"
  - "front/src/providers/theme-provider.tsx"
  - "package.json"
---

<!-- Generated from .agents/instructions/fds-migration.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

The FDS cohabitation bridge: why both stylesheets cannot load as-is, and how the generated sheet keeps composing. The conventions below apply to the file being read.

# The FDS cohabitation bridge


How to adopt `@filigran/design-system` (FDS) components in front while `@filigran/ui`
keeps powering the rest of the app. Written from the Navbar pilot, and every count below was
measured at `@filigran/design-system` 1.0.0: read the installed pin from `front/package.json` and
re-measure rather than quoting a figure from here. The upstream reference is
`process/PRODUCT-IMPLEMENTATION-PLAYBOOK.md` in `XTM-Foundation/filigran-design-system`; this
document covers only what is specific to OpenCRQ, and where the two disagree for a Tailwind
host, this one wins.

## Why both stylesheets cannot be loaded as-is

`@filigran/ui/theme.css` (774 tokens) and the FDS token sheet (402 tokens) define **199
identical custom-property names with incompatible formats**:

- Color primitives: old = bare HSL triplets consumed via `hsl(var(--x))`, new = final hex
  consumed via `var(--x)`. The cascade loser gets a syntactically invalid color, not a wrong
  one.
- `--radius-sm/md/lg`: old scale 0-4px, new scale 4-20px.
- Leading/tracking: unitless vs percentage, rem vs em (different inheritance semantics).
- Theme default inversion: the FDS `:root` is the **dark** palette; light requires a `.light`
  class on `<html>`. The legacy theme only toggled `.dark`.

Additionally the FDS token source opens its `@theme` block with `--color-*: initial`, which
disables Tailwind's entire default color palette in whatever build imports it. Therefore:
**never `@import` `@filigran/design-system/tokens/theme.css` into our Tailwind build, and
never `@source`-scan the FDS package into it.**

## The cohabitation bridge

1. **Prefixed stylesheet**: `yarn fds:css` (in front) runs
   `scripts/generate-fds-css.ts`, a postcss AST rewrite of the FDS compiled
   `dist/index.css` that renames the design system's tokens to `--fds-*` in declaration
   names, `var()` references (fallbacks included) and `@property` params. The FDS source
   declares 413 custom properties, **none of them prefixed upstream**; 154 of those names
   also exist in `@filigran/ui`, and 117 of the overlaps carry an incompatible format
   (bare HSL triplet consumed as `hsl(var(--x))` on one side, finished hex consumed as
   `var(--x)` on the other). Unrenamed, the losing side produces *invalid* declarations
   that the browser drops entirely, so this pass is what makes the two sheets loadable
   together. It becomes unnecessary the day `@filigran/ui` leaves the repo.
   Selectors are never touched: arbitrary-value utilities embed var names in class
   selectors (`.z-\[var\(--fds-z-overlay\,50\)\]`) that must keep matching the class
   strings compiled into the FDS JS bundle. Three namespaces are preserved: `--fds-*`
   (used upstream for the two host-supplied hooks `--fds-header-height` and
   `--fds-z-overlay`), `--radix-*` (written by Radix as inline styles at runtime), and
   `--tw-*` (see the collisions section below). The output, `src/styles/fds.css`, is generated, checked in,
   deterministic, and regenerated on every version bump.
2. **Import**: `@import './styles/fds.css';` in `src/styles.css`, deliberately unlayered.
   Tokens stay on `:root`, so FDS surfaces portalled into `<body>` (tooltips, flyouts) remain
   themed.
3. **Theme classes**: `theme-provider.tsx` toggles BOTH `.dark` and `.light` on
   `document.documentElement`. `.light` is inert for `@filigran/ui` (backward compatible)
   and required by FDS (absence of class = dark).
4. **Fonts**: FDS ships no `@font-face` and expects `Geologica` / `IBM Plex Sans`.
   `styles.css` overrides `--fds-font-sans-geologica`, `--fds-font-sans-plex`,
   `--fds-font-mono-plex` to the Fontsource Variable families the app already loads.
   Without this, FDS text silently falls back to the system font.
5. **Stacking**: `--fds-z-overlay: 50` on `:root` (app header is `z-20`, legacy overlays are
   `z-50`); every portalled FDS surface uses `z-[var(--fds-z-overlay,50)]`.

## Utility-class collisions: FDS wins, on purpose

Renaming the tokens solves half the problem only. `fds.css` is a **full Tailwind build**, not
a token sheet: it carries 474 class rules, and over 200 are class names our own build also
generates. Same selector, same specificity, different tokens. Most compile to the same value
(`--fds-spacing` and `--spacing` are both `0.25rem`, so `p-4` is a no-op difference), but some
do not: `rounded-md` is 12px against our 6px, `leading-content-caption` 150% against 1rem, and
the brand and `text-feedback-*` colors differ.

Class names cannot be renamed the way tokens can. They are a contract between the FDS
stylesheet and the FDS JS bundle, which writes them into the markup, so only the design system
can prefix them (that ask is listed by the `adopt-fds-component` skill).

**The decision: the design system wins every shared name.** `fds.css` is imported unlayered,
and unlayered rules beat layered ones whatever the import order, so the shared names resolve
to FDS values across the whole app. This is deliberate: FDS is the system the app is migrating
onto, and `@filigran/ui` is on its way out. Our own build still supplies everything FDS does
not ship, which is roughly 80% of the utilities we use (1178 generated, 946 absent from
`fds.css`).

**Do not wrap it in a cascade layer to reverse this.** Beyond handing the shared names back to
the app, a layer's position cannot be stated once: the dev server honours an `@layer`
statement, while the production build drops it and falls back to import order, so the two
disagree about the cascade. Judge rendering on `yarn build`, never on the dev server alone.

### Tokens FDS main ships that the installed version does not

When a design authored against main names a token the installed release has not shipped yet, give
it a dedicated stylesheet imported right after `fds.css`, one entry per token, each the upstream
formula written against a token the release already carries. Never a copied value or a local
approximation, and never inlined at a call site: the next bump has to be able to delete the file
whole without hunting. Design specs authored against FDS main carry their own "version gap"
section naming what is missing, so an implementer maps it consciously.

### Why `--tw-*` stays unrenamed

Tailwind composes effects through internal slots: one utility deposits a fragment
(`--tw-leading`, `--tw-ring-shadow`), another assembles it. Both builds declare them, 61 on
the FDS side and 78 referenced on ours. Renaming them to `--fds-tw-*` severs composition
across the boundary, silently: with FDS winning `text-sm`, a `leading-tight` from our build
deposits into a slot the FDS rule never reads, and the line height simply does not apply
(20px instead of 16.8px, no error anywhere). The same holds for focus rings and transitions.

Leaving them shared is sound as long as both builds know the same slot vocabulary.
`generate-fds-css.ts` checks that directly: every `--tw-` name the FDS sheet carries must be one
our own `tailwindcss` package declares, and the generation fails rather than emitting a sheet
whose effects quietly stop composing. The two projects release independently and rarely land on
the same patch, so the version comparison beside it stops at the **minor**, the granularity at
which Tailwind adds or renames a slot. Verified for the 4.3.2 build FDS 1.0.0 ships against our
4.3.3: the 138 slot names are identical, and the patch only moves the default sans-serif stack,
the neutral `oklch()` hue notation and a `:-moz-focusring` selector.

## Radix must resolve to exactly one copy

Both libraries depend on Radix, and Radix pins its own internals to exact versions, so a plain
install gives each library its own physical copy of packages the two are meant to share. That is
fine for rendering and fatal for `@radix-ui/react-dismissable-layer`, whose layer stack and saved
`document.body` pointer-events are module-level state: two copies keep two independent stacks, each
believing it owns the body. An FDS menu that opens a legacy Sheet then restores the body on its own
close, and the Sheet, which captured `none`, writes `none` back when it closes, leaving the whole
page unclickable.

The root `resolutions` entry collapses it to one copy. Keep it until `@filigran/ui` leaves the
repo, and raise it rather than drop it when either library moves: any package holding a
cross-component stack, focus scope or body state has the same requirement.

### Verifying after a version bump

Probe `dist/assets/*.css` from `yarn build:prod`: `rounded-md` must resolve to
`var(--fds-radius-md)` (FDS owns shared names), `text-sm` must read its line height from
`--tw-leading` while `leading-tight` writes it (composition crosses the boundary),
`font-content-code` must survive (FDS-only classes), and an app-only class the app actually uses
(`bg-background`, `txt-sub-content`) must still render.

Read those probes **layer-aware**, never by taking the last matching rule: our utilities sit in
`@layer utilities` and the FDS sheet does not, so the unlayered rule wins wherever both build the
same name, whatever the source order. A naive last-match read reports the opposite of the truth.

The two collisions a call site actually meets are in the `design-system` conventions, which load
on every front file. Installing, adopting or bumping an FDS component is the `adopt-fds-component`
skill.
