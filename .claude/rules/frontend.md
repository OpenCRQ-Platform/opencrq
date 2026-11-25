---
paths:
  - "front/src/**"
---

<!-- Generated from .agents/instructions/frontend.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

Frontend architecture: React 19, Vite, TanStack Router, tRPC client, and feature organization. The conventions below apply to the file being read.

# Frontend Architecture (`front`)

- **Framework**: React 19 + Vite + TanStack Router (file-based routing with auto code-splitting).
- **UI**: `@filigran/ui` component library + Tailwind CSS 4 (`@import 'tailwindcss'` in `src/styles.css`). Layer semantics, `@theme` and `@reference` all differ from v3, so a v3 answer is a wrong answer here.
- **tRPC client**: `src/lib/trpc.ts` — creates the typed tRPC client and the `useTRPC()` hook components build their TanStack Query options from. Sends `x-tenant-id` header. Backend type imported from `@app/back/src/types/trpc-router`.
- **Routing**: `src/routes/` — file-based. `_auth/` is the authenticated layout. `$tenantId/` is a dynamic segment for tenant-scoped pages. Route tree is auto-generated in `routeTree.gen.ts`.
- **Features**: `src/features/<domain>/` — domain-specific components and hooks, organized by feature.
- **Providers**: `src/providers/` — ThemeProvider, TrpcProvider, TenantProvider, LoggedUserProvider, ErrorBoundary, LinguiProvider.
- **Proxy**: Vite dev server proxies `/api` and `/trpc` to `backendConfig.http_server.port`, overridable with `PROXY_TARGET` (`vite.config.ts`). Only the main checkout is on 3002: every devenv worktree gets its own port.
- **i18n**: Lingui v5. See [i18n guide](.github/instructions/i18n.instructions.md) for API, rules, and workflow.

## Code Organization for Testability

Components should separate **pure logic** from **React/i18n/data-fetching concerns** to maximize testability.

### Pure utility functions (`src/utils/` and `src/features/<domain>/`)

Extract pure functions (no React, no i18n, no side effects) into dedicated `*-utils.ts` files so they can be tested in isolation.

| File | What it contains |
|---|---|
| `src/utils/format-currency.ts` | `formatDollar`, `formatDollarChange`, `formatCompactCount` — shared formatters used across features |
| `src/features/<domain>/<domain>-utils.ts` | Domain-specific pure logic (validation, computation, name generation) |

**Rules:**
- Pure utils must **not** import from `react` or `useTRPC`. The `t` macro from `@lingui/core/macro` is allowed when the function needs translated text — see the "Pure utils with i18n" testing section below.
- When a function needs to return user-facing text, **return an error code** (string constant) instead of a translated string. The component maps codes to i18n messages. Example: `getRowValidationError()` returns `'MIN_GT_LIKELY'`, component uses `VALIDATION_ERROR_MESSAGES[code]`.
- When the same formatting logic is used in 2+ features, move it to `src/utils/`. **Always import directly from the shared module** — do not create feature-specific aliases or re-export wrappers (e.g., no `export const formatFinancialValue = formatDollar`).

### Reusable hooks (`src/hooks/utils/`)

Extract stateful logic patterns into reusable hooks when the same state machine appears in 2+ components.

