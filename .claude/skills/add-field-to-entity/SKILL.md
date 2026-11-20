---
name: add-field-to-entity
description: >-
  Adds a new column to an existing domain entity. Covers the Drizzle schema
  change, repository & service updates, tRPC router input/output schemas,
  platform seed data, integration tests, and migration generation.
  Use when asked to add a field, column, or property to an existing entity.
---

# Add a Field to an Existing Entity

## Prerequisites

Before starting, gather these inputs from the user:
- **Entity name** (e.g. `risk-scenarios`, `supporting-assets`, `attack-surfaces`)
- **Field name** (camelCase for TS, snake_case for DB column)
- **Column type** (`text`, `uuid`, `integer`, `bigint`, `boolean`, `timestamp`, etc.)
- **Nullable or required?** (`.notNull()` vs omitted)
- **Default value?** (`.default(...)` if any)
- **Is it a FK?** If yes, target table and cascade decision (see the three-category rule in the FK section below)

## Procedure

### Step 1 — Add the column in the schema (`module/src/modules/<entity>/schema.ts`)

Add the new column inside the `pgTable(...)` definition.

**Common column patterns:**

```ts
// Required text field
myField: text('my_field').notNull(),

// Nullable text field
myField: text('my_field'),

// Integer with default
myField: integer('my_field').notNull().default(0),

// Nullable FK (no cascade for entity-to-entity)
myFieldId: uuid('my_field_id').references(() => otherTable.id),

// Required FK
myFieldId: uuid('my_field_id').notNull().references(() => otherTable.id),

// Bigint with mode
myField: bigint('my_field', { mode: 'number' }),

// Boolean
myField: boolean('my_field').notNull().default(false),
```

> **Security note:** No changes needed in `module/src/security/`. The `SecuredSchema` uses `getTableColumns(table)` which auto-picks up new columns. Same for `ProtectedDB` which uses `table.$inferInsert`.

> **Registration note:** No changes needed in `module/src/modules/schema.ts` or `module/src/modules/index.ts` — those only need updates when adding a *new* module, not a new field.

### Step 2 — Update the repository (`module/src/modules/<entity>/repository.ts`)

**Read the existing file first.** The repository dictates which methods exist and how they reference columns. Only update what is already there — do not add new methods.

Two patterns exist in the codebase:

#### Pattern A — Explicit column listing

If the repository lists columns explicitly in `.select({...})` blocks and in the insert method's values type, add the new field to each:

- **Insert method** — add the field (with the correct TS type) to the existing explicit values type.
- **Every `.select({...})` block** — add the field to the selection object, following the existing naming convention.
- **Update method** — typically uses `Partial<typeof table.$inferInsert>` which **auto-picks up** the new field. No change needed.

#### Pattern B — `select()` with no column list

If the repository uses `.select()` with no arguments, read methods **auto-pick up** the new column. Only update the insert method if one exists.

### Step 3 — Update the service (`module/src/modules/<entity>/service.ts`)

**Read the existing file first.** Only update methods that already exist — do not create new ones.

- If the service has a **create method** with an explicit values type, add the new field to that type.
- If the service has an **update method** with an explicit values type, add the new field as optional.
- If the service uses `InferRepository` to forward args (read-only pattern), no change is needed for reads.
- If the service has **business logic** that validates or transforms fields (e.g. mutual exclusion checks), assess whether the new field requires similar logic. Only add validation if the feature demands it.

### Step 4 — Update the tRPC router (`back/src/features/app-router/<entity>/<entity>-router.ts`)

**Read the existing file first.** Only update procedures that already exist.

1. **Input Zod schemas** — if the router has create/update procedures, add the new field to their existing `.input(z.object({...}))` blocks. Use the Zod type that matches the Drizzle column (see reference table below). For update inputs the field must be `.optional()`.

