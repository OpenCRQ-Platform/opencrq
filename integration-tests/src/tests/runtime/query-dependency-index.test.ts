import type { Widening } from '@app/back/src/features/events/query-dependency-index';
import type { EventOrigin, StatementTables } from '@app/module';
import { QueryDependencyIndex } from '@app/back/src/features/events/query-dependency-index';
import { collectPlanTables, schema } from '@app/module';
import { drizzle } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db, pool } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const widenings: Array<Widening> = [];
const index = new QueryDependencyIndex({
  explain: async (sqlText) => (await pool.query(sqlText)).rows,
  onWidened: (widening) => widenings.push(widening),
  // These tests check what the plans attribute, not how fast a loaded runner returns them: the
  // deadline path is covered with fake timers in the unit tests.
  attributionDeadlineMs: null,
});
// The wiring the events feature installs: the index is the logger of the instance the procedures read through.
const services = createTestServices(drizzle(pool, { schema, logger: index }));

const asProcedure = <T>(procedure: string, read: () => Promise<T>) =>
  index.observe(procedure, async () => ({ ok: true, data: await read() }));

const relationsOf = (rows: unknown): Array<string> => {
  const tables: StatementTables = { reads: new Set(), writes: new Set() };
  collectPlanTables(rows, tables);
  return [...tables.reads].sort();
};

describe('query dependency index against the real schema', () => {
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    ({ origin: adminOrigin } = await createTenantWithAdmin(services));
    widenings.length = 0;
  });

  it('should attribute the reads of a procedure through the secured views, with every parameter type inferred', async () => {
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: uuidv7(), name: 'Observed org' }]);

    await asProcedure('organizations.getOrganizations', () => services.withOrigin(adminOrigin).organizations.getOrganizations());
    await asProcedure('notifications.getNotifications', () => services.withOrigin(adminOrigin).notifications.getNotifications());

    expect(index.readsOf('organizations.getOrganizations')).toContain('organizations');
    expect(index.readsOf('notifications.getNotifications')).toContain('notifications');
    expect(widenings).toEqual([]);

    const onOrganizations = index.targetsOf(['organizations']);
    expect(onOrganizations.all).toBe(false);
    expect(onOrganizations.procedures).toContain('organizations.getOrganizations');
    expect(onOrganizations.procedures).not.toContain('notifications.getNotifications');

    const onNotifications = index.targetsOf(['notifications']);
    expect(onNotifications.procedures).toContain('notifications.getNotifications');
    expect(onNotifications.procedures).not.toContain('organizations.getOrganizations');
  });

  it('should run no new EXPLAIN for a second call of the same statement with other inputs', async () => {
    // Both calls carry a non-zero offset: drizzle drops the `offset` clause entirely when it is 0,
    // which is a different statement, not the same one with another value.
    await asProcedure('notifications.getNotifications', () => services.withOrigin(adminOrigin).notifications.getNotifications(10, 20, false));
    const before = index.snapshot();

    await asProcedure('notifications.getNotifications', () => services.withOrigin(adminOrigin).notifications.getNotifications(5, 3, false));

    const after = index.snapshot();
    expect(after.statements).toBeGreaterThan(before.statements);
    expect(after.explainsOk).toBe(before.explainsOk);
    expect(after.shapes).toBe(before.shapes);
  });

  it('should keep a parameter-gated read in the generic plan that the bound plan folds away', async () => {
    // The premise the whole index rests on: one plan per statement text, valid for every input.
    const statement = 'select 1 where $1::boolean and exists (select 1 from organizations)';

    const generic = await pool.query(`EXPLAIN (GENERIC_PLAN, FORMAT JSON) ${statement}`);
    const bound = await pool.query(`EXPLAIN (FORMAT JSON) ${statement}`, [false]);

    expect(relationsOf(generic.rows)).toEqual(['organizations']);
    expect(relationsOf(bound.rows)).toEqual([]);
  });
});
