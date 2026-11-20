---
paths:
  - "integration-tests/**"
---

<!-- Generated from .agents/instructions/writing-integration-tests.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

Writing integration tests: setup, structure, service and HTTP level, tenant isolation. The conventions below apply to the file being read.

# Writing Integration Tests

## Project Setup

| Item | Value |
|---|---|
| Framework | Vitest (`vitest run`) |
| Database | PostgreSQL (local). Connection resolved by `src/setup/pg-config.ts`: `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` first, then `back/config/development.local.json` then `back/config/development.json` (`postgres.*`), then `localhost:5432` `app`/`admin` |
| Test DB | `app_test_template` seeded once by global setup; each Vitest worker gets its own `app_test_w{POOL_ID}` cloned from the template |
| Config | `integration-tests/vitest.config.ts` |
| Run command | `cd integration-tests && yarn test` |
| Run single file | `cd integration-tests && yarn test src/tests/service/<file>.test.ts` |
| Prerequisite | `yarn workspace @app/back build` — only `src/tests/http/metrics-endpoint.test.ts` needs it (it spawns real child processes against `dist/`, the only form a plain `node` can load this workspace in). CI runs it as its own step; without it the suite skips locally and fails under `CI` |
| Run batches in parallel | Do not, run them sequentially in one command. A distinct `PGDATABASE` per run is necessary (global setup drops and rebuilds the template plus the worker DBs, so two runs sharing the default name destroy each other's databases mid-flight) but was measured twice not to be sufficient: concurrent batches with distinct names still died on `57P01`, then deadlocked on `TRUNCATE ... CASCADE`. Reopen this only with a fresh measurement |
| CI sharding | Seven shards balanced by `test-durations.json`, not by file count (`src/setup/shard-sequencer.ts`). A file absent from it weighs the median, which holds for a few new tests but not for dozens: past that one shard hits the 15-minute job timeout while the others pass. Refresh it with `gh run download <a main run> -p 'integration-test-durations-*'`, then `yarn durations:update <dir>`. A shard never runs faster than its slowest single file, so keep each file under about 150 s of CI time, well below the ~340 s each of a shard's four workers carries: past that, split it along its `describe` blocks and share its helpers through `src/helpers/` |

## Directory Structure

```
integration-tests/src/
├── helpers/
│   ├── factories.ts        # createAdminUser, createTenant, createTenantWithAdmin, createTenantUser, createUser
│   └── trpc-client.ts      # createTrpcTestClient (HTTP-level tests)
├── setup/
│   ├── global-setup.ts     # Builds the seeded template DB (migrations + seeds)
│   ├── pg-config.ts        # Connection config + worker DB name (one per Vitest pool ID)
│   ├── db.ts               # Shared Drizzle DB instance
│   ├── test-context.ts     # createTestServices, truncateAllTables
│   ├── test-server.ts      # getTestServer (Fastify instance for HTTP tests)
│   └── teardown.ts         # afterAll: close server & DB pool
└── tests/
    ├── service/             # Service-level tests (call services directly)
    ├── http/                # HTTP-level tests (call tRPC via Fastify inject)
    └── runtime/             # Backend infrastructure against a real database
```

## Writing a Service-Level Test

Place the file in `integration-tests/src/tests/service/<domain>.test.ts`.

Follow this pattern:

```typescript
import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('<Domain> Service', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  describe('CRUD', () => {
    it('should create and retrieve a <entity>', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).<domain>.create<Entity>({ id, name: 'Test' });

      const result = await services.withOrigin(adminOrigin).<domain>.get<Entity>(id);
      expect(result).toBeTruthy();
      expect(result!.name).toBe('Test');
    });
  });

  describe('security policy', () => {
    it('should deny access to users without the required capability', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);
      const items = await services.withOrigin(regularUser.origin).<domain>.get<Entities>();
      expect(items).toHaveLength(0);
    });
  });
});
```

### Key rules

- **Always call `truncateAllTables(db)` in `beforeEach`** to reset state between tests. Narrow exception: when *every* assertion in a file is read-only, do the expensive setup once in `beforeAll` (see `platform-seed.test.ts`, which seeds once instead of 24 times). A file that writes stays on `beforeEach`.
- **Never call the whole seed registry `seed(db)` from a test**: import the specific seeder (e.g. `seedCountries`) instead. A full registry run costs seconds and the CI runner is a 2 vCPU box shared with Postgres, so it eats the 30 s `testTimeout` budget. `reference-seed.test.ts` is the single place that exercises the full re-run.
- **Watch the per-test cost, in CI time**: the budget is `testTimeout: 30_000`, and CI runs 4 Vitest forks on 2 vCPU, where a test runs 4 to 12 times slower than locally. Keep single tests under ~10 s **on CI**: a local timing says little, one test went from 2.6 s locally to 17 s there. CI's per-test times are in the shard logs (`gh run view <run> --log | grep '<test name>'`) and in the `integration-test-durations-*` artifacts of `main` runs. Most of that cost is data volume, see [Data Volume](#data-volume).
- **Use factory helpers** (`createAdminUser`, `createTenantWithAdmin`, `createTenantUser`, `createUser`) instead of inserting data manually.
- **Use `services.withOrigin(origin)`** to scope service calls to a specific user and tenant.
- **Generate IDs with `uuidv7()`** — never hardcode UUIDs.
- **Import from `vitest`** explicitly (`describe`, `it`, `expect`, `beforeEach`) — `globals: false` is set.

## Writing an HTTP-Level Test

Place the file in `integration-tests/src/tests/http/<feature>.test.ts`.

Follow this pattern:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

describe('<Feature> (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
  });

  it('should return expected result', async () => {
    const res = await client.mutation('procedureName', { /* input */ });
    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ /* expected */ });
  });
});
```

### Key rules

- **Use `createTrpcTestClient`** for HTTP tests — it manages cookies automatically.
- **Use `client.query()`** for tRPC queries and **`client.mutation()`** for mutations.
- **Assert on `res.status`** and **`res.json`** (not thrown errors) — the test client returns responses, not exceptions.
- **Pass `{ tenantId }` as third argument** to `client.query()` / `client.mutation()` when the request requires tenant context.

## Writing Tenant Isolation Tests

When a change affects data scoping, add isolation tests in `integration-tests/src/tests/service/tenant-isolation.test.ts` (or a new describe block in the domain's test file).

Test these scenarios:
1. **User A cannot list entities from Tenant B** — create data in both tenants, verify each user only sees their own.
2. **User A cannot get an entity from Tenant B by ID** — expect `undefined` or empty result.
3. **User A cannot update/delete an entity in Tenant B** — the operation should be a no-op (ProtectedDB filters via WHERE).
4. **Cross-tenant FK references are rejected** — e.g., linking a Tenant B resource to a Tenant A entity should throw `'Access Denied'`.

## Data Volume

An integration test proves a behaviour, not a scale. Seed the fewest rows that exercise the
behaviour: a handful by default. Seed a few thousand only to cross a size of our own code. Never seed
an estate.

- **A limit of our own code** (a page, chunk or batch size): seed just past it, or pass the code a
  smaller size when it takes one.
- **A limit outside our code** (the 65,535 parameters a Postgres statement binds, Drizzle's
  `RangeError` past about 120,000 ids): never build it. Call each repository method the fix changed
  through `repositoryContextOf`, with one real id repeated past the limit, and assert that the seeded
  row comes back. Write one test per method, so that reverting a method fails its own test. The real
  id keeps the assertion meaningful: ids that match nothing would only prove that Postgres accepted
  the statement.

  ```typescript
  // `organizationId` is created in `beforeEach`; `assetDependenciesRepository` comes from `@app/module`.
  it('should read the supporting assets of more primary assets than a statement binds', async () => {
    const scoped = services.withOrigin(adminOrigin);
    const primaryAssetId = uuidv7();
    const supportingAssetId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Primary', description: null, ownerId: null, businessValueCategoryIds: [],
    });
    await scoped.supportingAssets.createSupportingAsset({
      id: supportingAssetId, name: 'Direct', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
    });
    await scoped.assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId, primaryAssetId }]);

    const primaryAssetIds = Array.from({ length: 65_536 }, () => primaryAssetId);
    const rows = await assetDependenciesRepository.findSupportToPrimaryLinksForGraph(repositoryContextOf(db, adminOrigin), primaryAssetIds);
    expect(rows.map((row) => row.id)).toEqual([supportingAssetId]);
  });
  ```

- **A scale** (tens of thousands of rows, a response time, a query plan at size) is a load test.
  Run it on demand, never in CI. The estate surfaces have `yarn perf:estate` on the `large_estate`
  profile ([The large estate](docs/development/development.md#the-large-estate)), and
  `platform-seed-large-estate.test.ts` shows the split: 400 assets in the test, the real sizes in
  the bench.
- **A bulk insert that stays anyway** runs `ANALYZE` on the tables it filled. CI reuses worker
  databases across files, so an earlier file can leave statistics that read a table as empty, and the
  planner then nested-loops the bulk rows for minutes. Locally the tables were never analysed, which
  is why the same test passes there in seconds.

## Test Naming & Organization

- Use `describe` blocks to group by feature area: `'CRUD'`, `'security policy'`, `'user management'`, `'role management'`.
- Use clear `it` descriptions starting with `'should'`: `'should create a group'`, `'should deny access without MANAGE_SECURITY'`.
- One assertion concern per `it` block — avoid testing multiple unrelated behaviors in a single test.

## What NOT to Do

- Do not mock the database — tests run against real PostgreSQL.
- Do not share mutable state between `it` blocks: rely on `beforeEach` for isolation. Sharing a
  `beforeAll` fixture is only acceptable when no test in the file writes to the database.
- Do not skip `truncateAllTables` — tests will interfere with each other.
- Do not import from `@app/back` internals in service-level tests — use `@app/module` services directly. A test whose subject *is* backend infrastructure (a listener loop, an engine, feature activation) belongs in `tests/runtime/`.
- Do not add new setup infrastructure without discussing it first.
