---
paths:
  - "module/src/modules/**"
  - "module/src/security/**"
  - "module/src/registry.ts"
---

<!-- Generated from .agents/instructions/domain-modules.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

Domain module architecture, security layer patterns, and step-by-step guide for adding new modules. The conventions below apply to the file being read.

# Domain Modules & Security Layer

## Domain Module Pattern (`module/src/modules/<domain>/`)

Each domain entity (tenants, users, groups, roles, organizations, etc.) follows this structure:

- **`schema.ts`** — Drizzle ORM table definitions (`pgTable`). Security policies are attached with `defineSecurityPolicies()`.
- **`repository.ts`** — Data access layer. Two variants:
  - **`defineRepository()`** — The default for all modules. Receives `{ db, views, rawDb }` context. `db` is a **ProtectedDB**: reads via `db.select()` + writes via `db.insert()/update()/delete()` (enforced by security policies). Use `views.*` for security-filtered reads in `from()`/`join()`. Use `rawDb()` only for justified bypasses (junction tables, cross-tenant ops). Tables without `defineSecurityPolicies()` work normally — views return all rows and writes pass through without policy checks.
  - **`defineGlobalRepository()`** — Reserved for auth only (requires raw DB for sessions/transactions). Receives `{ db }` context with full read/write access (no security layer).
- **`service.ts`** — Business logic layer, defined via `defineService()`. Receives `{ repo, deps, eventOrigin, atomic }` context. Declares dependencies on other services with `.dependsOn()`.
- **`index.ts`** — Re-exports schema, repository, and service.
- **`id.ts`** / **`seed.ts`** — (optional) Constant IDs and seed data.

### Adding a new module

1. Create the domain folder under `module/src/modules/<domain>/`.
2. Add `schema.ts`, `repository.ts`, `service.ts`, and `index.ts` following the pattern above.
3. Register the schema in `module/src/modules/schema.ts`.
4. Register the module in `module/src/modules/index.ts`.
5. Run `cd module && yarn db:generate` to create the migration.

> **Tip:** Use the `create-domain-module` skill for a fully guided, step-by-step procedure with code templates.

### Code templates

**schema.ts** (tenant-scoped):
```ts
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies } from '../../security';
import { tenantIsolationPolicy } from '../../security/policies/tenant-policies';
import { tenants } from '../tenants';

export const myEntities = pgTable('my_entities', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  description: text('description'),
});

defineSecurityPolicies(myEntities, tenantIsolationPolicy);
```

**repository.ts** (secured — for entities with `defineSecurityPolicies`):
```ts
import { eq, inArray } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { myEntities } from './schema';

export const myEntitiesRepository = defineRepository({
  // Reads use db + views (security-filtered)
  insertMyEntity: ({ db }, values: typeof myEntities.$inferInsert) =>
    db.insert(myEntities).values([values]),
  findMyEntityById: async ({ db, views }, id: string) =>
    db.select().from(views.myEntities).where(eq(views.myEntities.id, id)).then((r) => r[0]),
  findAllMyEntities: async ({ db, views }) =>
    db.select().from(views.myEntities),
  // Writes use db (policy-enforced via ProtectedDB)
  updateMyEntity: ({ db }, id: string, values: Partial<typeof myEntities.$inferInsert>) =>
    db.update(myEntities).set(values).where(eq(myEntities.id, id)),
  deleteMyEntities: ({ db }, ids: string[]) =>
    db.delete(myEntities).where(inArray(myEntities.id, ids)),
  // rawDb() for justified bypasses only (junction tables, cross-tenant reads)
  // addJunctionRow: ({ rawDb }, entityId: string, otherId: string) =>
  //   rawDb().insert(junctionTable).values({ entityId, otherId }),
});
```

**repository.ts** (global — auth only, requires raw DB for sessions/transactions):
```ts
import { defineGlobalRepository } from '../../registry';

export const authRepository = defineGlobalRepository({
  // Full db access — no ProtectedDB, no views
  findAll: ({ db }) => db.select().from(table),
});
```

**service.ts**:
```ts
import { defineService } from '../../registry';
import { myEntitiesRepository } from './repository';

export const myEntitiesService = defineService('myEntities', myEntitiesRepository)
  .implement({
    createMyEntity: async ({ atomic, eventOrigin }, values) => {
      await atomic(async ({ repo }) => {
        await repo.insertMyEntity({ ...values, tenantId: eventOrigin.tenantId });
      });
    },
    getMyEntity: async ({ repo }, id) => await repo.findMyEntityById(id),
    getMyEntities: async ({ repo }) => await repo.findAllMyEntities(),
    updateMyEntity: async ({ atomic }, id, values) => {
      await atomic(async ({ repo }) => { await repo.updateMyEntity(id, values); });
    },
    deleteMyEntities: async ({ repo }, ids) => await repo.deleteMyEntities(ids),
  });
```

