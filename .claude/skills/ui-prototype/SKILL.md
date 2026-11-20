---
name: ui-prototype
description: Throwaway prototypes in the real app to judge how a UI idea feels, not just looks - switchable in place, tuned live. Use when exploring UI behaviour a mockup can't settle. Usage - /ui-prototype <idea> [on <page>]
---

# Prototype a UI idea in the real app

The deliverable is **something to try**, not code to keep. A mockup shows how it looks; a prototype
shows how it feels (a delay too long, motion too busy, density tiring, feedback missed, a drag
imprecise), which only shows when the user operates the real thing.

## Vocabulary

Never say `variant`: here it is an FDS / `cva` prop, and a prototype never adds one to a shared component.

| Term          | Meaning                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| **Prototype** | One design. An exploration has one or several, mutually exclusive: one active at a time.                        |
| **Toggle**    | An add-on within a prototype, combinable with its other toggles.                                                |
| **Parameter** | A value to tune, numeric (`150 / 300 / 600 ms`) or named (`compact / roomy`), owned by one prototype or shared. |
| **Condition** | A simulated circumstance (slow server, data volume, long text, narrow screen), shared.                          |

Same structure, different value: a parameter. Different structure, or settings of its own: a
separate prototype. Nothing in between. E.g. table loading states = one prototype, four toggles
(dim rows, header bar, pager spinner, skeleton), two shared parameters (show-after, minimum
duration), one condition (latency); three full-screen table layouts = three prototypes.

## 0. Overview first

In a few lines: the component that owns the behaviour, where prototypes would plug in, what the app
already has. Then the candidate designs with trade-offs and a recommendation, and the **unknowns**
(delay, duration, easing, size, threshold, density, wording): they become parameters. Build once
the user picks, and build **all** chosen prototypes before the first look, so none is judged
against the memory of another. Host them on **one** real surface, where the behaviour is easiest to
provoke: real data and neighbours expose shifts, token quirks and competing motion.

## 1. Rules

- **Separate in code, together in use**: one file per prototype (`<topic>-<name>-prototype.tsx`
  beside the host), no shared state; but one surface, one switch, so all are compared on the same
  data a second apart. Separate copies of the code only for incompatible edits to a shared
  component, or judging in different sessions or by different people; say so.
- No `/lint`, `/check-ts`, `/test`, `i18n:extract` or comment polish: it only has to run.
- **FDS first, non-compliance flagged.** Build the prototype (not its control panel) from
  `@filigran/design-system` components and `--fds-*` tokens. Read contracts and values from
  `node_modules/@filigran/design-system/dist/` (`meta.mjs`, `tokens/theme.css`), never from
  memory. Compliance is recommended, not required: any deviation is allowed, listed with its
  reason in the report (§4), so keep that list as you build. Reasons that count: a non-FDS
  component already on the host page, a component missing from FDS, a component only in FDS
  `main` (version gap), or a collision workaround.
- Shared-component edits limited to what prototypes need, so what would survive stays visible.
- Stop at the prototypes: making one real is the user's call, with conventions back in force.
  Never commit or push unless asked.
- Log in with the seeded platform admin and reuse its demo data before creating anything. If the
  stack isn't seeded, that's the user's call — ask, don't seed it yourself.

## 2. How the user drives it

Pick the lightest shape and say which.

**Control panel** (default when anything switches or tunes): a hook returns `{ settings, panel }`.

- `fixed bottom-4 right-4 z-50`, collapsible, clear of what is judged. It should look like the rest
  of the app, but how it is built is not judged: the FDS rule skips it.
- Top to bottom: prototype radio (if several), **its** toggles and parameters, then shared ones and conditions.
- Parameters are selects over a few presets around the likely answer, never free inputs.
- `localStorage` under `prototype:<topic>`, **per prototype**, in `try/catch`, read through a zod
  `.partial()` schema: a stored value can predate the presets of the current iteration.

**No panel**: a `?proto=b` URL parameter or a shortcut when a panel would disturb what is judged
(full screen, focus, drag) or cannot be reached (a drawer or dialog: it portals over the panel at
the same `z-50`, and its modal sets `body` to `pointer-events: none`, so the panel cannot be clicked
while one is open, but a shortcut still reaches `window`); nothing at all for a single prototype
whose question is only how an interaction feels, judged by using the page.

Switch in place by default. Copies laid out next to each other only for still, visual properties
(spacing, colour, badge style): only one copy can be operated, animated copies compete, and some
behaviours exist once per page.

Colours come from FDS tokens by name (`--fds-*`) and text from `Text`:
`bg-[var(--fds-bg-elevation-heading)]`, `border-[color:var(--fds-border-elevation-default)]`. Never
Tailwind's default palette or `text-sm`-style sizes. `tokens/theme.css` lists the names unprefixed
(`--bg-elevation-heading`); the app serves each as `--fds-<name>` from the generated
`front/src/styles/fds.css` (minified: grep it, never read it whole). Only the prefixed names paint:
the unprefixed ones (`--bg-elevation-*`) are raw HSL triples that paint nothing inside `var()`.
Spacing has no token per size, only the base `--fds-spacing` (0.25rem, like Tailwind's `--spacing`):
use the Tailwind scale (`p-4`, `gap-2`). If a class on an FDS element looks ignored, see
`design-system.instructions.md`.

## 3. Conditions the dev machine hides

- **Slow server**: a delay link in `front/src/lib/trpc.ts`, right after `tenantStampLink` (the
  tenant is stamped before the wait, so a tenant switch mid-delay cannot file rows in the wrong
  cache partition). The host's hooks, query keys and SSE doorbell stay untouched, and mutations are
  slowed too. The panel sets `protoLatency.ms`, a module variable the link reads, not React state:
  ```ts
  export const protoLatency = { ms: 0 };
  // in links, after tenantStampLink(...); import type { Unsubscribable } from '@trpc/server/observable'
  () => ({ next, op }) =>
    op.type === 'subscription'
      ? next(op)
      : observable((observer) => {
          let subscription: Unsubscribable | undefined;
          const timer = setTimeout(() => { subscription = next(op).subscribe(observer); }, protoLatency.ms);
          return () => { clearTimeout(timer); subscription?.unsubscribe(); };
        }),
  ```
  It edits a shared file, so §4 lists it among what the real change drops.
- **Content extremes** (long names, empty values, 1 vs 500 rows): pad, truncate or multiply client-side.
- **Data volume** the tenant lacks: ask the user to seed, or shrink the page size. Data still
  needed beyond the seed: confirm with the user first, naming what's about to be created.
- **Screen and device**: narrow viewport, both themes, reduced motion, CPU throttling for animation.
- **Failure paths**: force error and empty states when a prototype must hold up there.

## 4. Report

Per prototype (and toggle where it matters): how it felt, what went wrong (shift, flicker, lag,
moving target, state that reads as a bug), whether it earns its place. Then the **non-FDS deviations**, if any
(one short list): each with its reason (non-FDS host component / gap / version gap / collision
workaround) and what adopting the real change would take. Then a recommendation and what to try
next, and wait. When the user picks one, list what the real change keeps (a generic
hook, a shared prop, the settled values) and drops (panel, other prototypes, conditions, the
delay link).
