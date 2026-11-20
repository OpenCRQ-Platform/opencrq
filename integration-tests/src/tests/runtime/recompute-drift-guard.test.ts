import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventOrigin, JobHandler, StatementTables } from '@app/module';
import { collectPlanTables, isOverwriteStatement, NON_PLANNABLE, SCORE_HISTORY_RETENTION_DAYS, SUBSCRIBE_ALL_SENTINEL } from '@app/module';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { OBSERVED_JOB_FIXTURES } from '../../helpers/observed-job-fixtures';
import { db, pool } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The worker's features build their database engine from the backend config at import time, and
// the shared setup stubs that config out.
vi.mock('../../../../back/src/config', () => ({
  config: () => ({
    postgres: { ...pgConfig, database: getWorkerDbName() },
    recompute: { score_history_retention_days: SCORE_HISTORY_RETENTION_DAYS },
    // Every tenant has deployment credentials, or a job gated on them only shows its early exit.
    connectors: { openaev: new Proxy({}, { get: () => ({ url: 'https://openaev.example' }) }) },
  }),
  pmConfig: {},
  getProcessName: () => 'test',
}));

const HARNESS_TAG = '/* drift-guard */';
const TRANSACTION_CONTROL = /^\s*(begin|commit|rollback|savepoint|release)\b/i;

interface CapturedStatement {
  text: string,
  params: Array<unknown>,
}

const captured: Array<CapturedStatement> = [];
let capturing = false;

/**
 * Every statement of the process reaches `pg.Client.prototype.query`, whichever Drizzle instance
 * or bare pool emitted it, so a statement the run's logger never saw still shows up here.
 */
const installDriverCapture = (): (() => void) => {
  const original = pg.Client.prototype.query;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- wraps the overloaded method with a pass-through of the same overloads
  pg.Client.prototype.query = function capture(this: pg.Client, ...args: Array<unknown>) {
    if (capturing) {
      const [first, second] = args;
      const text = typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string' ? first.text : null;
      const params = Array.isArray(second)
        ? second
        : typeof first === 'object' && first !== null && 'values' in first && Array.isArray(first.values) ? first.values : [];
      if (text !== null) {
        captured.push({ text, params });
      }
    }
     
    return (original as (...a: Array<unknown>) => unknown).apply(this, args);
  } as typeof original;
  return () => {
    pg.Client.prototype.query = original;
  };
};

const workerFeatureNames = (): Array<string> => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../../../../back/src/index-worker.ts'), 'utf8');
  return [...source.matchAll(/^import '\.\/features\/([\w-]+)';/gm)].map((match) => match[1]);
};

/** The planner folds bound values into the plan, so two executions of one text are the same plan
 * only for the same parameters. A long parameter list is never collapsed at all. */
const executionKey = (text: string, params: Array<unknown>, index: number): string => (
  params.length > 100 ? `#${index}` : `${text}\u0000${JSON.stringify(params)}`
);

const groundTruth = async (statements: Array<CapturedStatement>): Promise<Array<{ text: string, tables: StatementTables }>> => {
  const seen = new Set<string>();
  const planned: Array<{ text: string, tables: StatementTables }> = [];
  for (const [index, { text, params }] of statements.entries()) {
    if (text.startsWith('EXPLAIN') || text.startsWith(HARNESS_TAG) || TRANSACTION_CONTROL.test(text)) {
      continue;
    }
    const key = executionKey(text, params, index);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const tables: StatementTables = { reads: new Set(), writes: new Set() };
    try {
      const result = await pool.query(`${HARNESS_TAG} EXPLAIN (FORMAT JSON) ${text}`, params);
      collectPlanTables(result.rows, tables, { overwrite: isOverwriteStatement(text) });
    } catch (error) {
      if (NON_PLANNABLE.test(text)) {
        continue;
      }
      throw new Error(`drift guard cannot EXPLAIN a statement the run emitted: ${text}`, { cause: error });
    }
    planned.push({ text, tables });
  }
  return planned;
};

/**
 * A BEFORE row trigger or an INSTEAD OF trigger can rewrite the row from what the table holds,
 * which no plan shows. `tgtype` bit 0 is ROW, bit 1 BEFORE and bit 6 INSTEAD OF; a statement-level
 * BEFORE trigger has no row to rewrite.
 */
const beforeTriggersOn = async (tables: Array<string>): Promise<Array<string>> => {
  if (tables.length === 0) {
    return [];
  }
  const result = await pool.query<{ table: string, trigger: string }>(
    `${HARNESS_TAG} select c.relname as "table", t.tgname as trigger
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and ((t.tgtype & 3) = 3 or (t.tgtype & 64) <> 0)
        and c.relnamespace = 'public'::regnamespace and c.relname = any($1)
      order by 1, 2`,
    [tables],
  );
  return result.rows.map((row) => `${row.table}.${row.trigger}`);
};

