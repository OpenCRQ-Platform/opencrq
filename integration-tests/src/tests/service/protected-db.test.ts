import type { EventOrigin, InsertPathDecision, SecurityPolicyRule } from '@app/module';
import { createProtectedDB, defineSecurityPolicies } from '@app/module';
import { eq, ne, sql } from 'drizzle-orm';
import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../setup/db';

const testEntities = pgTable('_test_writer_entities', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  value: text('value'),
});

const testUnprotected = pgTable('_test_writer_unprotected', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
});

// A jsonb column is not a type a JSON round trip returns unchanged, so this table pins the fallback.
const testJsonColumn = pgTable('_test_writer_json', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  payload: jsonb('payload'),
});

// Separate Drizzle object pointing to same physical table (used to test sync throw in create policy)
const testEntitiesSyncThrow = pgTable('_test_writer_entities', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  value: text('value'),
});

// Separate Drizzle object, used to test RUD fallback (only has `read`, no `update`/`delete`)
const testEntitiesReadFallback = pgTable('_test_writer_entities', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  value: text('value'),
});

// Separate Drizzle object, used to test policy stacking (two policies on same table)
const testEntitiesMultiPolicy = pgTable('_test_writer_entities', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  value: text('value'),
});

const testTenantPolicy: SecurityPolicyRule<typeof testEntities> = {
  read: (origin, table) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'connector':
      case 'job':
        return eq(table.tenantId, origin.tenantId);
      case 'platform':
        return sql`false`;
      case 'client':
        return eq(table.tenantId, origin.tenantId);
    }
  },
  update: (origin, table) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'connector':
      case 'job':
        return eq(table.tenantId, origin.tenantId);
      case 'platform':
        return sql`false`;
      case 'client':
        return eq(table.tenantId, origin.tenantId);
    }
  },
  delete: (origin, table) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'connector':
      case 'job':
        return eq(table.tenantId, origin.tenantId);
      case 'platform':
        return sql`false`;
      case 'client':
        return eq(table.tenantId, origin.tenantId);
    }
  },
  create: (origin, values) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'connector':
      case 'job':
        // SQL-based condition: the writer evaluates this via `select 1 where ${condition}`
        return sql`${values.tenantId}::text = ${origin.tenantId}::text`;
      case 'platform':
        return sql`false`;
      case 'client':
        // SQL-based condition: the writer evaluates this via `select 1 where ${condition}`
        return sql`${values.tenantId}::text = ${origin.tenantId}::text`;
    }
  },
};

defineSecurityPolicies(testEntities, testTenantPolicy);

defineSecurityPolicies(testJsonColumn, {
  read: (origin, table) => (origin.type === 'client' ? eq(table.tenantId, origin.tenantId) : undefined),
  update: (origin, table) => (origin.type === 'client' ? eq(table.tenantId, origin.tenantId) : undefined),
  create: (origin, values) => (origin.type === 'client'
    ? sql`${values.tenantId}::text = ${origin.tenantId}::text`
    : undefined),
});

// Policy that throws synchronously in create (no SQL evaluation)
defineSecurityPolicies(testEntitiesSyncThrow, {
  create: (_origin, _values) => {
    throw new Error('Sync policy rejection');
  },
});

// Policy with only `read` rule, tests that update/delete fall back to `read`
defineSecurityPolicies(testEntitiesReadFallback, {
  read: (origin, table) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'connector':
      case 'job':
        return eq(table.tenantId, origin.tenantId);
      case 'platform':
        return sql`false`;
      case 'client':
        return eq(table.tenantId, origin.tenantId);
    }
  },
});

// Two policies stacked: tenant isolation + "not locked" restriction
const notLockedPolicy: SecurityPolicyRule<typeof testEntitiesMultiPolicy> = {
  update: (_origin, table) => ne(table.value, 'locked'),
  delete: (_origin, table) => ne(table.value, 'locked'),
};
defineSecurityPolicies(testEntitiesMultiPolicy, testTenantPolicy, notLockedPolicy);

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();
const USER_A = uuidv7();