### Searching and sorting on human text

A user-typed search matches with `foldedLike(foldedColumn, search, 'prefix' | 'contains')` and a name sort orders with `...orderByFolded(foldedColumn, column, descending)` (`module/src/db/fold-text.ts`), never `ilike` or a bare `asc(name)`, so `ecole` finds `École` and the variants of a name sort together. The folded column is a stored generated `<column>_folded` holding `fold_text(<column>)` (`lower(unaccent(...))`, defined by a migration), declared in `schema.ts` with `.generatedAlwaysAs(sql\`fold_text(<column>)\`)`; the helpers only accept a column named `*_folded`. Postgres cannot inline `fold_text`, so evaluated at query time it costs a function call per row, several times a plain `ilike`: a new searchable or sortable human-text column gets its own folded column, even on a small table, and an index serving the search or sort is built on that column. A `createSelectSchema` output omits the folded column. Ids and codes keep their plain escaped `ilike`.

### Latest row per key

Read a key's latest row with a per-row lateral, never a `selectDistinctOn(...).as(...)` subquery
joined on the key: Postgres cannot push the join key into the subquery, so it sorts every row the
subquery sees on every call, however few keys the outer query reads. The lateral is a `limit 1`
subquery correlated on the key, joined with `innerJoinLateral` / `leftJoinLateral(..., LATERAL_ON)`
(`LATERAL_ON` is in `module/src/db/lateral.ts`) and served by an index on the key and the column it
orders by, led by the tenant the view filters on; `latestEvidenceState`
(`supporting-assets/latest-evidence-state.ts`) is the example, served by
`asset_evidence_history_tenant_evidence_idx (tenant_id, asset_evidence_id, state_changed_at desc nulls first, id desc nulls first, ...)`.
The index states `NULLS FIRST` because `orderBy(desc(...))` sorts that way: Drizzle's `.desc()`
alone emits `NULLS LAST`, which Postgres cannot walk for it, even on a NOT NULL column, and
`app/no-implicit-index-nulls-order` asks every descending index column to state its order.

The same cost hides in two other shapes: a ranking window (`row_number()`, `rank()`, `dense_rank()`
`over (partition by …)`) in a subquery, which the caller's key cannot narrow either, and a top-level
`selectDistinctOn` over a history table, which sorts the whole history it can see however few keys
the page shows. A `DISTINCT ON` or a window that is restricted to the rows the caller reads, or
whose caller reads every row anyway, can still be the right shape, and declares why with a
`// bounded-by: <what bounds it>` comment directly above the statement that writes it, not in the
doc comment of the method holding it. The `app/no-distinct-on-subquery` rule enforces all three on
the non-test files of `module/src/`; its `historyTables` option in `eslint.config.ts` lists the
history tables.

A key's latest row that a list orders or filters on is stored on the keyed row instead, kept by a trigger on the history table: a lateral per row answers a page, but sorting a widespread flaw's findings by it reads the history of every one. A finding's state and latest test verdict are that case (`asset_evidence.current_state`, `latest_verdict_exposed`, see the backend deep-dive). Index the stored column with the key it is listed under and end the index in `id`, with the tie-break following the sort direction, so a backward scan serves the descending order.

### An id list that grows with the estate

`inArray` binds one parameter per id, and Postgres refuses a statement past 65,535 of them, so a
list read from a walk or a scope (the supporting assets below a primary asset, the findings on
them) filters with `inUuids` / `notInUuids` (`module/src/db/uuid-array.ts`), which bind the whole
list as one `uuid[]`. Past about 120,000 ids `inArray` fails earlier still, in Drizzle itself, with a
`RangeError` while it merges the parameters. A list a caller types or a page holds stays on
`inArray`. Such a fix is tested on the repository method with one real id repeated past the limit,
never with an estate past it: see *Data Volume* in the
[writing-integration-tests](.github/instructions/writing-integration-tests.instructions.md) deep-dive.

## Security Layer (`module/src/security/`)

- **Policies**: Defined per table, control which rows a user can read/write based on `EventOrigin`.
- **SecuredSchema**: Wraps Drizzle tables with automatic row-level filtering via policies.
- **ProtectedDB**: Merges read access (Drizzle `select`) with policy-enforced write access (`insert`/`update`/`delete`). A single `db` object handles both reads and writes.

