import type { EventOrigin } from '@app/module';
import {
  createProtectedDB, defineSecurityPolicies, OVERWRITE_MARKER, schema, StatementRecorder, tenantIsolationPolicy,
} from '@app/module';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { date, integer, numeric, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db, pool } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const metricDaily = pgTable('_test_metric_daily', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day', { mode: 'string' }).notNull(),
  metric: text('metric').notNull(),
  value: integer('value').notNull(),
  note: text('note'),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.day, table.metric] }),
]);

defineSecurityPolicies(metricDaily, tenantIsolationPolicy);

/** `numeric` is outside the payload path's types, so a certified overwrite of it cannot be rendered. */
const metricNumeric = pgTable('_test_metric_numeric', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day', { mode: 'string' }).notNull(),
  metric: text('metric').notNull(),
  amount: numeric('amount').notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.day, table.metric] }),
]);

defineSecurityPolicies(metricNumeric, tenantIsolationPolicy);

/** A second policy whose update rule reads a stored column beside the tenant isolation. */
const metricGuarded = pgTable('_test_metric_guarded', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day', { mode: 'string' }).notNull(),
  metric: text('metric').notNull(),
  value: integer('value').notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.day, table.metric] }),
]);

defineSecurityPolicies(metricGuarded, tenantIsolationPolicy, {
  update: (_origin, table) => sql`${table.value} >= 0`,
});

/** No policy at all: nothing pins the incoming row to the job's tenant. */
const metricFree = pgTable('_test_metric_free', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day', { mode: 'string' }).notNull(),
  metric: text('metric').notNull(),
  value: integer('value').notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.day, table.metric] }),
]);

const CONFLICT_TARGET = [metricDaily.tenantId, metricDaily.day, metricDaily.metric];
const DAY = '2026-09-06';

const services = createTestServices(db);

const observedWriter = (origin: EventOrigin) => {
  const statements: Array<string> = [];
  const recorder = new StatementRecorder(async (sqlText, params) => (await pool.query(sqlText, params)).rows);
  const runDb = drizzle(pool, {
    schema,
    logger: {
      logQuery: (query: string, params: Array<unknown>) => {
        statements.push(query);
        recorder.logQuery(query, params);
      },
    },
  });
  const writer = createProtectedDB(runDb, (callback) => runDb.transaction(callback), origin);
  // A run that read nothing widens to subscribe-all, hiding the assertion.
  const anchorRead = () => runDb.execute(sql`select 1 from tenants`);
  return { writer, recorder, statements, anchorRead };
};

const storedValue = async (tenantId: string, metric: string): Promise<number | undefined> => {
  const rows = await db.select({ value: metricDaily.value }).from(metricDaily)
    .where(sql`${metricDaily.tenantId} = ${tenantId} and ${metricDaily.day} = ${DAY} and ${metricDaily.metric} = ${metric}`);
  return rows[0]?.value;
};

