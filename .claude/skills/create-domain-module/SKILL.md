---
name: create-domain-module
description: >-
  Scaffolds a complete domain module in the OpenCRQ monorepo: Drizzle schema,
  repository, service, barrel export, module registration, DB migration,
  tRPC router, and integration test. Use when asked to create a new entity,
  domain, or backend module.
---

# Create Domain Module

## Prerequisites

Before starting, gather these inputs from the user:
- **Domain name** (kebab-case, e.g. `risk-assessments`)
- **Scope**: tenant-scoped (`tenantId` column) or organization-scoped (`organizationId` column)
- **Columns**: list of fields with types
- **Relations**: any FK references to other entities
- **Junction tables**: any many-to-many relationships
- **Read-only or full CRUD?**

## Procedure

### Step 1 — Create the schema (`module/src/modules/<domain>/schema.ts`)

```ts
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies } from '../../security';
import { tenantIsolationPolicy } from '../../security/policies/tenant-policies';
// For org-scoped: import { organizationTenantIsolationPolicy } from '../../security/policies/tenant-policies';
import { tenants } from '../tenants';
// For org-scoped: import { organizations } from '../organizations';

export const myEntities = pgTable('my_entities', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  // For org-scoped: organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  description: text('description'),
});

defineSecurityPolicies(myEntities, tenantIsolationPolicy);
// For org-scoped: defineSecurityPolicies(myEntities, organizationTenantIsolationPolicy);
```

**Junction tables** must use composite PK + `onDelete: 'cascade'` on both FKs:
```ts
export const myEntityRelations = pgTable('my_entity_relations', {
  myEntityId: uuid('my_entity_id').notNull().references(() => myEntities.id, { onDelete: 'cascade' }),
  relatedId: uuid('related_id').notNull().references(() => relatedTable.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.myEntityId, table.relatedId] }),
]);
```

**Entity-to-entity FKs must NOT cascade** (no `onDelete: 'cascade'`).

### Step 2 — Create the repository (`module/src/modules/<domain>/repository.ts`)

```ts
import { eq, inArray } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { myEntities } from './schema';

export const myEntitiesRepository = defineRepository({
  insertMyEntity: ({ db }, values: typeof myEntities.$inferInsert) =>
    db.insert(myEntities).values([values]),

  findMyEntityById: async ({ db, views }, id: string) =>
    db.select().from(views.myEntities).where(eq(views.myEntities.id, id)).then((r) => r[0]),

  findAllMyEntities: async ({ db, views }) =>
    db.select().from(views.myEntities),

  updateMyEntity: ({ db }, id: string, values: Partial<typeof myEntities.$inferInsert>) =>
    db.update(myEntities).set(values).where(eq(myEntities.id, id)),

  deleteMyEntities: ({ db }, ids: string[]) =>
    db.delete(myEntities).where(inArray(myEntities.id, ids)),
});
```

**Key rules:**
- **Reads** use `views.*` (security-filtered)
- **Writes** use `db.insert/update/delete` (policy-enforced via ProtectedDB)

### Step 3 — Create the service (`module/src/modules/<domain>/service.ts`)

```ts
import { defineService } from '../../registry';
import { myEntitiesRepository } from './repository';

export const myEntitiesService = defineService(
  'myEntities',
  myEntitiesRepository,
).implement({
  createMyEntity: async ({ atomic, eventOrigin }, values) => {
    await atomic(async ({ repo: atomicRepo }) => {
      await atomicRepo.insertMyEntity({
        ...values,
        tenantId: eventOrigin.tenantId,
      });
    });
  },

  getMyEntity: async ({ repo }, id) =>
    await repo.findMyEntityById(id),

  getMyEntities: async ({ repo }) =>
    await repo.findAllMyEntities(),

  updateMyEntity: async ({ atomic }, id, values) => {
    await atomic(async ({ repo: atomicRepo }) => {
      await atomicRepo.updateMyEntity(id, values);
    });
  },

  deleteMyEntities: async ({ repo }, ids) =>
    await repo.deleteMyEntities(ids),
});
```