| Hook | Purpose | Used by |
|---|---|---|
| `useConfirmationDialog` | State machine for confirmation dialogs (pendingId, isOpen, requestConfirmation, confirm, cancel) | Data tables with delete actions |
| `useEditSelection` | Edit drawer selection state (editId, isEditing, openEdit, closeEdit) | Data tables with inline edit drawers |
| `useCopyToClipboard` | Copy-to-clipboard with auto-reset feedback (copied, copy) | The access link of "Add members" |
| `useTableColumnOrdering` | Persisted column order with stale-column reconciliation | All data tables |
| `useUrlListFilters` | Reads `useSearch({ strict: false })` through a route's zod schema and writes patches back with `navigate({ to: '.', search, replace: true })` | List search/filter state that must survive a shared link and a back navigation |
| `useDebouncedDraft` | Local draft reconciled against a committed value during render (`reconcileDraft`, no mirroring `useEffect`); commits after a delay, trailing-only, and on blur | `DebouncedSearchField`, which is what a list uses — never call it from a list component |
| `useSeenOnce` | `seen` turns true the first time the element given to `ref` comes within a margin of the viewport, and stays true; true from the start without `IntersectionObserver` | A card gating its own query with `enabled`, so a long page reads only what scrolls near (the risk treatment cards' series) |
| `useReaderTimeZone` | The browser's IANA zone for a query taking `timeZone`, switching to UTC once the server refuses it (400), with no retry and no toast for that refusal | Activity heatmaps, the What changed page |

**Rules:**
- Hooks in `src/hooks/utils/` must be generic (not domain-specific).
- Export from `src/hooks/utils/index.ts` barrel, re-exported via `src/hooks/index.ts`.
- When a hook contains a pure function (e.g., `reconcileColumnOrder`), extract it as a named export so it can be tested without `renderHook`.
- **Search and filters live in the URL** (`useUrlListFilters` on a route's own schema); sort, page size, column visibility and grid/list view stay local preferences (`usePersisted*`), never the URL.
- A route file never imports its search schema or defaults from a barrel under `features`, the root one or a feature's own — only from their own module, whose name ends in `-list-search` (`features/<feature>/<name>-list-search`). A barrel sits in an import cycle with the generated route tree, and dereferencing a barrel import at module evaluation (`validateSearch`, `stripSearchParams(...)`) throws a temporal-dead-zone `ReferenceError` at boot. `no-restricted-syntax` enforces this on `src/routes/**` (`eslint-rules/src/rules/route-search-schema-import.ts`), and the `-list-search` suffix is what it recognises as a safe source. The rule reads the **imported names**, so a schema is exported as `<name>ListSearchSchema` and its defaults as `<NAME>_LIST_SEARCH_DEFAULTS`: a schema exported under any other name is invisible to it, and the boot-time blank screen it guards is a failure neither `tsc` nor the tests can see.
- A client-side text filter matches with `includesFolded(text, search)` and a Combobox filters with `filterOptionsByLabel` (`front/src/utils`), so accents, ligatures and case never hide a row; a client-sorted string compares with `compareText`, which `DataPageLayout` already applies to every column without its own `sortingFn` (`withTextAwareSorting`, also for a raw `DataTable` that sorts on the client). The text helpers come from `@app/utils/text-fold`, never the `@app/utils` root, which pulls server-only dependencies.
- A text search param is `urlSearchText` from `utils/url-search-text`, never a plain `z.string()`: TanStack Router's `parseSearch` runs `JSON.parse` on every value, so a purely numeric or `true`/`false` search term arrives as a `number`/`boolean` and fails a plain `z.string()`.
- A toggle carried in the address is `urlBoolean(default)` from `utils/url-boolean`, never `z.coerce.boolean()`, which reads the very string `'false'` — and every other non-empty spelling — as `true`.
- A list's search field is `DebouncedSearchField` from `components/shared`, given the committed search as `value` (its `useUrlListFilters` field, or a `useState` where the search stays out of the address, as in a drawer) and the write as `onCommit`. It holds the draft itself, so a keystroke re-renders the field and not the list: a draft held by the component that builds the rows re-renders every row per character, which froze a 500-row page for a second each time.
- The flush on blur `DebouncedSearchField` does through `useDebouncedDraft` is what keeps a search typed just before a row is clicked: the mousedown blurs the field while the list is still the current location, so the address is written before the router moves. Committing from the unmount cleanup instead (`flushOnExit`) does not work: the cleanup runs after the router has moved, so `to: '.'` resolves against the destination, landing the search on the detail address and replacing the history entry the reader wanted back.
- A list filters on the committed field, in memory and on the server alike: the draft never leaves the field. A burst of keystrokes costs one render of the list and, on a server-filtered list, one request. A side effect of a new search, such as going back to the first page, runs in `onCommit`, not on each keystroke.
- A filter whose values come from data rather than a fixed enumeration (a source, a family) goes through `resolveOptionFilter`: a value the tenant no longer has falls back to "no filter" once the options have loaded, so a link outliving its option opens the list instead of showing it empty.
- `resolveOptionFilter` answers which options a tenant *has*, never which strings name an option at all. When the server validates the field against a fixed enumeration (`source` against `INTEGRATION_SOURCES`), the URL schema declares that same enumeration with `.catch()`, so an invented `?source=` never reaches the query: the options are still loading on the first render, `resolveOptionFilter` passes the value through, and a tRPC validation error and its global toast are what the user would see.

### Shared components (`src/components/shared/`)

Reusable UI building blocks composed with hooks. Must be generic (no domain import).

| Component | Purpose | Paired with |
|---|---|---|
| `DeleteConfirmDialog` | AlertDialog wrapper with title/description/onConfirm | `useConfirmationDialog` hook |
| `FormDrawer` | Drawer wrapper with dirty-change protection (unsaved changes dialog). Supports **uncontrolled mode** (internal state when `trigger` is provided without `open`/`setOpen`) and **controlled mode** (explicit `open`/`setOpen`). | `useDirtyForm` hook for react-hook-form integration |
| `UnsavedChangesDialog` | The "discard or stay" question on leaving a modified form: `open`, `onStay` (every way out but Discard) and `onDiscard` | `FormDrawer`, a router blocker (`useSaveOnNext` hands its props) |
| `CreateNameForm` | Simple "create with name" form, used inside `FormDrawer` for entities needing only a name on creation | `FormDrawer` (must be rendered inside) |
| `ColumnSelector` | Column visibility/ordering panel | `useTableColumnOrdering` hook |
| `RouteTabs` | Tabs navigation for content pages with sub-routes (uses TanStack Router `linkOptions` + `@filigran/ui` `Tabs`) | Any page with a title and tab-based sub-navigation |
| `DetailPageLayout` | Top-level wrapper for any content page with a title and optional action bar | Detail pages, settings pages, configuration pages |
| `SectionCard` | Titled card section: a muted label above the card by default, `titleVariant="heading"` for a section title above it, `"inside"` for a section title within it (FDS `Text` `title-md`) | Inside `DetailPageLayout` children |
| `CardField` | Base labeled field primitive (muted title + arbitrary children) | Inside `SectionCard` — for custom content (badges, lists, chips) |
| `InfoField` | Simple string field (null-safe, displays `-` for missing values) | Inside `SectionCard` — for plain text fields |
| `DescriptionField` | Long-text field with `ExpandableText` overflow handling | Inside `SectionCard` — for description/definition fields |
| `DebouncedSearchField` | FDS `SearchField` owning its draft; reports only the committed search, after the debounce or on blur | `useUrlListFilters` field (or local state) as `value` |
| `AssetName` | A supporting asset's name: its own, else the name derived from its properties (muted, italic), else "Unnamed asset". Never write a local fallback (`-`, the id) | `assetNameText` (`src/utils/asset-name-utils.ts`) where the name goes in a string (aria-label, title, graph label, `<Trans>`) |
| `ActorName` | Who did something, wherever a service account can be the one: a person's name as text; a service account with its Security icon, named and linked to its page for a `MANAGE_SECURITY` holder, "Service account" without a link for anyone else. Never write a local fallback (empty cell, id prefix) | `resolveActor` (`src/utils/actor-utils.ts`) picks the actor from a user label and a service account |
| `KpiCard` | A KPI of a band above a list: label, formatted figure, the subtitle sizing it, a toned icon tile, an optional trend and info tooltip | A `grid` of them above the list, inside one `TooltipProvider` (findings, treatment plans) |
| `DashboardGroup` | FDS `Paper` section with a toned icon tile, its title and an optional action, holding `elevation={2}` sub-papers | CISO dashboard groups, a control's Overview sections |
| `SettingsCard` | FDS `Card` with a leading icon, its title and an optional trailing chip, filling its grid cell so the cards of a row share a height | A settings page laid out as a grid of at most two columns (Settings > Parameters) |
| `SettingsField` | A label above a 32px value row, so fields line up across the cards of a row | Inside `SettingsCard` |
| `CopyableValue` | An identifier shown in full beside a one-click copy button | An identifier support asks for: a tenant or instance id, a version |
| `LifelinePlot` | A walkable `Lifeline`: pointer snapping, arrow keys, guide, caller-rendered tooltip and live-region text, optional min and max on the axis, an optional back series on a shared `domain`, a `guideAt` drawn from another plot | `buildWindowedLifeline` for the series, `PeriodSelect` for the window |

#### Detail page composition

All detail/overview/settings pages **must** follow this composition hierarchy:

```
DetailPageLayout          ← page wrapper (title + action buttons)
├── SectionCard             ← logical grouping with a label
│   ├── InfoField           ← simple key/value (string)
│   ├── DescriptionField    ← long text with expand/collapse
│   └── CardField           ← custom content (badges, links, etc.)
└── SectionCard             ← additional sections as needed
```

**Rules:**
- Use `DetailPageLayout` as the outermost component in every content page with a title — never create ad-hoc heading + action bar layouts.
- A page whose identity block needs more than a title and actions — KPI tiles, chips, criticality, reporting sources — replaces `DetailPageLayout` with a dedicated `<Entity>HeaderPanel` component instead (see `AssetHeaderPanel`, `FindingHeaderPanel`), still followed by `RouteTabs` and `SectionCard`-based tab content. Do not reach for this pattern for a page a plain title and action bar already serve.
- Use `SectionCard` to group related fields — title prop accepts `t` macro for i18n (e.g., `title={t\`Details\`}`).
- Use `InfoField` for simple string values — it handles `null | undefined` by displaying `'-'`.
- Use `DescriptionField` for long text that may overflow — it wraps content in `ExpandableText`.
- Use `CardField` only when the value requires custom rendering (badges, links, formatted numbers) — pass children directly.
- Never use raw `Card`/`CardContent` from `@filigran/ui` for entity detail sections — always use `SectionCard`.
- A settings page made of independent cards in a grid (Settings > Parameters) uses `SettingsCard` and `SettingsField` instead, so the fields of one grid row line up across its cards.
- Use `grid grid-cols-2 gap-6` on a wrapper `div` for multi-column section layouts.

**Example:**
```tsx
<DetailPageLayout
  title={entity.name}
  actions={<Button onClick={openEdit}><Trans>Edit</Trans></Button>}
>
  <SectionCard title={t`Details`}>
    <InfoField title={t`Name`} value={entity.name} />
    <InfoField title={t`Category`} value={entity.category} />
    <DescriptionField title={t`Description`} value={entity.description} />
  </SectionCard>

  <SectionCard title={t`Related Items`}>
    <CardField title={t`Tags`}>
      <div className="flex flex-wrap gap-2">
        {entity.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)}
      </div>
    </CardField>
  </SectionCard>
</DetailPageLayout>
```

### Data page components (`src/components/ui/`)

Standardized layout components for list/grid pages. **All data tables must use these** — never use raw `DataTable` from `@filigran/ui` directly in feature code.

| Component | Purpose | When to use |
|---|---|---|
| `DataPageLayout` | Table-only layout with column ordering, pagination, optional row selection & bulk delete, optional rows unfolding into content of their own (`expandableRows`) | Read-only or simple table pages |
| `DataPageCardLayout` | Card grid layout with a toolbar showing entity count | Grid-only pages |
| `DataPageWithCards` | Composite table/grid with built-in view toggle | Entities that support both table and card views |
| `DataPageToolbar` | Shared toolbar (entity count, pagination, view toggle, create button) | Used internally by the above — rarely used standalone |
| `EntityCard` | Generic card with title, description, badges, logo, actions | Card rendering inside `DataPageWithCards` |
| `BadgeGroup` | Responsive badge list with overflow tooltip | Inside `EntityCard` or any card component |
| `ToggleGroup` | Icon/label toggle group (used for view switching) | Used internally by `DataPageWithCards` |

A server-paginated `DataPageLayout` gets `total`, `onServerPageChange`, `isLoading` and
`isPlaceholderData` from a query under `placeholderData: keepPreviousData`. `isLoading` means no
rows yet (skeleton rows). `isPlaceholderData` means the rows on screen belong to the previous page,
sort, filter or search: after 250 ms the layout dims them, makes them inert and shows a spinner by
the pager. Never pass `isFetching` to either, since it is also true on a background
refetch.

## Frontend tests

Where a test file goes, how to activate Lingui in one, and the three setups (pure util, hook,
component): [deep-dive](.github/instructions/writing-frontend-tests.instructions.md), which loads on a
test file.

## Query cache freshness — the SSE doorbell, not manual invalidation

The SSE doorbell (`providers/event-stream-provider.tsx`) subscribes every authenticated client to
`events.onDataChanged`, which names the query procedures a backend write made stale — the writer's
own session included. A mutation handler must not reach `queryClient.invalidateQueries(trpc.<path>.queryFilter())` /
`refetchQueries()` / `resetQueries()` directly: the doorbell already covers it, so a manual call is redundant at best.
`no-restricted-syntax` enforces this in `front/local.eslint.config.ts`.

A save sending several calls at once rings once per call, and each refresh redraws the page, which a
heavy page (the dependency graph) pays for in seconds. Such a save holds the doorbells for its
duration: `const holdDoorbells = useHoldDoorbells()` in the hook, `const release = holdDoorbells()`
before the calls and `.finally(release)` on their settled promise, and the page refreshes once for
everything rung meanwhile (`manage-dependencies-drawer.tsx`). The server rings for a write up to its
throttle window after the response, so the gate delivers 300 ms after the last release, and the last
call's doorbell joins the others. A request has no timeout, so the gate releases a hold by itself
after 15 s rather than let a stuck call stop the page's refreshes for good.

`router.invalidate()` is a different mechanism — the TanStack Router loader cache — and stays legal
everywhere; the lint rule does not flag it.

Three kinds of change the doorbell cannot carry, each of which may invalidate by hand:

- **A table that rings nothing.** The tables listed in `TABLES_WITHOUT_DATA_CHANGED_TRIGGER`
  (`module/src/db/migration-conventions.ts`) carry no change trigger, so a write to one of them —
  a session, the platform metadata holding the enterprise license — publishes no doorbell at all.
  A logged-out transition is the same case from the other end: the subscription is `skipToken`
  until the user is in.
- **A doorbell addressed to another tenant.** A stream is subscribed to the client's *current*
  tenant plus the globally-triggered tables, and nothing else. A write whose trigger resolves to a
  different tenant — creating or deleting a tenant, where `notify_data_changed_self_tenant` carries
  the new tenant's own id, or adding someone to a tenant they have not entered yet —
  never reaches that stream.
- **A refresh an immediate action depends on.** The doorbell is an asynchronous round-trip; code
  that must read the new state on the next line cannot wait for it.

Justify each such site inline with `// eslint-disable-next-line no-restricted-syntax -- <reason>`,
stating which of the three applies rather than what the line does.

## Query cache partition by tenant

The tenant travels in the `x-tenant-id` header, not in the tRPC key, so `TenantQueryClient`
(`providers/tenant-query-client.ts`) hashes every key together with `getCommittedTenantId()`: the
same procedure and input under two tenants, or under the platform scope, are two cache entries. A
query therefore never needs the tenant in its input, nor a client-side filter on `tenantId`, to keep
another tenant's result off the page. The doorbell invalidates by key prefix, so it reaches every
partition.

Each query's function runs inside `runInTenant` with the tenant its hash names, and the tRPC client
reads the request tenant (`getRequestTenantId()`) at the call and sends one batch per tenant
(`lib/tenant-batch-link.ts`). So a query the previous tenant's page still holds, refetched during a
switch, requests its own tenant. A direct `trpcClient` call made outside a query function carries the
committed tenant.

A mounted query picks up the new partition only when its component renders again. Pages under
`MainLayout` remount on a tenant switch, but a provider above the router does not, and would fall
back to its loading state on its next render. Such a query, when its procedure never reads the
tenant header, goes in the `tenantIndependentPaths` passed to `TenantQueryClient`.

## Route loaders and the query cache

The router context carries the `queryClient` and the tRPC options proxy (`trpc`), which the `Router`
component of `app.tsx` injects. A loader or a `beforeLoad` that needs data before its route renders
reads it with `context.queryClient.query(context.trpc.<path>.queryOptions(...))`, so that the
components' queries find the answer in the cache; a `trpcClient` call fills no cache entry, and the
component asks again. The `_auth` loader fills what the header renders this way
(`prefetchHeaderData`), with every failure tolerated, so a failed read never holds the page back. A
loader runs before its route commits its tenant: a query it fills under a tenant page must be in the
`tenantIndependentPaths`, or the component reads another partition. Only the `_auth` route has a
pending component (`RoutePendingComponent`), shown on a first load while its loader runs past the
router's pending delay: set router-wide, it would replace the header and the sidebar whenever a
layout route's new match (a scope or tenant change) waits on its loader.

## Number inputs in forms

Never wire `e.target.valueAsNumber` straight into `field.onChange`: an empty native number input
yields `NaN`, which passes `z.number()` and reaches the API. Use `NumberFormInput` from
`components/shared`, which maps a blank field to `undefined` and renders `undefined` / `NaN` as an
empty input.

## Screens that read threats

A member reads the threats mirrored from OpenCTI only as far as their own OpenCTI rights allow, so
every screen that lists or counts threats says why it may show fewer, by the category `xtm.readerAccess`
gives (`useReaderAccess`): `HiddenThreatsAlert` above a list (`ReaderAccessNotice` for a screen that already holds the
category), one `HiddenThreatsHint` in the title of a card of figures and none beside figures a
notice already sits above, a smaller number never read as a fact. Both render nothing while the reader misses no threat, and
neither is fed a flag by the screen's own procedure: the backend names a category only while the
tenant holds a mirrored threat the reader cannot read (`hasThreatHiddenFromUnresolvedReader`), so a
tenant with nothing mirrored yet, or only unmarked threats, is told nothing. An OpenCTI that runs a
token XTM One signed for the reader as nobody (`AUTH_REQUIRED`) is `no_account`: it cannot tell a
missing account from another way of not recognising the token, and the former is far likelier. In a
tenant that shows every member what the connector reads, an unresolved scope is the connector's own
read failing, whatever the cause: the category is `connector_unavailable`, which words no cause in
the member and asks an administrator, never a member's `not_linked` or `no_account`. The rows hanging off a threat follow it, so the
detail of a threat the member can read (hero, outcomes, CVE tab, techniques, relevance proof) is
complete and carries no message, and a link to a threat they may not read opens a page saying it is
hidden (`threats.isHidden`, the route's `notFoundComponent`), never "not found", unless that lookup fails. The page words why by `xtm.readerAccess`'s
`threatVisibility`: the reader's own OpenCTI rights when those decide (`per_member`), no cause in the
connector's mode or when the answer failed. The counterparts of an object are always read as the member,
whatever the tenant's threat visibility: the emblem surface says per product why one is empty
(`no-access` when it is not linked to XTM One or has no account for the reader, `unavailable` when
its token exchange or its lookup failed, the latter reported by `xtm.counterparts` as `unavailable`).

## React Compiler Guidance

- React Compiler is the default memoization strategy in `front`.
- Do not add `useMemo`, `useCallback`, or `React.memo` by default.
- Keep manual memoization only when identity stability is strictly required by an API and document the reason with an explicit ESLint disable comment near the import/use.
- Prefer computing derived UI data directly during render over storing mirrored derived state with `useEffect` + `setState`.
- For runtime debugging, use `"use no memo"` on a problematic component/hook to isolate compiler-related behavior, then remove it after the root cause is fixed.