const originA: EventOrigin = { type: 'client', userId: USER_A, tenantId: TENANT_A };
const authOrigin: EventOrigin = { type: 'auth' };
const systemOrigin: EventOrigin = { type: 'system' };
const platformOrigin: EventOrigin = { type: 'platform', userId: USER_A };

/**
 * Every assertion in this file runs on both insert paths. The arms differ only by the row count
 * above which the writer sends a batch as one jsonb payload, so a test added here is covered on
 * both without its author having to know the paths exist.
 */
const INSERT_PATHS = [
  { name: 'values', jsonPayloadMinRows: Number.MAX_SAFE_INTEGER },
  { name: 'jsonb payload', jsonPayloadMinRows: 1 },
] as const;

let currentMinRows: number = INSERT_PATHS[0].jsonPayloadMinRows;
let decisions: Array<InsertPathDecision> = [];
let allowedFallbacks: Array<string> = [];

/**
 * Declares that the batch this test is about cannot take the payload path, and why. Without it the
 * guard below fails the test: a fallback nobody asked for means the arm silently stopped covering
 * the path it is named after.
 */
const expectInsertFallback = (...reasons: Array<string>) => {
  allowedFallbacks.push(...reasons);
};

const createTestProtectedDB = (origin: EventOrigin) =>
  createProtectedDB(db, (callback) => db.transaction(callback), origin, {
    jsonPayloadMinRows: currentMinRows,
    onInsertPath: (decision) => decisions.push(decision),
  });

const readAll = () => db.select().from(testEntities);

const readUnprotected = () => db.select().from(testUnprotected);

const seedRow = async (tenantId: string, name: string, value?: string) => {
  const id = uuidv7();
  await db.insert(testEntities).values({ id, tenantId, name, value: value ?? null });
  return id;
};

beforeAll(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _test_writer_entities (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      name TEXT NOT NULL,
      value TEXT
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _test_writer_unprotected (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _test_writer_json (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      payload JSONB
    )
  `);
});

afterAll(async () => {
  await db.execute(sql`DROP TABLE IF EXISTS _test_writer_entities`);
  await db.execute(sql`DROP TABLE IF EXISTS _test_writer_unprotected`);
  await db.execute(sql`DROP TABLE IF EXISTS _test_writer_json`);
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE _test_writer_entities`);
  await db.execute(sql`TRUNCATE TABLE _test_writer_unprotected`);
  await db.execute(sql`TRUNCATE TABLE _test_writer_json`);
});

