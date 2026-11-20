---
name: add-integration-test
description: >-
  Creates integration tests for domain modules against a real PostgreSQL
  database. Covers CRUD, security policies, tenant isolation, and cascade
  deletes. Use when asked to write or add integration tests.
---

# Add Integration Test

## Prerequisites

Identify:
- **Domain/service** being tested
- **Test type**: service-level (direct service calls) or HTTP-level (tRPC via Fastify inject)
- **Test scenarios**: CRUD, security policy, tenant isolation, cascade delete
- **Data volume**: the fewest rows each scenario needs, as *Data Volume* in the
  writing-integration-tests deep-dive sets out. Open an existing
  `integration-tests/src/tests/service/*.test.ts` with `Read` first, which is what loads it.

## Procedure

### Step 1 — Create the test file

Place in `integration-tests/src/tests/service/<domain>.test.ts` (or `tests/http/<feature>.test.ts` for HTTP tests).

### Step 2 — Write the service-level test

```ts
import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
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
    it('should create and retrieve an entity', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).myEntities.createMyEntity({
        id,
        name: 'Test Entity',
      });

      const result = await services.withOrigin(adminOrigin).myEntities.getMyEntity(id);
      expect(result).toBeTruthy();
      expect(result!.name).toBe('Test Entity');
    });

    it('should list all entities', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).myEntities.createMyEntity({ id, name: 'Test' });

      const items = await services.withOrigin(adminOrigin).myEntities.getMyEntities();
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('should update an entity', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).myEntities.createMyEntity({ id, name: 'Before' });
      await services.withOrigin(adminOrigin).myEntities.updateMyEntity(id, { name: 'After' });

      const result = await services.withOrigin(adminOrigin).myEntities.getMyEntity(id);
      expect(result!.name).toBe('After');
    });

    it('should delete entities', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).myEntities.createMyEntity({ id, name: 'ToDelete' });
      await services.withOrigin(adminOrigin).myEntities.deleteMyEntities([id]);

      const result = await services.withOrigin(adminOrigin).myEntities.getMyEntity(id);
      expect(result).toBeUndefined();
    });
  });

  describe('security policy', () => {
    it('should deny access to users without the required capability', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);
      const items = await services.withOrigin(regularUser.origin).myEntities.getMyEntities();
      expect(items).toHaveLength(0);
    });
  });
});
```

### Step 3 — Add tenant isolation tests (when applicable)

Test these four scenarios:

```ts
describe('tenant isolation', () => {
  let tenantBOrigin: EventOrigin;

  beforeEach(async () => {
    // Create second tenant
    const tenantB = await createTenantWithAdmin(services);
    tenantBOrigin = tenantB.origin;
  });

  it('should not list entities from another tenant', async () => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).myEntities.createMyEntity({ id, name: 'TenantA' });

    const items = await services.withOrigin(tenantBOrigin).myEntities.getMyEntities();
    const found = items.find((i) => i.id === id);
    expect(found).toBeUndefined();
  });

  it('should not get an entity from another tenant by ID', async () => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).myEntities.createMyEntity({ id, name: 'TenantA' });

    const result = await services.withOrigin(tenantBOrigin).myEntities.getMyEntity(id);
    expect(result).toBeUndefined();
  });

  it('should not update an entity in another tenant', async () => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).myEntities.createMyEntity({ id, name: 'Original' });

    await services.withOrigin(tenantBOrigin).myEntities.updateMyEntity(id, { name: 'Hacked' });

    const result = await services.withOrigin(adminOrigin).myEntities.getMyEntity(id);
    expect(result!.name).toBe('Original');
  });

  it('should not delete an entity in another tenant', async () => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).myEntities.createMyEntity({ id, name: 'Safe' });

    await services.withOrigin(tenantBOrigin).myEntities.deleteMyEntities([id]);

    const result = await services.withOrigin(adminOrigin).myEntities.getMyEntity(id);
    expect(result).toBeTruthy();
  });
});
```

### Step 4 — Add cascade delete tests (for junction tables)

```ts
describe('cascade delete', () => {
  it('should cascade delete junction rows when parent is deleted', async () => {
    // Create parent + linked child via junction
    // Delete parent
    // Verify junction rows are gone
  });
});
```

### Step 5 — Run the test

```bash
cd integration-tests && yarn test src/tests/service/<domain>.test.ts
```

## Key Rules

- **Always** `truncateAllTables(db)` in `beforeEach` — never share mutable state
- **Use factory helpers** — `createTenantWithAdmin`, `createTenantUser`, `createUser`
- **Use `services.withOrigin(origin)`** — always scope to a user+tenant
- **Generate IDs with `uuidv7()`** — never hardcode UUIDs
- **Import from `vitest`** explicitly — `globals: false` is set
- **Don't mock the database** — tests run against real PostgreSQL
- **Don't import from `@app/back`** in service-level tests — use `@app/module` services

## Test Naming Conventions

- `describe` blocks: group by feature area (`'CRUD'`, `'security policy'`, `'tenant isolation'`)
- `it` descriptions: start with `'should'` (`'should create and retrieve an entity'`)
- One assertion concern per `it` block