2. **Output schema** — if the router uses `createSelectSchema(table)` from `drizzle-zod`, the new column is included automatically — **no change needed**. If the router defines an extended output schema (`.extend({...})`), verify it still works (`.extend()` doesn't remove existing fields).

**Zod type reference (only for mapping column types):**

| Column type | Zod (create) | Zod (update) |
|---|---|---|
| `text().notNull()` | `z.string()` or `z.string().min(1)` | `z.string().optional()` |
| `text()` (nullable) | `z.string().nullable()` | `z.string().nullable().optional()` |
| `integer().notNull()` | `z.number().int()` | `z.number().int().optional()` |
| `integer().notNull().default(0)` | `z.number().int().min(0).max(100)` | `z.number().int().optional()` |
| `uuid().notNull()` | `z.uuid()` | `z.uuid().optional()` |
| `uuid()` (nullable FK) | `z.uuid().nullable()` | `z.uuid().nullable().optional()` |
| `boolean().notNull()` | `z.boolean()` | `z.boolean().optional()` |
| `bigint({ mode: 'number' })` | `z.number().nullable()` | `z.number().nullable().optional()` |

### Step 5 — Update the platform seed (if a seeder exists)

Check if a seeder exists at `module/src/platform-seed/seeders/<entity>-seeder.ts`.

If it does, add the new field value to every seed record:

```ts
await db.insert(myEntity).values([
  {
    id: MyEntity_One,
    name: 'Acme Entity 1',
    myNewField: 'realistic value', // ← add here
  },
]);
```

**Rules for seed data:**
- Provide realistic, meaningful values — not placeholders
- If the field is nullable, use `null` for some records and real values for others (to test both paths)
- If the field has a default, you may omit it in some records to test the default behavior
- Update records for **both tenants** (Acme + Tarnwick)

If the seeder uses `services.withOrigin(origin)` instead of `db.insert()`, update the service call payload too.

> **Closed reference catalogs** (attack outcomes, loss categories, loss drivers, business-value
> categories, countries) have no platform seeder and no create/update endpoints. Their rows come
> from a source constant provisioned per tenant by a tenant seeder. For the loss model, each
> catalog's source constant lives in its own module's `data.ts` (`attack-outcomes/data.ts`,
> `business-value-categories/data.ts`, `loss-drivers/data.ts`), built into rows by that module's
> `provision.ts`, and upserted for all four catalogs by `loss-drivers/seeder.ts`. Adding a field
> there means extending the constant and the row builder in the owning module, not a seeder
> record.

### Step 6 — Update integration tests (if they exist)

Check `integration-tests/src/tests/service/<entity>.test.ts`.

**Read the existing tests first.** Only update tests that are affected by the new field:

- If existing creation calls now fail because the field is required (`.notNull()` with no default), add the field to those payloads with a realistic test value.
- If existing assertions check the full shape of a returned entity, add the new field to those assertions.
- Only add a **dedicated test** for the new field if it has validation logic or business rules that need coverage — don't add tests for simple passthrough fields.

### Step 7 — Generate the migration

```bash
cd module && yarn db:generate
```

This produces:
- A new `NNNN_<random_name>.sql` file in `module/src/db/migrations/` (e.g. `ALTER TABLE "my_entity" ADD COLUMN "my_field" text;`)
- An updated `meta/_journal.json` with the new migration entry
- A new `meta/NNNN_snapshot.json` capturing the full schema state

**Verify:** open the generated `.sql` file and confirm it contains the expected `ALTER TABLE ... ADD COLUMN` statement.

### Step 8 — Verify everything compiles and passes

```bash
yarn check-ts       # No type errors across all workspaces
yarn lint           # No lint errors
yarn test           # All unit tests pass
```

If integration tests were updated:
```bash
cd integration-tests && yarn test src/tests/service/<entity>.test.ts
```

If the platform seed was updated:
```bash
cd integration-tests && yarn test src/tests/service/platform-seed.test.ts
```

## What auto-picks up new fields (no manual change needed)

| Layer | Auto-picks up? | Why |
|---|---|---|
| `SecuredSchema` (views) | **Yes** | Uses `getTableColumns(table)` |
| `ProtectedDB` | **Yes** | Uses `table.$inferInsert` |
| Repository `update` method (`Partial<$inferInsert>`) | **Yes** | Infers from table type |
| Repository `select()` with no args | **Yes** | Selects all columns |
| tRPC output via `createSelectSchema()` | **Yes** | Generates Zod from Drizzle table |
| `module/src/modules/schema.ts` | **Yes** | Already re-exports the entity schema |
| `module/src/modules/index.ts` | **Yes** | Same service, no change |

## What requires manual updates (checklist)

**Read each file before editing.** Only modify what the existing code requires — do not add methods, procedures, or tests that don't already exist.

| # | File | Action |
|---|---|---|
| 1 | `module/src/modules/<entity>/schema.ts` | Add the column definition |
| 2 | `module/src/modules/<entity>/repository.ts` | Add to existing insert values type + existing explicit `select({...})` blocks (if applicable) |
| 3 | `module/src/modules/<entity>/service.ts` | Add to existing create/update method type signatures (if applicable) |
| 4 | `back/src/features/app-router/<entity>/<entity>-router.ts` | Add to existing input Zod schemas (if create/update procedures exist) |
| 5 | `module/src/platform-seed/seeders/<entity>-seeder.ts` | Add field values to existing seed records (if seeder exists) |
| 6 | `integration-tests/src/tests/service/<entity>.test.ts` | Update affected payloads and assertions (if tests exist) |
| 7 | Run `cd module && yarn db:generate` | Generate migration SQL + snapshot |

## Adding a FK field (extra steps)

When the new field is a foreign key reference to another table:

1. **Import the referenced table** in `schema.ts`:
```ts
import { otherEntities } from '../other-entities/schema';
```

2. **Add `.references()`** on the column:
```ts
myFieldId: uuid('my_field_id').references(() => otherEntities.id),
```

3. **Update repository reads** to join the related table if you need to return related data:
```ts
.leftJoin(otherEntities, eq(views.myEntity.myFieldId, otherEntities.id))
```

4. **Update the tRPC output schema** if you added a join — extend the base schema:
```ts
const MyEntityWithRelationsSchema = MyEntitySchema.extend({
  relatedEntity: RelatedEntitySchema.nullable(),
});
```

5. **`onDelete` depends on the relationship type** — three cases:
   - **Junction table** (composite PK): `onDelete: 'cascade'` on both sides, mandatory.
   - **Owned/child entity** — the row has no meaning without the parent (e.g. settings whose PK *is* the parent FK, audit events, computed runs, hierarchical children): `onDelete: 'cascade'` on the FK to the owning parent.
   - **Loose association** — the entity *references* another but is not owned by it (e.g. a control referencing its evaluator, an assessment referencing a framework): **no cascade**. If the FK column is nullable, prefer `onDelete: 'set null'` so the row survives deletion of the referenced entity.

   Quick heuristic: *"does this row lose all meaning if the referenced row disappears?"* — yes → cascade; no → no cascade (or `set null`).

## Common pitfalls

- **Forgetting explicit selects** — if the repository uses `.select({ ... })` with explicit columns (Pattern A), the new field won't appear in query results until added to every select block.
- **Forgetting the update input** — the tRPC update input must include the field as `.optional()`, otherwise clients can't update it.
- **Not running `db:generate`** — CI runs `check-migrations.ts` which verifies migrations are in sync. Uncommitted migrations will fail CI.
- **Seed data out of sync** — if a seeder inserts into the table with explicit column values and the new field is `.notNull()` with no default, the seed will crash at runtime.
- **Field with `.notNull()` and no `.default()`** — the migration will fail on existing data. Either make the field nullable, add a default, or use a two-step migration (add nullable → backfill → alter to not null).
