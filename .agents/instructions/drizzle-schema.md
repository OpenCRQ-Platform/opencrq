---
applyTo: "module/src/modules/**/schema.ts,module/src/db/**"
description: "Drizzle schema conventions: forbidden column types, migration rules, and FK cascade guidelines"
---

# Drizzle Schema Conventions

## Forbidden: `jsonb` columns

**Never use `jsonb` columns in schema files.** The ESLint rule `no-restricted-syntax` (via `drizzleSchemaRules`) will report an error at each `jsonb()` call site in schema files.

### Why

- `jsonb` bypasses Drizzle's type system — column shape changes are invisible to TypeScript and to migrations.
- JSON blobs cannot be indexed, joined, or queried efficiently.
- Schema evolutions inside a blob accumulate silently, making future migrations painful.

### What to do instead

Model the data as a proper relational table:

```ts
// ❌ Forbidden
import { jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';

export const things = pgTable('things', {
  id: uuid('id').primaryKey(),
  metadata: jsonb('metadata').$type<{ key: string; value: string }[]>(),
});

// ✅ Correct — separate table with real columns
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const things = pgTable('things', {
  id: uuid('id').primaryKey(),
});

export const thingMetadata = pgTable('thing_metadata', {
  id: uuid('id').primaryKey(),
  thingId: uuid('thing_id').notNull().references(() => things.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
});
```

### Justified exception (rare)

If `jsonb` is truly unavoidable (e.g. storing opaque third-party payloads with no defined shape), disable the rule **inline** with a justification:

```ts
// eslint-disable-next-line no-restricted-syntax -- stores raw OpenCTI webhook payload, shape is externally defined
  data: jsonb('data'),
```

Keep such exceptions to an absolute minimum. They require peer review.

### Generic / polymorphic tables

A **generic table** is one designed to hold heterogeneous data whose shape varies per row (e.g. an audit log, an event bus, a key-value store for arbitrary metadata). In this specific case, `jsonb` may be acceptable **only if all of the following hold**:

1. The column's shape genuinely varies per row and cannot be modelled as a fixed set of typed columns.
2. No query will ever need to filter, sort, or join on fields inside the JSON blob.
3. The owning team has explicitly agreed there is no relational alternative.

Even then, always pair `jsonb` with `.$type<YourUnion>()` so TypeScript retains as much type information as possible, and document the accepted shape in a comment above the column.

## Required: a change-notification trigger on every new table