**If the service depends on other services**, chain `.dependsOn()`:
```ts
export const myEntitiesService = defineService('myEntities', myEntitiesRepository)
  .dependsOn(() => [otherService])
  .implement({ ... });
```

### Step 4 — Create the barrel export (`module/src/modules/<domain>/index.ts`)

```ts
export * from './schema';
export * from './repository';
export * from './service';
```

### Step 5 — Register the module

1. **`module/src/modules/schema.ts`** — add `export * from './<domain>/schema';`
2. **`module/src/modules/index.ts`** — import the service, re-export the module, and add to `allServiceDefinitions`:

```ts
import { myEntitiesService } from './<domain>/service';
export * from './<domain>';

export const allServiceDefinitions = [
  // ... existing services
  myEntitiesService,
] as const;
```

### Step 6 — Generate the migration

```bash
cd module && yarn db:generate
```

Verify the generated SQL file in `module/src/db/migrations/`.

### Step 7 — Create the tRPC router (`back/src/features/app-router/<domain>/<domain>-router.ts`)

```ts
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

export const myEntitiesRouter = (procedure: TenantProcedure) => router({
  createMyEntity: procedure
    .input(z.object({ id: z.uuid(), name: z.string() }))
    .mutation(async ({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).myEntities.createMyEntity(input)),

  getMyEntity: procedure
    .input(z.object({ id: z.uuid() }))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).myEntities.getMyEntity(input.id)),

  getMyEntities: procedure
    .query(({ ctx: { services, origin } }) =>
      services.withOrigin(origin).myEntities.getMyEntities()),

  deleteMyEntities: procedure
    .input(z.object({ ids: z.array(z.uuid()) }))
    .mutation(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).myEntities.deleteMyEntities(input.ids)),
});
```

### Step 8 — Register the router in `app-router-router.ts`

```ts
import { myEntitiesRouter } from './<domain>/<domain>-router';

// Inside appRouter:
myEntities: myEntitiesRouter(authProcedure),
```

### Step 9 — Create the integration test

Follow the `add-integration-test` skill for the detailed procedure.

### Step 10 — Verify

```bash
cd module && yarn db:generate    # Migration in sync
yarn check-ts                             # No type errors
yarn lint                                 # No lint errors
cd integration-tests && yarn test src/tests/service/<domain>.test.ts  # Tests pass
yarn notice:check                         # Data files registered
```

A module that ships reference data (a `data/` directory, a catalogue `.ts`, a `.generated.ts`) names each of its files in `scripts/notice/registry.mjs`, as first-party data or under the third-party entry whose content it copies, and runs `yarn notice:build`.

## Security Policy Reference

| Scope | Policy to use | Table has |
|---|---|---|
| Tenant-scoped (direct `tenantId`) | `tenantIsolationPolicy` | `tenantId` column |
| Child of a tenant-scoped parent (preferred) | `tenantIsolationPolicy` | `tenantId` column, and a composite FK `(parent_id, tenant_id)` → the parent's `UNIQUE (id, tenant_id)` (see `risk_scenarios`, `organization_assets`) |
| Org-scoped (via `organizationId`) | `organizationTenantIsolationPolicy` | `organizationId` column |
| Via FK to tenant-scoped parent | A `parentScopedPolicy` (see `attackOutcomeTenantIsolationPolicy`) | FK to parent table |
| Via FK chain (parent → org → tenant) | A `parentScopedPolicy` (see `primaryAssetTenantIsolationPolicy`) | FK chain |

Prefer the table's own `tenantId`: a tenant-wide read then filters on an index leading with it, where a
parent-scoped policy joins the whole parent table, and the composite FK refuses a cross-tenant
reference that a plain FK lets through. A new parent-scoped policy is one
`parentScopedPolicy(key, parentInTenant)` entry in `module/src/security/policies/tenant-policies.ts`.
