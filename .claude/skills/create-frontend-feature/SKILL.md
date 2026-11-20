---
name: create-frontend-feature
description: >-
  Scaffolds a complete frontend feature in front: data table, detail
  page, route files, menu entry, i18n extraction, and tests. Use when asked
  to create a new page, feature, or frontend module.
---

# Create Frontend Feature

## Prerequisites

Gather from the user:
- **Domain name** (kebab-case, e.g. `risk-assessments`)
- **Menu section**: Threat Center, Assets, Catalogs, Controls, Integrations, Organizations, Platform, Settings, or a new section
- **View type**: table-only, grid-only, or grid/table toggle
- **CRUD operations**: which are needed (list, detail, create, update, delete)
- **Parent context**: tenant-level or nested under organization

## Procedure

### Step 1 — Create the feature directory

```
front/src/features/<domain>/
├── components/
│   ├── <domain>-data-table.tsx     # List view
│   ├── <domain>-card.tsx           # Grid card (if grid view)
│   ├── <domain>-create-drawer.tsx  # Create form (drawer or full page)
│   └── <domain>-update-drawer.tsx  # Update form
└── <domain>-utils.ts               # Pure logic (validation, formatting)
```

### Step 2 — Create the data table component

Use `DataPageLayout` (table-only) or `DataPageWithCards` (table + card grid toggle) from `../../../components/ui/data-page-layout`.

**Table-only example** (follow `mitre-tactics-data-table.tsx`):
```tsx
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';

export const MyEntitiesDataTable = () => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.myEntities.getMyEntities.queryOptions());

  const columns: Array<ColumnDefWithOptionsHeader<MyEntity, unknown>> = [
    { id: 'name', accessorKey: 'name', header: t`Name`, size: 200 },
  ];

  return (
    <DataPageLayout
      data={data ?? []}
      columns={columns}
      isLoading={isLoading}
      storageKey="myEntities"
      onCreate={() => { /* open create drawer */ }}
      onClickRow={(row) => handleNavigate(row.original.id)}
      onDeleteItems={(ids) => deleteMutation.mutate(ids)}
    />
  );
};
```

**Table + Card grid example** (follow `risk-scenarios-data-table.tsx`):
```tsx
import { DataPageWithCards } from '../../../components/ui/data-page-layout';

<DataPageWithCards
  data={data ?? []}
  columns={columns}
  isLoading={isLoading}
  storageKey="myEntities"
  defaultView="grid"
  onCreate={handleAdd}
  onClickRow={(row) => handleNavigate(row.original.id)}
  onDeleteItems={(ids) => deleteMutation.mutate(ids)}
  renderCard={(item) => <MyEntityCard key={item.id} {...item} />}
/>
```

**Key patterns:**
- Use `DataPageLayout` or `DataPageWithCards` — never raw `DataTable` from `@filigran/ui`
- Use `useQueryClient()` with `trpc.<path>.queryFilter()` for cache access
- Use `useConfirmationDialog()` + `DeleteConfirmDialog` for single-item delete flows
- Pass `onDeleteItems` to `DataPageLayout`/`DataPageWithCards` for built-in bulk delete
- Use `t` backtick for translated strings, `<Trans>` for JSX with interpolation
- Use `useNavigate` with `from`/`to` for relative routing
- Success toasts: sentence case with period (e.g. `` t`Entity created successfully.` ``)

### Step 3 — Create the route files

**List route** (`src/routes/_auth/$tenantId/<menu-section>/<domain>/index.tsx`):
```tsx
import { createFileRoute } from '@tanstack/react-router';
import { MyEntitiesDataTable } from '../../../../features/<domain>/components/<domain>-data-table';

export const Route = createFileRoute('/_auth/$tenantId/<menu-section>/<domain>/')({
  component: MyEntitiesDataTable,
});
```

**Detail route** (`src/routes/_auth/$tenantId/<menu-section>/<domain>/$myEntityId.tsx`):
```tsx
import { createFileRoute } from '@tanstack/react-router';
import { trpcClient } from '../../../../lib/trpc';

export const Route = createFileRoute('/_auth/$tenantId/<menu-section>/<domain>/$myEntityId')({
  loader: async ({ params }) => {
    const data = await trpcClient.myEntities.getMyEntity.query(
      { id: params.myEntityId },
      { context: { tenantId: params.tenantId } },
    );
    return { data, crumb: data?.name ?? '' };
  },
  component: MyEntityDetailPage,
});
```