### `EventOrigin`

Six members: `client` (a user inside a tenant, `tenantId` always present), `platform` (the same user on the tenant-less surface: tenant picker, platform groups/roles/users), `connector`, `job` (a background task, scoped to its tenant, carrying the run's `jobKind` and whether it is `interactive`), `auth`, `system`.

A run does not always own the origin it writes under: a handler needing its caller's authorization — the six connector syncs, `crq-simulation` — keeps a `client` or `connector` origin, which would otherwise leave the run invisible and make its writes read as a user's own edit. Those two members therefore take an optional `job?: JobRunTag` carrying the run's kind and window alongside the authorization, and `originJobTag(origin)` resolves it for either shape. The writer keys the transaction tag on that tag, not on `origin.type`, so an `update` or `delete` made under a borrowed origin still gets the transaction it needs to carry it.

**Two axes, never one.** `jobs.triggered_by` / `triggered_by_id` record *who asked* — read them off the caller with `originTrigger(origin)` at the enqueue site, never spell them out, and never make them say the identity the run will assume rather than the one that asked. `jobs.interactive` records *whether anybody is waiting on the answer*, which is the only question the doorbell window asks; it defaults to `false`, and the enqueue site is the only place that can answer it, since it alone sees both the caller and what the run will do. The two come apart in both directions: a service account asking for one scenario's simulation waits exactly as a person does, and the dispatcher books every routed change as `event` whether a save is watching it or a sweep is feeding it.

A policy rule returning `undefined` adds **no predicate**, so it reads the whole table. Return it only for an origin that may legitimately see everything (`auth`, `system`); return `sql\`false\`` to deny. `client` and `platform` are separate members precisely so a missing tenant cannot fall through to `undefined`, and `@typescript-eslint/switch-exhaustiveness-check` (on `module/src/security/**`) asks about every new origin, which `tsc` cannot do while `GatekeeperResult` includes `undefined`.

Only the `tenants`, `users` and `tenant_users` policies, plus `platformSecurityPolicy` on the five platform group/role tables (`platformGroups`, `platformGroupUsers`, `platformGroupRoles`, `platformRoles`, `platformRoleCapabilities`), grant a `platform` origin anything: the tenants the user belongs to (and their `update`, the rename, when they hold `PlatformCapability_CreateTenants`, through `tenantUpdatePolicy`, which gives a `client` origin the same arm so the `x-tenant-id` header changes nothing), the user's own row (plus every user when they hold `PlatformCapability_ManageUsers`), the `tenant_users` rows of the tenants the user belongs to (plus every row for that same holder), and — for those five tables — `create`/`update`/`delete` to whoever holds that same capability.

The super administrator XTM One designates (`users.is_super_admin`) passes every membership and
capability check without a `tenant_users` row or a group, through the uncorrelated
`userIsSuperAdmin` predicate the policies OR beside each check: see the
[XTM One sign-in](.github/instructions/feature-xtm-one-sign-in.instructions.md) feature doc.

At the HTTP boundary, `tenantScopedProcedure` rejects a tenant-less call with `BAD_REQUEST`. Every API router is built on it except six. `platformGroups`/`platformRoles` take `PlatformSecurityProcedure` (`PlatformProcedure` plus a `PlatformCapability_ManageUsers` check, on a `platform` origin even when the call carries `x-tenant-id`, so a header never narrows `views.users` there), `notifications` takes `PlatformProcedure`, `tenants` takes it too except for `setTenantDefaultLocale`, a write to the tenant on the header that takes the tenant procedure, and `users` and `platformCapabilities` take both: `PlatformSecurityProcedure` for their reads of the platform group/role tables about any user (`listPlatformUsers`, `getUserPlatformEffectivePermissions`), since those tables have no `read` rule, and `PlatformProcedure` for the rest. `groups`, `roles`, `members`, `serviceAccounts`, `crqIndicatorSettings` and `threatRelevanceSettings` take `TenantSecurityProcedure`, the tenant procedure plus a `MANAGE_SECURITY` check, `platformMembers` takes `PlatformSecurityProcedure`, and `cwe` takes both, as `users` and `platformCapabilities` do on the platform side: the tenant procedure for `list` and `get`, `TenantSecurityProcedure` for its four mutations. Read the acting user with `originUserId(origin)`, never `origin.type === 'client'`, which now excludes the platform surface.

Read the tenant the same way, with `originTenantId(origin)` or `requireTenantId(origin)`: a service account's token reaches every tenant router as a `connector` origin, so a `client`-only test answers it with a 500 or with data silently missing its tenant's rows. `requireClientTenantId` is for the writes a connector must never make, and their procedures take the `userSessionOnly` middleware (`back/src/features/app-router/user-session-only.ts`) so the refusal reaches the caller as `FORBIDDEN`.

### Two locks for a table a capability lookup itself reads through

A capability policy that reads through the very tables it guards (`platformCapabilityHeld`, behind `hasPlatformCapability`, reads `platform_group_users` / `platform_group_roles` / `platform_role_capabilities`) cannot carry a `read` rule: filtering those rows would make every caller — including the capability holder — come back uncapable, locking out the surface fresh installs included. Such a policy declares `create` / `update` / `delete` only, and leaves `read` `undefined` (see `platformSecurityPolicy` in `platform-policies.ts`).

That policy is still only the floor, not the whole gate, because the write gate ANDs its condition into the statement's `WHERE`: a refused `update`/`delete` is a silent 0-row no-op, not an error, and a refused `insert` throws a bare `Error` that the tRPC error formatter turns into an opaque `INTERNAL_SERVER_ERROR`. A boundary procedure is what turns an uncapable call into an explicit `FORBIDDEN`, for both a mutation and a read — the policy is the check no future endpoint can forget, and the procedure is what makes the refusal visible. `createPlatformSecurityProcedure` is that procedure for the platform routers, and `createTenantSecurityProcedure` for the tenant routers gated by `manageSecurityPolicy`, whose `read` rule would otherwise answer an uncapable read with an empty result. The tables behind `crqIndicatorSettings` and `threatRelevanceSettings`, and `cweTechniqueOverrides` behind `cwe`, carry `manageSecurityWritePolicy` and not `manageSecurityPolicy`: the engine services read them under the origin of every member, so their `read` stays open. The procedure alone closes the reads of the first two routers, while `cwe` keeps its reads open to every member and puts only its mutations behind it. Both procedures sit on the base procedure, so the refusal comes before any input is validated, and `integration-tests/src/tests/http/tenant-security-routers.test.ts` calls every procedure of the seven tenant routers to keep it so, as `cwe-router.test.ts` does for the four mutations of `cwe`.

The four tenant RBAC link tables (`groupUsers`, `groupRoles`, `roleCapabilities`, `serviceAccountGroups`) follow the same rule for the same reason, since the capability chain reads them: their link policies in `link-policies.ts` declare writes only.

### A third guard: the platform always keeps an administrator

Neither of the two locks above stops a capable caller from removing the *last* holder of a
capability the platform surface is reachable through: the policy and the procedure both ask "is
this caller allowed to make this write", never "does the platform still have an administrator
afterwards". Two capabilities carry that weight — `PlatformCapability_ManageUsers`, which
`createPlatformSecurityProcedure` requires on the platform routers, and
`PlatformCapability_PlatformAccess`, which the frontend platform routes require and send the
caller away without. Emptying either one locks the platform administration surface for every
platform group holder, and only XTM One's super administrator, who holds both without a group,
can give them back. Neither can become a policy predicate: as the previous section
shows, a policy refusal on `update`/`delete` is ANDed into the `WHERE` and resolves as a silent
no-op, which is exactly the failure mode a lockout guard must not have.

The guard is `platformCapabilitiesService.keepingPlatformReachable(write)`
(`platform-capabilities/service.ts`). It takes the transactional advisory lock
`lockPlatformCapabilityHolders()`, asks
`platformCapabilityHasHolder()` for each of the two capabilities, runs the write, then asks again
— reading through `views.*`, unfiltered, since the policy declares no `read`, and counting
group holders only: the super administrator status comes and goes with XTM One's claim — and throws
`LastPlatformAdminError`, rolling the write back, when a capability that had a holder has none
left. A write on a platform where a capability has no group holder already (a fresh install, whose
default groups have no member) goes through, the super administrator remaining the way in. Taking
the lock before the write is what stops two concurrent removals of distinct holders from each seeing
the other's holder and both succeeding.

Every service method that can drop a holder passes its write through the guard, inside an
`atomic()` so the lock is transaction-scoped and the check sees the write before it commits:
`removeCapabilityFromPlatformRole` and `deletePlatformRole` in `platform-roles`,
`removeUserFromPlatformGroup`, `removeRoleFromPlatformGroup` and `deletePlatformGroup` in
`platform-groups`, and `deleteUser` in `users` — whose `platform_group_users` rows go by FK cascade,
so it empties a capability without touching the platform tables at all. A new write that can remove
a holder belongs in the guard too; the invariant is a property of the platform, not of the tRPC
routers.

Unlike the two locks above, this one is not left to prose alone: the six repository methods the
guard wraps are named `guarded*` (`guardedRemovePlatformRoleCapability`, `guardedDeletePlatformRole`,
`guardedRemovePlatformGroupUser`, `guardedRemovePlatformGroupRole`, `guardedDeletePlatformGroup`,
`guardedDeleteUser`), and the `app/no-unguarded-reachability-write` ESLint rule
(`eslint-rules/src/plugins/no-unguarded-reachability-write.ts`, wired on
`module/src/modules/**/service.ts`) flags any `repo.guarded*(...)` call that is not lexically inside
a `keepingPlatformReachable(...)` call. A new guarded write only has to follow the naming
convention to be covered — the rule does not hardcode the six names.

The two platform routers map `LastPlatformAdminError` to a `CONFLICT` through the shared
`withConflictOn(ErrorClass, fn)` helper (`back/src/features/app-router/structured-error-conflict.ts`,
also used for `EvidenceAlreadyExistsError`), distinct from the
`FORBIDDEN` the boundary procedure throws — one says "you lack the capability", the other "the
platform refuses to lose its last administrator".

### Enforcement

Repository security is enforced at **two levels**:

1. **TypeScript (compile-time):** In `defineRepository()`, `db` is typed as `ProtectedDB` — it has `select()` for reads and policy-enforced `insert()`/`update()`/`delete()` for writes. `transaction()`/`execute()` are stripped. Use `rawDb()` for justified bypasses (junction tables without policies, cross-tenant lookups, bootstrapping).

2. **ESLint (CI):** The `no-restricted-syntax` rule flags `db.transaction()`/`db.execute()` and `rawDb()` in secured repository files. Applied to `module/src/modules/**/repository.ts` excluding `auth` (the only `defineGlobalRepository`).

### When to use `rawDb()`

- **Junction tables without security policies** — validate access via `views` first, then `rawDb()` for the junction write. The four RBAC link tables (`groupUsers`, `groupRoles`, `roleCapabilities`, `serviceAccountGroups`) are not among them: each carries `manageSecurityWritePolicy` plus a link policy (`link-policies.ts`) requiring both ends of the link to belong to the caller's tenant, and is written through `db`. Keep the `views.*` pre-check there, so a refused write stays an explicit error rather than a silent no-op. Nor is `tenantUsers`, which carries `tenantUserRowsPolicy` (`tenant-policies.ts`); only `createTenantWithAdmin` bypasses it.
- **Cross-tenant reads** (e.g., finding the account of a person being added, by email or XTM One id, in `members`) — document the bypass reason.
- **Bootstrapping** (e.g., `createTenantWithAdmin`) — bulk insert during tenant creation.

### Exception: the capability chain reads `groups` directly, never through `views.groups`

`hasCapability`/`hasManageSecurity` anchor the group → role → capability chain on
`groups.tenant_id` through the shared `capabilityHeldInTenant`/`groupBelongsToTenant` predicates in
`capability-policies.ts`, called from `capabilities/repository.ts` — the two files must stay in
step. They cannot read through `views.groups` because that view already carries
`manageSecurityPolicy` itself: it would be empty for exactly the caller asking whether they hold the
capability. `groupBelongsToTenant` instead goes through `ownedByTenant`, which aliases the table
symbol it is given (`alias(table, 'tenant_owned_row')`, from `drizzle-orm/pg-core`) inside the
function body rather than at module scope: `groups/schema.ts` imports `manageSecurityPolicy`, so
this module sits on the same `modules` ↔ `security/policies` import cycle, and a module-level
`alias(groups, ...)` can run before `groups/schema.ts` has finished initializing its export —
`alias()` rejects that `undefined` target at runtime. Deferring the call to inside the function, where it only runs once every module
has finished loading, avoids the cycle without falling back to a raw SQL table name.

### When to use `defineGlobalRepository()`

Reserved for `auth` only — it requires raw DB access for `db.transaction()` and `withLock()` which are blocked by ProtectedDB. All other modules (including global reference data like MITRE ATT&CK, tenant-scoped reference data like countries and sectors, and platform-level entities) use `defineRepository()`. Tables without `defineSecurityPolicies()` work transparently — reads via `views.*` return all rows and writes pass through without policy checks. The five platform group/role tables (`platformGroups`, `platformGroupUsers`, `platformGroupRoles`, `platformRoles`, `platformRoleCapabilities`) are no longer among them: every write on them requires `PlatformCapability_ManageUsers`.