describe('recompute drift guard', () => {
  const services = createTestServices(db);
  let restoreDriver: () => void;
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeAll(async () => {
    for (const name of workerFeatureNames()) {
      await import(`../../../../back/src/features/${name}/index.ts`);
    }
    const { listFeatures } = await import('../../../../back/src/features/features-manager');
    const signal = new AbortController().signal;
    listFeatures().forEach((feature) => feature.activate(signal));
    restoreDriver = installDriverCapture();
  });

  afterAll(() => {
    restoreDriver();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const audit = async (kind: string, handler: JobHandler) => {
    const { createRunObservation, finalizeRunObservation } = await import('../../../../back/src/engines/job-runtime/run-observation');
    const { createJobContext } = await import('../../../../back/src/engines/job-runtime/job-context-factory');
    const observation = createRunObservation(pool);
    const ctx = createJobContext({
      jobId: uuidv7(),
      tenantId,
      kind,
      interactive: false,
      payload: {},
      attempt: 1,
      state: null,
      signal: new AbortController().signal,
      deps: { updateProgress: () => Promise.resolve(), saveStateSnapshot: () => Promise.resolve() },
      runDb: observation.db,
      observation: observation.recorder,
    });
    captured.length = 0;
    capturing = true;
    try {
      await handler(ctx);
    } finally {
      capturing = false;
    }
    const statements = [...captured];

    const unattributed: Array<string> = [];
    const persisted = await finalizeRunObservation(pool, observation, kind, tenantId, false, (context: string) => unattributed.push(context));
    const reads = new Set(persisted.reads);
    const writes = new Set(persisted.writes);
    const { RUNTIME_TABLES } = await import('../../../../back/src/features/recompute-dispatcher/dispatcher-core');
    // What makes the exemption below safe: the dispatcher filters runtime tables out of the
    // subscribe-all state only, so one reaching an explicitly observed set would have every lease
    // renewal ask this kind for itself again.
    const runtimeSubscriptions = [...persisted.reads, ...persisted.writes].filter((table) => RUNTIME_TABLES.has(table));
    const missing: Array<string> = [];
    for (const { text, tables } of await groundTruth(statements)) {
      // Queue bookkeeping is deliberately off the observation: the dispatcher does not filter an
      // explicitly observed set, so a handler that booked a follow-up on `runDb` would subscribe
      // its kind to `jobs` and be asked again at lease cadence. A statement mixing a runtime table
      // with a domain one is still held to the rule.
      const runtimeOnly = [...tables.reads, ...tables.writes].every((table) => RUNTIME_TABLES.has(table));
      if (runtimeOnly) {
        continue;
      }
      for (const table of tables.reads) {
        if (!reads.has(table)) {
          missing.push(`${kind} reads ${table} without subscribing to it, in: ${text}`);
        }
      }
      for (const table of tables.writes) {
        if (!writes.has(table)) {
          missing.push(`${kind} writes ${table} without observing it, in: ${text}`);
        }
      }
    }
    const beforeTriggers = await beforeTriggersOn(persisted.writes);
    return { statements, unattributed, persisted, missing, beforeTriggers, runtimeSubscriptions };
  };

  it('should cover every table of every statement each observed job emits with its persisted observation', async () => {
    const { jobRuntimeEngine } = await import('../../../../back/src/engines/job-runtime');
    const observedKinds = jobRuntimeEngine.listRegisteredJobs()
      .filter((registration) => registration.options.observed)
      .map((registration) => registration.kind);
    expect(observedKinds.length).toBeGreaterThan(0);

    for (const kind of observedKinds) {
      const fixture = OBSERVED_JOB_FIXTURES[kind];
      expect(fixture, `observed job ${kind} has no fixture in observed-job-fixtures.ts`).toBeDefined();
      const handler = jobRuntimeEngine.getHandler(kind);
      expect(handler, `observed job ${kind} has no handler`).toBeDefined();
      await fixture({ services, db, tenantId, adminOrigin });

      const { statements, unattributed, persisted, missing, beforeTriggers, runtimeSubscriptions } = await audit(kind, handler!);
      expect(statements.length).toBeGreaterThan(0);
      expect(unattributed, `${kind} widened its observation`).toEqual([]);
      expect(runtimeSubscriptions, `${kind} subscribed to queue bookkeeping, which every lease renewal would ask it again for`).toEqual([]);
      expect(persisted.reads, `${kind} persisted the subscribe-all sentinel`).not.toContain(SUBSCRIBE_ALL_SENTINEL);
      expect(missing).toEqual([]);
      expect(beforeTriggers, `${kind} writes a table whose BEFORE trigger the observation cannot see`).toEqual([]);
    }
  });

  it('should name a BEFORE trigger on a table an observed job writes', async () => {
    await pool.query(`
      CREATE TABLE _test_before_guard (id UUID PRIMARY KEY, tenant_id UUID NOT NULL, value INTEGER NOT NULL);
      CREATE FUNCTION _test_before_guard_keep() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER _test_before_guard_rewrite BEFORE INSERT OR UPDATE ON _test_before_guard
        FOR EACH ROW EXECUTE FUNCTION _test_before_guard_keep();
    `);
    try {
      const writing: JobHandler = async (ctx) => {
        await ctx.runDb!.execute(sql`select count(*) from tenants`);
        await ctx.runDb!.execute(sql`insert into _test_before_guard (id, tenant_id, value) values (${uuidv7()}, ${tenantId}, 1)`);
      };
      const { beforeTriggers } = await audit('drift-guard-before-trigger', writing);
      expect(beforeTriggers).toEqual(['_test_before_guard._test_before_guard_rewrite']);
    } finally {
      await pool.query('DROP TABLE _test_before_guard; DROP FUNCTION _test_before_guard_keep();');
    }
  });

  it('should name the table and the statement of a read that escapes the run logger', async () => {
    const leaking: JobHandler = async (ctx) => {
      await ctx.runDb!.execute(sql`select count(*) from tenants`);
      // The leak: a read beside the run's logger, which the attribution cannot see.
      await pool.query('select count(*) from users');
    };
    const { missing } = await audit('drift-guard-leak', leaking);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('drift-guard-leak reads users');
    expect(missing[0]).toContain('select count(*) from users');
  });
});