**Detail page with tabs** — follow `$supportingAssetId.tsx` pattern:
- Use `RouteTabs` from `../../../components/shared` for entity-level tab navigation
- Define tabs with `key`, `label`, and `linkOption` (using TanStack Router `linkOptions()`)
- Use `<Outlet />` for nested routes
- Create sub-routes: `$myEntityId/overview.tsx`, `$myEntityId/index.tsx` (redirect to overview)

```tsx
import { RouteTabs } from '../../../../../components/shared';
import { linkOptions, Outlet } from '@tanstack/react-router';

const tabs = [
  { key: 'overview', linkOption: linkOptions({ from: '.../$myEntityId', to: 'overview' }), label: t`Overview` },
  { key: 'details', linkOption: linkOptions({ from: '.../$myEntityId', to: 'details' }), label: t`Details` },
];

return (
  <div className="flex flex-col gap-6">
    <RouteTabs tabs={tabs} />
    <Outlet />
  </div>
);
```

> **Note**: `NavToolbarMenu` is still used for section-level sub-navigation (e.g., threat center, settings engine) but NOT for detail page tabs.

### Step 4 — Add the menu entry

Navigation is the FDS Navbar. Add a node to `getScopeNavigationNodes` in
`src/components/layout/main-layout/fds-navbar/nav-model.tsx`, in the section the entry belongs to.
A tenant entry links out of any scope, so it takes the tenant's `params`:

```tsx
{ kind: 'single', id: 'my-entities', label: t`My Entities`, icon: Target, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/my-entities', params })) },
```

A surface a risk scope owns goes in `scopeEntries` instead, which every scope's submenu repeats.
Add `visible:` when the entry depends on a capability. A group of entries is `kind: 'group'` with an
`entries` array, and a titled section is a `kind: 'separator'` then a `kind: 'title'`.
`nav-model.test.ts` covers the model, so run it after the change.

### Step 5 — Extract i18n strings

```bash
cd front && yarn i18n:extract
```

Then translate new entries in `src/locales/fr/messages.po`.

```bash
yarn i18n:compile  # Verify compilation
```

### Step 6 — Create tests

**Pure utils** (`<domain>-utils.test.ts`):
```ts
import { describe, expect, it } from 'vitest';
import { myPureFunction } from './<domain>-utils';

describe('myPureFunction', () => {
  it('should compute expected result', () => {
    expect(myPureFunction(input)).toBe(expected);
  });
});
```

**Hook tests** (`use-<hook>.test.ts`):
```ts
/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
```

### Step 7 — Verify

```bash
cd front && yarn test              # Unit tests pass
yarn check-ts                               # No type errors
yarn lint                                   # No lint errors
yarn i18n:check                             # i18n in sync
```

## Pattern Reference

| Component | Pattern source |
|---|---|
| Table-only data page | `mitre-tactics-data-table.tsx` (uses `DataPageLayout`) |
| Grid/table toggle | `risk-scenarios-data-table.tsx` (uses `DataPageWithCards`) |
| Entity card | `risk-scenario-card.tsx` (uses `EntityCard` + `BadgeGroup`) |
| Data table with accordion | `loss-drivers-data-table.tsx` (read-only catalog grouped by loss category) |
| Create drawer (side panel) | `budget-review-create-drawer.tsx` (uses `FormDrawer` + `DrawerForm`) |
| Full-page wizard | `risk-scenario-wizard.tsx` |
| Detail page with tabs | `$supportingAssetId.tsx` (uses `RouteTabs`) |
| Section sub-navigation | `settings/taxonomies/route.tsx` (`TaxonomiesToolbarMenu`, built on `NavToolbarMenu`) |
| Navigation entry | `fds-navbar/nav-model.tsx` (`getScopeNavigationNodes`) |
| Select component (single) | `sector-select.tsx` |
| Multi-select form field | `group-update.tsx` (uses `MultiSelectField` from `src/components/shared`) |

## Rules

- **No default exports** (except route files which use `createFileRoute`)
- **No `useLingui()`** — use `t` macro from `@lingui/core/macro` by default; use `i18n._({ id, message, values })` for dynamic string props in compiler-sensitive paths
- **No object properties in `<Trans>`** — destructure to local variables first
- **Extract pure logic** to `*-utils.ts` for testability
- **Return error codes** from backend validation, not i18n strings
- **Import shared formatters directly** from `src/utils/` (no aliases)
- Route files in `src/routes/` are exempt from filename linting (TanStack Router patterns)