Every table must carry a `<table>_notify_data_changed` trigger. `yarn db:check` scans the migration files for one per table and fails when a table has none, except for the tables listed in `TABLES_WITHOUT_DATA_CHANGED_TRIGGER` (`module/src/db/migration-conventions.ts`): `sessions`, `platform_metadata`, `workers`, `job_logs` and `job_dependencies`. That file records why each one is exempt, and is the only place that rationale belongs: add a table to the set only with the same kind of justification beside it. What the doorbell ignores is under [Sync dates and the doorbell](#sync-dates-and-the-doorbell), not there.

**That check is silent outside CI, and a local `yarn ci` reads as a pass.** `module/scripts/check-migrations.ts` exits 0 after printing `Skipping migration check` unless `CI=true`, so nothing verifies the triggers until the pull request runs. It then compares the migrations folder against the git index, so it only sees a migration that is already committed. Commit the migration, then run `CI=true yarn db:check` from `module`.

**Drizzle never generates these.** Hand-append the `CREATE TRIGGER` statement to the migration `yarn db:generate` produced, after the table's own statements:

```sql
CREATE TRIGGER my_entities_notify_data_changed
  AFTER INSERT OR UPDATE OR DELETE ON my_entities
  FOR EACH ROW EXECUTE FUNCTION notify_data_changed_tenant();
```

Pick the function from how the row reaches its tenant, stopping at the first table that carries a `tenant_id` column, the row's own included: each hop is one more lookup on every write.

| Table carries | Function |
|---|---|
| A direct `tenant_id` column | `notify_data_changed_tenant()` |
| No `tenant_id`, and an FK to a table that carries one | `notify_data_changed_tenant_via_fk('<fk_column>', '<parent_table>')` |
| No `tenant_id`, and an FK to a table without one that has an FK to a table carrying it | `notify_data_changed_tenant_via_2hop_fk('<fk>', '<parent>', '<parent_fk>', '<grandparent>')` |
| Nothing tenant-scoped (platform reference data) | `notify_data_changed_global()` |

`integration-tests/src/tests/service/doorbell-topology.test.ts` fails on a `via_fk` or `via_2hop_fk` trigger that goes past that first table, or whose arguments name a foreign key the schema does not have.

If you regenerate the migration for any reason, re-append the triggers: regeneration overwrites the file and silently drops hand-written SQL.

Re-order by hand, too, when a composite foreign key targets a `UNIQUE (id, tenant_id)` the same migration adds: `db:generate` emits the foreign key before the unique constraint, and a fresh database then fails with "there is no unique constraint matching given keys".

## Sync dates and the doorbell

A sync that re-confirms what it already reported must wake nothing: a doorbell wakes the observed jobs and the refetched queries, and each recomputes on rows that did not change.

- `updated_at` moves only when a value of the row really changes.
- `last_reported_at` is the last time a sync went over the row, changed or not. A table carries it only where that date is read (display, staleness, reconciliation).
- `last_seen_at` is when the source last observed the thing.
- `last_ingested_at` (`threat_analyses` only) is the last time an ingestion went over the threat, changed or not.

The doorbell ignores `last_reported_at`, `last_seen_at` and `last_ingested_at` when they are the only columns that changed. So nothing a doorbell wakes may compute on them: only the flow that writes them does. A projection may copy or rank on them (the asset reprojection copies the sources' `last_seen_at` and ranks sources on it) when the sync that writes them reprojects in the same flow.

A table nobody reads a confirmation date from carries none, and a re-confirmation writes nothing. `cve` is that case: a FIRST or CISA pass goes over each CVE a tenant holds, an NVD pass over the CVEs it fetched and the records NVD modified since the last one, and no column records the visit.

Write a sync upsert so a re-confirmation is a no-op (`module/src/db/write-guards.ts`):

- `setWhere: valuesChange(table, set)` skips the row when no column of the `set` would change. The sync dates count, so a date that moved alone is still written, without ringing.
- `updatedAt: updatedAtOnDataChange(table, set)` moves `updated_at` only when a column other than the sync dates (`SYNC_DATE_COLUMNS`) changes. It stamps `now()`, which carries microseconds: a table whose `updated_at` is read back as a `Date` and compared for equality (a watermark guard) passes the instant as a third argument.
- Leave `setWhere` out when the method relies on `RETURNING`: a skipped conflict row is not returned. `updatedAtOnDataChange` alone keeps `updated_at` still, and the identical rewrite stays silent at the doorbell.
- Write a link table or a child set as a diff with `diffRows` (`module/src/db/row-diff.ts`), never delete-then-insert: that rings once per row even when the set is the same.

`app/no-unguarded-rewrite` checks the last two in the repositories: a batch upsert moving `updatedAt` with no guard, and a delete then insert of one table in one function that does not diff.

Do not name a column `last_reported_at` or `last_seen_at` when a doorbell-driven reader depends on its movement:

- `asset_evidence.evaluated_at`: finding-score and control-validation compute on it.
- `opencti_stream_objects.updated_at` and `pending`: the rebuild job clears `pending` against the `updated_at` it read.
- `threat_analyses.updated_at`: the watermark of the threat recomputes. It moves when an attribute of the threat or any claim of its claim tables changes, never on a re-ingestion that states the same.
- `supporting_asset_sources.updated_at`: attribute resolution ranks sources on the later of it and `last_seen_at`, so it stays the date their values, property block included, last changed.

A table carrying a sync date names it in its trigger's trailing arguments: `notify_data_changed_tenant('last_seen_at')`, or after the two of `notify_data_changed_tenant_via_fk('<fk_column>', '<parent_table>', 'last_reported_at')`. Only these two functions read them (a migration that redefines one keeps the masking of every date in `SYNC_DATE_COLUMNS`), and a table without arguments pays nothing beyond the plain row comparison. `SYNC_DATE_COLUMNS` (`module/src/db/write-guards.ts`) is the list, and `integration-tests/src/tests/runtime/doorbell-sync-dates.test.ts` checks that every trigger names exactly the table's columns from it, on one of these two functions.

A new connector sync adds a test that replays it over the same source data inside `expectReplayedSyncSilent` (`integration-tests/src/helpers/replayed-sync.ts`): it fails on any table that rings or whose `updated_at` moves, except the `bookkeepingTables` the caller names, which hold one row per run or stream.

## Other schema conventions

- **UUIDv7** for all entity IDs (`uuidv7` package). User-related IDs may differ — follow existing patterns.
- **A descending index column states its nulls order.** `.desc()` alone emits `DESC NULLS LAST`, which
  serves only a sort written `desc nulls last`: `orderBy(desc(col))` sorts `DESC NULLS FIRST`, and
  Postgres then sorts the rows rather than walk the index, even on a NOT NULL column. Write
  `.desc().nullsFirst()` for reads ordered by `desc(...)` (scanned backwards it also serves
  `asc(...)`), `.desc().nullsLast()` for reads ordered `desc nulls last`.
  `app/no-implicit-index-nulls-order` enforces it. A list sorting missing values last in both
  directions writes `orderNullsLast` (`module/src/db/order-nulls-last.ts`): a NOT NULL column then
  keeps the default nulls order, which one `NULLS FIRST` index serves both ways.
- **`onDelete` behaviour depends on the relationship type** — three cases:

  1. **Junction tables** (composite PK, two FK columns): **always** use `onDelete: 'cascade'` on **both** FK references. Deleting either parent must clean up the row. Pattern: `groupUsers`, `groupRoles`, `roleCapabilities`, `attackOutcomeMitreTechniques`.

  2. **Owned/child entities** — entities that have no meaning without their parent (e.g. settings tables whose PK *is* the parent FK, audit events, computed runs, hierarchical children): use `onDelete: 'cascade'` on the FK to the owning parent. This is a deliberate choice; add a short comment if the cascade is non-obvious. Self-referential hierarchies (`parentRequirementId → frameworkRequirements.id`) also fall here.

  3. **Loose entity-to-entity associations** — one entity *references* another but is not owned by it (e.g. a control referencing the user who evaluated it, an assessment referencing a framework): **do not cascade**. If the FK column is nullable, prefer `onDelete: 'set null'` so the referencing row survives the deletion of the referenced entity.

  When in doubt: ask "does this row lose all meaning if the referenced row disappears?" — yes → cascade; no → no cascade (or `set null`).

  A **one-to-one property table** (e.g. `supporting_asset_machine_properties` / `supporting_asset_ai_target_properties`, one row per `supporting_asset_sources` row) is a variant of case 2 worth calling out: reuse the parent row's own id as the child's `id` — `unique()` on the FK column plus an explicit, short `foreignKey({ name: ..., columns: ..., foreignColumns: ... })` rather than a same-named `.primaryKey().references(...)` on the FK itself. Name the constraint explicitly when the table and column names are long: Postgres truncates a generated constraint name to 63 characters, and two constraints on tables named this closely can collide on that truncated prefix.
- **A foreign key between two tables that each carry a `tenant_id` names the tenant on both sides**: `(column, tenant_id)` against a `UNIQUE (id, tenant_id)` on the referenced table, as `organizations.country_id` does. A key on the id alone only proves the row exists, so the database stores a row of one tenant naming another tenant's row. A new table carries its own `tenant_id` rather than reaching its tenant through a parent, and every table has a security policy unless it holds no tenant's rows. `module/src/security/tenancy-conventions.test.ts` fails on any of the three, and its lists of exceptions only shrink: an entry needs the reason no write can carry another tenant's id.
- **Never call `uuidv7()` (or any other function) inside a migration's SQL.** Migrations run in whatever PostgreSQL version is deployed, which need not be the 17 that the XTM bundle, `infra/local/compose.yml` and CI all run (`pgvector/pgvector`) — `uuidv7()` is a PostgreSQL 18 built-in, so a migration that calls it applies on a newer server and fails on every older one. When a migration needs to backfill or relocate rows into a new one-to-one table, reuse the parent row's own id (`SELECT "id", "id", ... FROM parent`) instead of generating one — there is no case in this codebase where a relocated one-to-one row needs a fresh id. `gen_random_uuid()` (a real Postgres built-in, not `uuidv7()`) is the fallback only where there is no parent row's id to reuse. The `uuidv7` npm package stays the convention everywhere else — this rule is about SQL inside a migration file only.
- **Always run migrations** after any schema change: `cd module && yarn db:generate`. CI checks that migrations are in sync with the schema and will fail on uncommitted migration files.
- **Autovacuum analyzes every table without waiting for 50 writes.** `runMigration` sets `autovacuum_analyze_threshold = 0` on every table of `public` it owns that sets no threshold of its own, once the migrations are applied, a table a new migration creates included, so a migration never sets it. A table another session holds locked is left to the next boot. Without it a small parent table, written fewer than 50 times, never gets statistics, and a tenant check going through it can hash a child's whole history. `integration-tests/src/tests/service/db-schema.test.ts` fails on a table without it.
- **A table the syncs rewrite keeps room on its pages for an update in place.** An update is HOT, written on its own page with no new index entry, only when the page has room and no indexed column moves; otherwise it adds an entry to every index of the table, which is what kept the indexes of the sync tables at twice their size. `runMigration` sets `fillfactor = 70` on the tables of `IN_PLACE_UPDATE_TABLES` (`module/src/db/run-migrations.ts`), not a migration, since the squash rebuilds the schema from `drizzle-kit`, which does not model a storage parameter. A table whose rows a sync or a recompute rewrites far more often than it inserts goes in that list, and `integration-tests/src/tests/service/db-schema.test.ts` fails on a listed table without it. An index on a column those writes move (`updated_at`, an EPSS figure, a sync date) makes every one of them non-HOT whatever the room: add one only for a read that needs it.
- **A table rename renames its primary key in the same migration.** `db:generate` emits `ALTER TABLE ... RENAME TO`, which leaves an inline primary key and its index under the old table's name, and Drizzle tracks no name for that key, so nothing else notices. Append `ALTER TABLE "<new>" RENAME CONSTRAINT "<old>_pkey" TO "<new>_pkey";` to the generated migration, or a database built from the schema alone names the key differently from one built from the migrations. `integration-tests/src/tests/service/db-schema.test.ts` fails on a primary key not named as the schema names it.
- **A foreign key has an index serving its lookup.** Postgres looks the referencing rows up once per deleted parent row, and a risk scenario's runs, a supporting asset's findings or a purge's jobs go by the thousands: a key no index serves scans its table on each one. The index leads with the key's column, or with `tenant_id` then that column when the key holds both, and may be partial on that column `IS NOT NULL`, which the lookup implies; the development database runs Postgres 17, which has no skip scan, so an index led by a column the key leaves out does not serve it. A child of `crq_indicator_runs` needs it twice over, since every reader of a run's rows filters on the run as well. `integration-tests/src/tests/service/db-schema.test.ts` fails on an unserved key, except to a parent only ever deleted a row at a time, which its exception list names with the reason.
- **Single migration per PR (strict)**:
  - MUST keep **at most one** new migration file in the branch compared to `origin/main`.
  - IF more than one new migration is detected versus `origin/main`, the agent MUST resolve it autonomously:
    - remove the corresponding extra entries in `module/src/db/migrations/meta/_journal.json`,
    - run `cd module && yarn db:generate` and accept Drizzle prompts to regenerate from the current schema,
    - compare the newly generated SQL migration with previously generated SQL files and manually reconcile the new SQL file if required,
    - delete superseded old migration SQL files so only one new migration file remains in the branch.
  - Before finishing, verify migration count versus `origin/main`.

## Squashing the migrations

`cd module && yarn db:squash`, with this worktree's stack up, folds every migration of `origin/main` (`--ref` names another history) into one `0000_baseline`: the statements `drizzle-kit generate` writes for the schema, preceded by the extensions and the functions those statements call, and followed by every other function and trigger, all read from a database built from the history. The baseline takes the `when` of the last migration it folds, because Drizzle v0 runs a migration only when it is newer than the last one a database recorded:

- a database at that migration skips the baseline, and `runMigration` then deletes the ledger rows of the folded migrations, which Drizzle v1 would refuse to start on;
- a database behind it fails on the first `CREATE TABLE`, and the rolled-back transaction leaves it as it was.

The script refuses to start while `src/db/migrations` holds uncommitted changes, since it deletes that folder. It fails when a database built from the baseline has another catalog than one built from the history (column order aside), when a database at the ref does not adopt the baseline unchanged, and when one behind it is not refused on an object that already exists. `--drizzle-v1 <version>` also runs that release's `drizzle-kit up` and `migrate()` on the adopted database, and checks that the release refuses a database whose folded rows were never cleaned up because they match no migration.

Before a squash merges, every database meant to survive it, deployed instances and kept snapshots alike, has booted the last migration it folds: it cannot boot the squash otherwise. A migration that lands on `main` first means running the script again on top of it. A branch carrying a migration regenerates it after the squash rather than renumbering it: its `when` predates the baseline's, so Drizzle would skip it on every database at `main`.

## Two Drizzle behaviours that fail silently

**A left-joined nested selection is nulled from its first column alone.** When a `select()` nests a
group of columns from a left-joined table, Drizzle decides the group is "no matching row" by looking
at that group's **first** column only: if it comes back null, the whole nested object becomes `null`.
Lead the group with a column that is never null on a real row — the tenant id, or the row's own id.
Leading with a nullable column (a hostname, say) makes a genuine row lose its entire block on read,
with no error anywhere.

**`RETURNING` after a conflict gives you the existing row, not the one you built.** An
`insert(...).onConflictDoUpdate(...).returning()` returns the row that is now in the table, whose id
is the one it already had — not the id the insert payload carried. Anything keyed on that id, such
as a one-to-one property row written straight after its parent, must be built from what `returning()`
gave back. Building it from the generated id silently orphans every update after the first insert.