describe('protected db overwrite certification', () => {
  let tenantId: string;
  let clientOrigin: EventOrigin;
  let jobOrigin: EventOrigin;

  beforeAll(async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _test_metric_daily (
        tenant_id UUID NOT NULL,
        day DATE NOT NULL,
        metric TEXT NOT NULL,
        value INTEGER NOT NULL,
        note TEXT,
        PRIMARY KEY (tenant_id, day, metric)
      );
      CREATE TABLE IF NOT EXISTS _test_metric_numeric (
        tenant_id UUID NOT NULL,
        day DATE NOT NULL,
        metric TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        PRIMARY KEY (tenant_id, day, metric)
      );
      CREATE TABLE IF NOT EXISTS _test_metric_guarded (
        tenant_id UUID NOT NULL,
        day DATE NOT NULL,
        metric TEXT NOT NULL,
        value INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, day, metric)
      );
      CREATE TABLE IF NOT EXISTS _test_metric_free (
        tenant_id UUID NOT NULL,
        day DATE NOT NULL,
        metric TEXT NOT NULL,
        value INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, day, metric)
      )
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DROP TABLE IF EXISTS _test_metric_daily, _test_metric_numeric, _test_metric_guarded, _test_metric_free`);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    await db.execute(sql`TRUNCATE TABLE _test_metric_daily, _test_metric_numeric, _test_metric_guarded, _test_metric_free`);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    clientOrigin = setup.origin;
    jobOrigin = { type: 'job', tenantId, jobKind: 'overwrite-probe', interactive: false };
    await db.insert(metricDaily).values({ tenantId, day: DAY, metric: 'band_high', value: 1 });
  });

  it('should overwrite the stored row and leave the target out of the read set for a job', async () => {
    const run = observedWriter(jobOrigin);
    await run.anchorRead();
    await run.writer.insert(metricDaily)
      .values([{ tenantId, day: DAY, metric: 'band_high', value: 5 }, { tenantId, day: DAY, metric: 'band_low', value: 2 }])
      .onConflictDoOverwrite({ target: CONFLICT_TARGET, columns: ['value'] });

    expect(await storedValue(tenantId, 'band_high')).toBe(5);
    expect(await storedValue(tenantId, 'band_low')).toBe(2);
    const marked = run.statements.filter((statement) => statement.startsWith(OVERWRITE_MARKER));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('on conflict ("tenant_id", "day", "metric") do update set "value" = excluded."value"');

    const { reads, writes, unattributed } = await run.recorder.resolve();
    expect(unattributed).toEqual([]);
    expect(writes).toEqual(['_test_metric_daily']);
    expect(reads).toEqual(['tenants']);
  });

  it('should keep the target in the read set when the same upsert is spelled as a do update', async () => {
    const run = observedWriter(jobOrigin);
    await run.anchorRead();
    await run.writer.insert(metricDaily)
      .values({ tenantId, day: DAY, metric: 'band_high', value: 5 })
      .onConflictDoUpdate({ target: CONFLICT_TARGET, set: { value: sql`excluded.value` } });

    expect(await storedValue(tenantId, 'band_high')).toBe(5);
    expect(run.statements.some((statement) => statement.startsWith(OVERWRITE_MARKER))).toBe(false);
    const { reads } = await run.recorder.resolve();
    // The plan of this statement is the one of a read-modify-write: nothing can tell them apart.
    expect(reads).toContain('_test_metric_daily');
  });

  it('should not certify an overwrite that returns rows', async () => {
    const run = observedWriter(jobOrigin);
    await run.anchorRead();
    const returned = await run.writer.insert(metricDaily)
      .values({ tenantId, day: DAY, metric: 'band_high', value: 7 })
      .onConflictDoOverwrite({ target: CONFLICT_TARGET, columns: ['value'] })
      .returning();

    expect(returned.map((row) => row.value)).toEqual([7]);
    expect(run.statements.some((statement) => statement.startsWith(OVERWRITE_MARKER))).toBe(false);
    const { reads } = await run.recorder.resolve();
    expect(reads).toContain('_test_metric_daily');
  });

  it('should not certify an overwrite made by a client, whose update rule reads beyond the key', async () => {
    const run = observedWriter(clientOrigin);
    await run.anchorRead();
    await run.writer.insert(metricDaily)
      .values({ tenantId, day: DAY, metric: 'band_high', value: 9 })
      .onConflictDoOverwrite({ target: CONFLICT_TARGET, columns: ['value'] });

    expect(await storedValue(tenantId, 'band_high')).toBe(9);
    expect(run.statements.some((statement) => statement.startsWith(OVERWRITE_MARKER))).toBe(false);
    const { reads } = await run.recorder.resolve();
    expect(reads).toContain('_test_metric_daily');
  });

  it('should not certify an overwrite whose conflict target leaves the tenant out', async () => {
    await db.execute(sql`CREATE UNIQUE INDEX _test_metric_daily_day_metric ON _test_metric_daily (day, metric)`);
    try {
      const run = observedWriter(jobOrigin);
      await run.anchorRead();
      await run.writer.insert(metricDaily)
        .values({ tenantId, day: DAY, metric: 'band_high', value: 3 })
        .onConflictDoOverwrite({ target: [metricDaily.day, metricDaily.metric], columns: ['tenantId', 'value'] });

      expect(await storedValue(tenantId, 'band_high')).toBe(3);
      expect(run.statements.some((statement) => statement.startsWith(OVERWRITE_MARKER))).toBe(false);
      const { reads } = await run.recorder.resolve();
      // The tenant predicate now decides whether the stored row is rewritten: a genuine read.
      expect(reads).toContain('_test_metric_daily');
    } finally {
      await db.execute(sql`DROP INDEX _test_metric_daily_day_metric`);
    }
  });

  it('should refuse a job overwriting another tenant\'s row without touching it', async () => {
    const other: EventOrigin = { type: 'job', tenantId: uuidv7(), jobKind: 'overwrite-probe', interactive: false };
    const run = observedWriter(other);
    await expect(
      run.writer.insert(metricDaily)
        .values({ tenantId, day: DAY, metric: 'band_high', value: 42 })
        .onConflictDoOverwrite({ target: CONFLICT_TARGET, columns: ['value'] }),
    ).rejects.toThrow('Cannot create for another tenant');
    expect(await storedValue(tenantId, 'band_high')).toBe(1);
  });

  it('should not certify when a second policy reads a stored column in its update rule', async () => {
    await db.insert(metricGuarded).values({ tenantId, day: DAY, metric: 'band_high', value: 1 });
    const run = observedWriter(jobOrigin);
    await run.anchorRead();
    await run.writer.insert(metricGuarded)
      .values({ tenantId, day: DAY, metric: 'band_high', value: 4 })
      .onConflictDoOverwrite({ target: [metricGuarded.tenantId, metricGuarded.day, metricGuarded.metric], columns: ['value'] });

    expect(run.statements.some((statement) => statement.startsWith(OVERWRITE_MARKER))).toBe(false);
    const { reads } = await run.recorder.resolve();
    expect(reads).toContain('_test_metric_guarded');
  });

  it('should not certify on a table that carries no policy', async () => {
    const run = observedWriter(jobOrigin);
    await run.anchorRead();
    await run.writer.insert(metricFree)
      .values({ tenantId, day: DAY, metric: 'band_high', value: 4 })
      .onConflictDoOverwrite({ target: [metricFree.tenantId, metricFree.day, metricFree.metric], columns: ['value'] });

    expect(run.statements.some((statement) => statement.startsWith(OVERWRITE_MARKER))).toBe(false);
  });

  it('should fail a certified overwrite the payload path cannot render rather than fall back', async () => {
    await db.insert(metricNumeric).values({ tenantId, day: DAY, metric: 'ale', amount: '1' });
    const run = observedWriter(jobOrigin);
    await expect(
      run.writer.insert(metricNumeric)
        .values({ tenantId, day: DAY, metric: 'ale', amount: '2.5' })
        .onConflictDoOverwrite({ target: [metricNumeric.tenantId, metricNumeric.day, metricNumeric.metric], columns: ['amount'] }),
    ).rejects.toThrow('could not be rendered on the payload path');
    const rows = await db.select({ amount: metricNumeric.amount }).from(metricNumeric);
    expect(rows.map((row) => row.amount)).toEqual(['1']);
  });

  it('should refuse a row carrying a column that is neither in the conflict target nor overwritten', async () => {
    const run = observedWriter(jobOrigin);
    await expect(
      run.writer.insert(metricDaily)
        .values({ tenantId, day: DAY, metric: 'band_high', value: 5, note: 'kept from the stored row otherwise' })
        .onConflictDoOverwrite({ target: CONFLICT_TARGET, columns: ['value'] }),
    ).rejects.toThrow('neither in the conflict target nor overwritten');
    expect(await storedValue(tenantId, 'band_high')).toBe(1);
  });

  it('should refuse an overwrite naming no column or a column a row does not carry', async () => {
    const run = observedWriter(jobOrigin);
    await expect(
      run.writer.insert(metricDaily)
        .values({ tenantId, day: DAY, metric: 'band_high', value: 5 })
        .onConflictDoOverwrite({ target: CONFLICT_TARGET, columns: [] }),
    ).rejects.toThrow('names at least one column');
    await expect(
      run.writer.insert(metricDaily)
        .values({ tenantId, day: DAY, metric: 'band_high', value: 5 })
        .onConflictDoOverwrite({ target: CONFLICT_TARGET, columns: ['value', 'note'] }),
    ).rejects.toThrow('missing from a row');
    expect(await storedValue(tenantId, 'band_high')).toBe(1);
  });

  it('should count the target of an insert ... on conflict do nothing as a read, on a real plan', async () => {
    const run = observedWriter(jobOrigin);
    await run.anchorRead();
    await run.writer.insert(metricDaily)
      .values({ tenantId, day: DAY, metric: 'band_high', value: 9 })
      .onConflictDoNothing({ target: CONFLICT_TARGET });

    // The stored value won: it is what the outcome holds.
    expect(await storedValue(tenantId, 'band_high')).toBe(1);
    const { reads, writes } = await run.recorder.resolve();
    expect(reads).toContain('_test_metric_daily');
    expect(writes).toContain('_test_metric_daily');
  });
});