describe.each(INSERT_PATHS)('ProtectedDB [$name path]', ({ name, jsonPayloadMinRows }) => {
  beforeEach(() => {
    currentMinRows = jsonPayloadMinRows;
    decisions = [];
    // The values arm reaches its path by never clearing the threshold, so that reason is its normal.
    allowedFallbacks = jsonPayloadMinRows > 1 ? ['below-threshold'] : [];
  });

  afterEach(() => {
    const unexpected = decisions
      .filter((decision) => decision.path === 'values')
      .map((decision) => decision.reason)
      .filter((reason) => !allowedFallbacks.includes(reason));
    expect(unexpected, `inserts fell back off the ${name} path without the test declaring it`).toEqual([]);
  });

  describe('insert — basic operations', () => {
    it('should insert a single row', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Entity 1' });

      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(id);
      expect(rows[0].name).toBe('Entity 1');
    });

    it('should insert multiple rows', async () => {
      const protectedDb = createTestProtectedDB(originA);

      await protectedDb.insert(testEntities).values([
        { id: uuidv7(), tenantId: TENANT_A, name: 'A' },
        { id: uuidv7(), tenantId: TENANT_A, name: 'B' },
        { id: uuidv7(), tenantId: TENANT_A, name: 'C' },
      ]);

      const rows = await readAll();
      expect(rows).toHaveLength(3);
    });

    it('should return undefined when inserting empty array without returning()', async () => {
      const protectedDb = createTestProtectedDB(originA);

      const result = await protectedDb.insert(testEntities).values([]);

      expect(result).toBeUndefined();
    });

    it('should return empty array when inserting empty array with returning()', async () => {
      const protectedDb = createTestProtectedDB(originA);

      const result = await protectedDb.insert(testEntities).values([]).returning();

      expect(result).toEqual([]);
    });

    it('should return inserted rows with returning()', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      const result = await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Ret' }).returning();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(id);
      expect(result[0].name).toBe('Ret');
      expect(result[0].tenantId).toBe(TENANT_A);
    });
  });

  describe('insert — onConflict', () => {
    it('should skip on conflict with onConflictDoNothing()', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'First' });
      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Second' }).onConflictDoNothing();

      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('First');
    });

    it('should skip on conflict with onConflictDoNothing() and target', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'First' });
      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Second' })
        .onConflictDoNothing({ target: testEntities.id });

      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('First');
    });

    it('should update on conflict with onConflictDoUpdate()', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'First' });
      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Second' })
        .onConflictDoUpdate({
          target: testEntities.id,
          set: { name: 'Updated' },
        });

      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Updated');
    });

    it('should apply update security conditions on onConflictDoUpdate setWhere', async () => {
      // Insert a row in TENANT_B using auth origin (bypasses create policy)
      const authWriter = createTestProtectedDB(authOrigin);
      const id = uuidv7();
      await authWriter.insert(testEntities).values({ id, tenantId: TENANT_B, name: 'TenantB' });

      // Try to upsert from TENANT_A: the update part should be blocked by security
      const protectedDbA = createTestProtectedDB(originA);
      await protectedDbA.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Overwrite' })
        .onConflictDoUpdate({
          target: testEntities.id,
          set: { name: 'Hijacked' },
        });

      // The row should still have TENANT_B's original name because the update security blocked it
      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('TenantB');
    });

    it('should return empty array from onConflictDoNothing with returning() when conflict occurs', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'First' });
      const result = await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Ignored' })
        .onConflictDoNothing()
        .returning();

      expect(result).toHaveLength(0);
      const rows = await readAll();
      expect(rows[0].name).toBe('First');
    });

    it('should return empty array from onConflictDoUpdate with returning() when security blocks the update', async () => {
      const authWriter = createTestProtectedDB(authOrigin);
      const id = uuidv7();
      await authWriter.insert(testEntities).values({ id, tenantId: TENANT_B, name: 'TenantB' });

      const protectedDbA = createTestProtectedDB(originA);
      const result = await protectedDbA.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Overwrite' })
        .onConflictDoUpdate({
          target: testEntities.id,
          set: { name: 'Hijacked' },
        })
        .returning();

      // Security blocks the update part: returning() should reflect unmodified row or empty
      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('TenantB');
      // The row was not updated by writerA, so returning() should not include it
      expect(result).toHaveLength(0);
    });

    it('should return rows from onConflictDoUpdate with returning()', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'First' });
      const result = await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'X' })
        .onConflictDoUpdate({
          target: testEntities.id,
          set: { name: 'Upserted' },
        })
        .returning();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Upserted');
    });

    it('should merge user setWhere with security conditions on onConflictDoUpdate', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      // Insert initial row with value 'forbidden'
      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'First', value: 'forbidden' });

      // Both user setWhere AND security conditions must pass: update should be blocked by user setWhere
      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Second' })
        .onConflictDoUpdate({
          target: testEntities.id,
          set: { name: 'Overwritten' },
          setWhere: eq(testEntities.value, 'allowed'),
        });

      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('First');

      await db.update(testEntities).set({ value: 'allowed' }).where(eq(testEntities.id, id));

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Third' })
        .onConflictDoUpdate({
          target: testEntities.id,
          set: { name: 'Overwritten' },
          setWhere: eq(testEntities.value, 'allowed'),
        });

      const rowsAfter = await readAll();
      expect(rowsAfter).toHaveLength(1);
      expect(rowsAfter[0].name).toBe('Overwritten');
    });
  });

  describe('insert — payload path fallbacks', () => {
    it('should fall back when a column type does not survive a JSON round trip', async () => {
      expectInsertFallback('unsupported-column');
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await protectedDb.insert(testJsonColumn).values({ id, tenantId: TENANT_A, payload: { a: 1 } });

      const rows = await db.select().from(testJsonColumn);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ a: 1 });
    });

    it('should fall back when the rows of a batch do not carry the same keys', async () => {
      expectInsertFallback('mixed-row-shapes');
      const protectedDb = createTestProtectedDB(originA);

      await protectedDb.insert(testEntities).values([
        { id: uuidv7(), tenantId: TENANT_A, name: 'With value', value: 'set' },
        { id: uuidv7(), tenantId: TENANT_A, name: 'Without value' },
      ]);

      const rows = await readAll();
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.name === 'Without value')?.value).toBeNull();
    });
  });

  describe('create policy enforcement', () => {
    it('should allow insert when origin matches tenant', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Allowed' });

      const rows = await readAll();
      expect(rows).toHaveLength(1);
    });

    it('should deny insert when SQL condition evaluates to false (cross-tenant)', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      // originA has tenantId=TENANT_A, but values.tenantId=TENANT_B
      // The SQL condition `values.tenantId = origin.tenantId` evaluates to false, so Access Denied
      await expect(
        protectedDb.insert(testEntities).values({ id, tenantId: TENANT_B, name: 'Denied' }),
      ).rejects.toThrow('Access Denied');

      const rows = await readAll();
      expect(rows).toHaveLength(0);
    });

    it('should propagate synchronous policy errors', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await expect(
        protectedDb.insert(testEntitiesSyncThrow).values({ id, tenantId: TENANT_A, name: 'Denied' }),
      ).rejects.toThrow('Sync policy rejection');
    });

    it('should evaluate create policy per-row and rollback on failure', async () => {
      const protectedDb = createTestProtectedDB(originA);

      await expect(
        protectedDb.insert(testEntities).values([
          { id: uuidv7(), tenantId: TENANT_A, name: 'Valid' },
          { id: uuidv7(), tenantId: TENANT_B, name: 'Invalid' },
        ]),
      ).rejects.toThrow('Access Denied');

      const rows = await readAll();
      expect(rows).toHaveLength(0);
    });

    it('should deny single-row insert with returning() when create policy fails', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await expect(
        protectedDb.insert(testEntities).values({ id, tenantId: TENANT_B, name: 'Denied' }).returning(),
      ).rejects.toThrow('Access Denied');

      const rows = await readAll();
      expect(rows).toHaveLength(0);
    });

    it('should skip policy check when origin is not client', async () => {
      const protectedDb = createTestProtectedDB(authOrigin);
      const id = uuidv7();

      // Auth origin: create policy returns undefined, no SQL check
      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Auth Insert' });

      const rows = await readAll();
      expect(rows).toHaveLength(1);
    });
  });

  describe('update operations', () => {
    it('should update rows matching where condition', async () => {
      const id = await seedRow(TENANT_A, 'Original');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.update(testEntities).set({ name: 'Updated' }).where(eq(testEntities.id, id));

      const rows = await readAll();
      expect(rows[0].name).toBe('Updated');
    });

    it('should return updated rows with returning()', async () => {
      const id = await seedRow(TENANT_A, 'Original', 'v1');

      const protectedDb = createTestProtectedDB(originA);
      const result = await protectedDb.update(testEntities)
        .set({ value: 'v2' })
        .where(eq(testEntities.id, id))
        .returning();

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe('v2');
      expect(result[0].name).toBe('Original');
    });

    it('should not update rows in another tenant (security filter)', async () => {
      const id = await seedRow(TENANT_B, 'TenantB Data');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.update(testEntities).set({ name: 'Hijacked' }).where(eq(testEntities.id, id));

      // Row should be unchanged: security filter silently excludes it
      const rows = await readAll();
      expect(rows[0].name).toBe('TenantB Data');
    });

    it('should return empty array when updating cross-tenant with returning()', async () => {
      await seedRow(TENANT_B, 'TenantB Data');

      const protectedDb = createTestProtectedDB(originA);
      const result = await protectedDb.update(testEntities)
        .set({ name: 'Hijacked' })
        .where(eq(testEntities.name, 'TenantB Data'))
        .returning();

      expect(result).toHaveLength(0);
    });

    it('should only update own-tenant rows when multiple tenants exist', async () => {
      const idA = await seedRow(TENANT_A, 'Shared Name');
      await seedRow(TENANT_B, 'Shared Name');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.update(testEntities).set({ name: 'Only A' }).where(eq(testEntities.name, 'Shared Name'));

      const rows = await readAll();
      const rowA = rows.find((r) => r.id === idA);
      const rowB = rows.find((r) => r.id !== idA);
      expect(rowA!.name).toBe('Only A');
      expect(rowB!.name).toBe('Shared Name');
    });
  });

  describe('delete operations', () => {
    it('should delete rows matching where condition', async () => {
      const id = await seedRow(TENANT_A, 'ToDelete');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.delete(testEntities).where(eq(testEntities.id, id));

      const rows = await readAll();
      expect(rows).toHaveLength(0);
    });

    it('should return deleted rows with returning()', async () => {
      const id = await seedRow(TENANT_A, 'ToDelete');

      const protectedDb = createTestProtectedDB(originA);
      const result = await protectedDb.delete(testEntities)
        .where(eq(testEntities.id, id))
        .returning();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(id);
    });

    it('should not delete rows in another tenant (security filter)', async () => {
      await seedRow(TENANT_B, 'TenantB Data');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.delete(testEntities).where(eq(testEntities.name, 'TenantB Data'));

      // Row should still exist
      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('TenantB Data');
    });

    it('should return empty array when deleting cross-tenant with returning()', async () => {
      await seedRow(TENANT_B, 'TenantB Data');

      const protectedDb = createTestProtectedDB(originA);
      const result = await protectedDb.delete(testEntities)
        .where(eq(testEntities.name, 'TenantB Data'))
        .returning();

      expect(result).toHaveLength(0);
    });

    it('should only delete own-tenant rows when multiple tenants exist', async () => {
      await seedRow(TENANT_A, 'Shared');
      await seedRow(TENANT_B, 'Shared');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.delete(testEntities).where(eq(testEntities.name, 'Shared'));

      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBe(TENANT_B);
    });
  });

  describe('origin bypass behavior', () => {
    it('should allow auth origin to insert without policy enforcement', async () => {
      const protectedDb = createTestProtectedDB(authOrigin);
      const id = uuidv7();

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'Auth' });

      const rows = await readAll();
      expect(rows).toHaveLength(1);
    });

    it('should allow auth origin to insert into any tenant (create policy bypassed)', async () => {
      const protectedDb = createTestProtectedDB(authOrigin);

      await protectedDb.insert(testEntities).values([
        { id: uuidv7(), tenantId: TENANT_A, name: 'Auth A' },
        { id: uuidv7(), tenantId: TENANT_B, name: 'Auth B' },
      ]);

      const rows = await readAll();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.tenantId).sort()).toEqual([TENANT_A, TENANT_B].sort());
    });

    it('should allow system origin to insert into any tenant (create policy bypassed)', async () => {
      const protectedDb = createTestProtectedDB(systemOrigin);

      await protectedDb.insert(testEntities).values([
        { id: uuidv7(), tenantId: TENANT_A, name: 'System A' },
        { id: uuidv7(), tenantId: TENANT_B, name: 'System B' },
      ]);

      const rows = await readAll();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.tenantId).sort()).toEqual([TENANT_A, TENANT_B].sort());
    });

    it('should allow auth origin to update all rows (no tenant filter)', async () => {
      await seedRow(TENANT_A, 'A');
      await seedRow(TENANT_B, 'B');

      const protectedDb = createTestProtectedDB(authOrigin);
      await protectedDb.update(testEntities).set({ value: 'global' }).where(sql`1 = 1`);

      const rows = await readAll();
      expect(rows.every((r) => r.value === 'global')).toBe(true);
    });

    it('should allow auth origin to delete all rows (no tenant filter)', async () => {
      await seedRow(TENANT_A, 'A');
      await seedRow(TENANT_B, 'B');

      const protectedDb = createTestProtectedDB(authOrigin);
      await protectedDb.delete(testEntities).where(sql`1 = 1`);

      const rows = await readAll();
      expect(rows).toHaveLength(0);
    });

    it('should allow system origin to bypass all policies', async () => {
      const protectedDb = createTestProtectedDB(systemOrigin);
      const id = uuidv7();

      await protectedDb.insert(testEntities).values({ id, tenantId: TENANT_A, name: 'System' });
      await protectedDb.update(testEntities).set({ name: 'Updated by system' }).where(eq(testEntities.id, id));

      const rows = await readAll();
      expect(rows[0].name).toBe('Updated by system');

      await protectedDb.delete(testEntities).where(eq(testEntities.id, id));

      const remaining = await readAll();
      expect(remaining).toHaveLength(0);
    });

    it('should reject inserts from a platform origin', async () => {
      const protectedDb = createTestProtectedDB(platformOrigin);

      await expect(
        protectedDb.insert(testEntities).values({ id: uuidv7(), tenantId: TENANT_A, name: 'NoTenant' }),
      ).rejects.toThrow('Access Denied');

      expect(await readAll()).toHaveLength(0);
    });

    it('should update nothing from a platform origin', async () => {
      const id = await seedRow(TENANT_A, 'Original');

      const protectedDb = createTestProtectedDB(platformOrigin);
      await protectedDb.update(testEntities).set({ name: 'Updated' }).where(eq(testEntities.id, id));

      const rows = await readAll();
      expect(rows[0].name).toBe('Original');
    });

    it('should delete nothing from a platform origin', async () => {
      const id = await seedRow(TENANT_A, 'ToDelete');

      const protectedDb = createTestProtectedDB(platformOrigin);
      await protectedDb.delete(testEntities).where(eq(testEntities.id, id));

      expect(await readAll()).toHaveLength(1);
    });
  });

  describe('unprotected table (no policies)', () => {
    it('should insert without restrictions', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      await protectedDb.insert(testUnprotected).values({ id, name: 'Free' });

      const rows = await readUnprotected();
      expect(rows).toHaveLength(1);
    });

    it('should update without restrictions', async () => {
      const id = uuidv7();
      await db.insert(testUnprotected).values({ id, name: 'Original' });

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.update(testUnprotected).set({ name: 'Updated' }).where(eq(testUnprotected.id, id));

      const rows = await readUnprotected();
      expect(rows[0].name).toBe('Updated');
    });

    it('should delete without restrictions', async () => {
      const id = uuidv7();
      await db.insert(testUnprotected).values({ id, name: 'ToDelete' });

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.delete(testUnprotected).where(eq(testUnprotected.id, id));

      const rows = await readUnprotected();
      expect(rows).toHaveLength(0);
    });

    it('should return rows with returning() on insert', async () => {
      const protectedDb = createTestProtectedDB(originA);
      const id = uuidv7();

      const result = await protectedDb.insert(testUnprotected).values({ id, name: 'Ret' }).returning();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(id);
    });

    it('should return rows with returning() on update', async () => {
      const id = uuidv7();
      await db.insert(testUnprotected).values({ id, name: 'Original' });

      const protectedDb = createTestProtectedDB(originA);
      const result = await protectedDb.update(testUnprotected)
        .set({ name: 'Updated' })
        .where(eq(testUnprotected.id, id))
        .returning();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Updated');
    });

    it('should return rows with returning() on delete', async () => {
      const id = uuidv7();
      await db.insert(testUnprotected).values({ id, name: 'ToDelete' });

      const protectedDb = createTestProtectedDB(originA);
      const result = await protectedDb.delete(testUnprotected)
        .where(eq(testUnprotected.id, id))
        .returning();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(id);
      expect(result[0].name).toBe('ToDelete');
    });
  });

  describe('transaction behavior', () => {
    it('should prevent insert when one row fails create policy', async () => {
      const protectedDb = createTestProtectedDB(originA);

      await expect(
        protectedDb.insert(testEntities).values([
          { id: uuidv7(), tenantId: TENANT_A, name: 'Good 1' },
          { id: uuidv7(), tenantId: TENANT_A, name: 'Good 2' },
          { id: uuidv7(), tenantId: TENANT_B, name: 'Bad' },
        ]),
      ).rejects.toThrow('Access Denied');

      // All rows should be rolled back
      const rows = await readAll();
      expect(rows).toHaveLength(0);
    });

    it('should prevent insert on sync policy error', async () => {
      const protectedDb = createTestProtectedDB(originA);

      await expect(
        protectedDb.insert(testEntitiesSyncThrow).values([
          { id: uuidv7(), tenantId: TENANT_A, name: 'A' },
          { id: uuidv7(), tenantId: TENANT_A, name: 'B' },
        ]),
      ).rejects.toThrow('Sync policy rejection');

      // All inserts should be rolled back
      const rows = await readAll();
      expect(rows).toHaveLength(0);
    });

    it('should commit all rows when all create policy checks pass', async () => {
      const protectedDb = createTestProtectedDB(originA);

      await protectedDb.insert(testEntities).values([
        { id: uuidv7(), tenantId: TENANT_A, name: 'A' },
        { id: uuidv7(), tenantId: TENANT_A, name: 'B' },
        { id: uuidv7(), tenantId: TENANT_A, name: 'C' },
      ]);

      const rows = await readAll();
      expect(rows).toHaveLength(3);
    });
  });

  describe('security condition fallback (update/delete → read)', () => {
    it('should fall back to read policy when update policy is absent', async () => {
      const id = await seedRow(TENANT_B, 'ReadFallback');

      const protectedDb = createTestProtectedDB(originA);
      // getWriteSecurityConditions for 'update' falls back to `read` policy:
      // eq(table.tenantId, origin.tenantId), which filters to TENANT_A only
      await protectedDb.update(testEntitiesReadFallback).set({ name: 'Hijacked' }).where(eq(testEntitiesReadFallback.id, id));

      const rows = await readAll();
      expect(rows[0].name).toBe('ReadFallback');
    });

    it('should fall back to read policy when delete policy is absent', async () => {
      await seedRow(TENANT_B, 'ReadFallback');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.delete(testEntitiesReadFallback).where(eq(testEntitiesReadFallback.name, 'ReadFallback'));

      // Row should still exist: read fallback filters by tenant
      const rows = await readAll();
      expect(rows).toHaveLength(1);
    });
  });

  describe('policy stacking (multiple policies)', () => {
    it('should allow update on a non-locked row in own tenant', async () => {
      const id = await seedRow(TENANT_A, 'Editable', 'open');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.update(testEntitiesMultiPolicy).set({ name: 'Changed' }).where(eq(testEntitiesMultiPolicy.id, id));

      const rows = await readAll();
      expect(rows[0].name).toBe('Changed');
    });

    it('should block update on a locked row in own tenant', async () => {
      const id = await seedRow(TENANT_A, 'Locked Row', 'locked');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.update(testEntitiesMultiPolicy).set({ name: 'Hijacked' }).where(eq(testEntitiesMultiPolicy.id, id));

      const rows = await readAll();
      expect(rows[0].name).toBe('Locked Row');
    });

    it('should block delete on a locked row in own tenant', async () => {
      await seedRow(TENANT_A, 'Locked Row', 'locked');

      const protectedDb = createTestProtectedDB(originA);
      await protectedDb.delete(testEntitiesMultiPolicy).where(eq(testEntitiesMultiPolicy.name, 'Locked Row'));

      const rows = await readAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Locked Row');
    });
  });
});
