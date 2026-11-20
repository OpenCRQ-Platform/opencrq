import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import { schema } from '../modules';
import { OVERWRITE_MARKER, StatementRecorder } from './statement-observation';

/** drizzle() only stores the client; a canned query result is enough to execute builders. */
const observedDb = (recorder: StatementRecorder) =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal fake client; drizzle only calls query()
  drizzle({ query: () => Promise.resolve({ rows: [], rowCount: 0 }) } as never, { schema, logger: recorder });

const noExplain = (): Promise<unknown> => Promise.reject(new Error('EXPLAIN not available in this test'));

const plan = (nodes: Array<Record<string, unknown>>) => [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Root', Plans: nodes } }] }];

const scanOf = (relation: string) => Promise.resolve(plan([{ 'Node Type': 'Seq Scan', 'Relation Name': relation }]));

describe('statement observation', () => {
  it('should EXPLAIN every statement with its parameters, transaction control excluded', async () => {
    const explained: Array<{ sqlText: string, params: Array<unknown> }> = [];
    const recorder = new StatementRecorder((sqlText, params) => {
      explained.push({ sqlText, params });
      return scanOf('cve');
    });
    const db = observedDb(recorder);
    await db.select({ id: schema.cve.id }).from(schema.cve).where(eq(schema.cve.tenantId, 't-1'));
    await db.execute(sql`select count(*) from hidden_table where tenant_id = ${'t-1'}`);
    await db.transaction(async (tx) => {
      await tx.select({ id: schema.users.id }).from(schema.users);
    }).catch(() => undefined);
    await recorder.resolve();
    const texts = explained.map((entry) => entry.sqlText);
    expect(texts.every((text) => text.startsWith('EXPLAIN (FORMAT JSON) '))).toBe(true);
    expect(texts.some((text) => text.includes('begin'))).toBe(false);
    expect(texts.some((text) => text.includes('"cve"'))).toBe(true);
    expect(texts.some((text) => text.includes('hidden_table'))).toBe(true);
    expect(texts.some((text) => text.includes('"users"'))).toBe(true);
    expect(explained.find((entry) => entry.sqlText.includes('hidden_table'))?.params).toEqual(['t-1']);
  });

  it('should keep the same text with other parameters as a distinct statement', async () => {
    const explained: Array<string> = [];
    const recorder = new StatementRecorder((sqlText) => {
      explained.push(sqlText);
      return scanOf('a_table');
    });
    const db = observedDb(recorder);
    await db.execute(sql`select 1 from a_table where flag = ${'x'}`);
    await db.execute(sql`select 1 from a_table where flag = ${'y'}`);
    await recorder.resolve();
    expect(explained).toHaveLength(2);
  });

  it('should run EXPLAINs one at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const recorder = new StatementRecorder(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((done) => setTimeout(done, 5));
      inFlight -= 1;
      return plan([{ 'Node Type': 'Seq Scan', 'Relation Name': 'serialised_probe' }]);
    });
    for (let i = 0; i < 5; i += 1) {
      recorder.logQuery(`select ${i} from serialised_probe`, []);
    }
    const { reads } = await recorder.resolve();
    expect(peak).toBe(1);
    expect(reads).toEqual(['serialised_probe']);
  });

  it('should not build a key for a statement with more than 100 parameters and still attribute it', async () => {
    const params = Array.from({ length: 101 }, (_unused, index) => index);
    const explained: Array<Array<unknown>> = [];
    const recorder = new StatementRecorder((_sqlText, received) => {
      explained.push(received);
      return Promise.resolve(plan([{
        'Node Type': 'ModifyTable',
        Operation: 'Insert',
        'Relation Name': 'finding_scores',
        'Conflict Resolution': 'UPDATE',
        Plans: [{ 'Node Type': 'Values Scan' }],
      }]));
    });
    recorder.logQuery('insert into finding_scores values (...) on conflict do update', params);
    recorder.logQuery('insert into finding_scores values (...) on conflict do update', params);
    const { reads, writes, unattributed } = await recorder.resolve();
    // Two EXPLAINs for one repeated statement: an unkeyed statement is neither deduplicated nor cached.
    expect(explained).toHaveLength(2);
    expect(unattributed).toEqual([]);
    expect(reads).toEqual(['finding_scores']);
    expect(writes).toEqual(['finding_scores']);
  });

  it('should not keep the key of a statement whose one parameter is a large payload', async () => {
    const payload = JSON.stringify(Array.from({ length: 1_000 }, (_unused, index) => ({ id: index, score: index / 10 })));
    const explained: Array<string> = [];
    const recorder = new StatementRecorder((sqlText) => {
      explained.push(sqlText);
      return scanOf('finding_scores');
    });
    const statement = 'insert into finding_scores select * from jsonb_to_recordset($1::jsonb)';
    recorder.logQuery(statement, [payload]);
    recorder.logQuery(statement, [payload]);
    const { reads } = await recorder.resolve();
    expect(explained).toHaveLength(2);
    expect(reads).toEqual(['finding_scores']);
  });

  it('should split plan relations into reads and writes, a conflict update reading its target', async () => {
    const recorder = new StatementRecorder((sqlText) => {
      if (sqlText.includes('insert')) {
        return Promise.resolve(plan([
          { 'Node Type': 'ModifyTable', Operation: 'Insert', 'Relation Name': 'finding_scores', 'Conflict Resolution': 'UPDATE', Plans: [{ 'Node Type': 'Values Scan' }] },
        ]));
      }
      return scanOf('asset_evidence');
    });
    recorder.logQuery('insert into finding_scores ... on conflict do update', []);
    recorder.logQuery('select 1 from asset_evidence', []);
    const { reads, writes, unattributed } = await recorder.resolve();
    expect(unattributed).toEqual([]);
    expect(reads).toEqual(['asset_evidence', 'finding_scores']);
    expect(writes).toEqual(['finding_scores']);
  });

  it('should count the target of an update as a read through its child scan', async () => {
    const recorder = new StatementRecorder(() => Promise.resolve(plan([
      {
        'Node Type': 'ModifyTable',
        Operation: 'Update',
        'Relation Name': 'finding_scores',
        Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'finding_scores' }],
      },
    ])));
    recorder.logQuery('update finding_scores set score = 1 where tenant_id = $1', ['t-1']);
    const { reads, writes } = await recorder.resolve();
    expect(reads).toEqual(['finding_scores']);
    expect(writes).toEqual(['finding_scores']);
  });

  it('should not count a plain insert target as a read', async () => {
    const recorder = new StatementRecorder((sqlText) => Promise.resolve(
      sqlText.includes('insert')
        ? plan([{ 'Node Type': 'ModifyTable', Operation: 'Insert', 'Relation Name': 'job_dependencies', Plans: [{ 'Node Type': 'Values Scan' }] }])
        : plan([{ 'Node Type': 'Seq Scan', 'Relation Name': 'cve' }]),
    ));
    recorder.logQuery('insert into job_dependencies ...', []);
    recorder.logQuery('select 1 from cve', []);
    const { reads, writes } = await recorder.resolve();
    expect(reads).toEqual(['cve']);
    expect(writes).toEqual(['job_dependencies']);
  });

  it('should widen to subscribe-all when a statement defeats EXPLAIN', async () => {
    const recorder = new StatementRecorder((sqlText) => (
      sqlText.includes('do $$')
        ? Promise.reject(new Error('syntax error'))
        : scanOf('cve')
    ));
    recorder.logQuery('select 1 from cve', []);
    recorder.logQuery('do $$ begin end $$', []);
    const { reads, unattributed } = await recorder.resolve();
    expect(reads).toBeNull();
    expect(unattributed).toEqual(['do $$ begin end $$']);
  });

  it('should widen instead of throwing when a parameter cannot be serialised', async () => {
    const recorder = new StatementRecorder(noExplain);
    expect(() => recorder.logQuery('select 1 from cve where n = $1', [10n])).not.toThrow();
    const { reads, unattributed } = await recorder.resolve();
    expect(reads).toBeNull();
    expect(unattributed).toEqual(['select 1 from cve where n = $1']);
  });

  it('should retry an EXPLAIN that failed on a previous run instead of caching the failure', async () => {
    const statement = 'select 1 from flaky_table';
    const first = new StatementRecorder(() => Promise.reject(new Error('connection reset')));
    first.logQuery(statement, []);
    const failed = await first.resolve();
    expect(failed.reads).toBeNull();

    const second = new StatementRecorder(() => scanOf('flaky_table'));
    second.logQuery(statement, []);
    const retried = await second.resolve();
    expect(retried.unattributed).toEqual([]);
    expect(retried.reads).toEqual(['flaky_table']);
  });

  it('should widen when the run read nothing at all', async () => {
    const recorder = new StatementRecorder(noExplain);
    const { reads, unattributed } = await recorder.resolve();
    expect(reads).toBeNull();
    expect(unattributed).toEqual(['empty observation']);
  });

  it('should widen when the run read a table that rings no doorbell', async () => {
    const recorder = new StatementRecorder(() => scanOf('sessions'));
    recorder.logQuery('select 1 from sessions', []);
    const { reads, unattributed } = await recorder.resolve();
    expect(reads).toBeNull();
    expect(unattributed).toEqual(['read of silent table sessions']);
  });

  it('should count the target of an insert ... on conflict do nothing as a read', async () => {
    const recorder = new StatementRecorder(() => Promise.resolve(plan([
      { 'Node Type': 'ModifyTable', Operation: 'Insert', 'Relation Name': 'metric_daily', 'Conflict Resolution': 'NOTHING', Plans: [{ 'Node Type': 'Result' }] },
    ])));
    recorder.logQuery('insert into metric_daily ... on conflict do nothing', []);
    const { reads, writes } = await recorder.resolve();
    // The outcome keeps the stored value, so the stored row is an input.
    expect(reads).toEqual(['metric_daily']);
    expect(writes).toEqual(['metric_daily']);
  });

  it('should not count the target of a certified overwrite as a read, on the same plan an update reads', async () => {
    const upsertPlan = (sqlText: string) => (sqlText.includes('insert')
      ? Promise.resolve(plan([
        { 'Node Type': 'ModifyTable', Operation: 'Insert', 'Relation Name': 'metric_daily', 'Conflict Resolution': 'UPDATE', Plans: [{ 'Node Type': 'Function Scan', 'Function Name': 'jsonb_to_recordset' }] },
      ]))
      : scanOf('finding_scores'));
    const certified = new StatementRecorder(upsertPlan);
    certified.logQuery(`${OVERWRITE_MARKER} insert into metric_daily ... on conflict do update set value = excluded.value`, []);
    certified.logQuery('select 1 from finding_scores', []);
    const marked = await certified.resolve();
    expect(marked.reads).toEqual(['finding_scores']);
    expect(marked.writes).toEqual(['metric_daily']);

    const plain = new StatementRecorder(upsertPlan);
    plain.logQuery('insert into metric_daily ... on conflict do update set value = metric_daily.value + excluded.value', []);
    const unmarked = await plain.resolve();
    expect(unmarked.reads).toEqual(['metric_daily']);
  });

  it('should keep a scan of the overwritten table as a read even under the marker', async () => {
    const recorder = new StatementRecorder(() => Promise.resolve(plan([
      {
        'Node Type': 'ModifyTable',
        Operation: 'Insert',
        'Relation Name': 'metric_daily',
        'Conflict Resolution': 'UPDATE',
        Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'metric_daily' }],
      },
    ])));
    recorder.logQuery(`${OVERWRITE_MARKER} insert into metric_daily select ... from metric_daily on conflict do update`, []);
    const { reads } = await recorder.resolve();
    expect(reads).toEqual(['metric_daily']);
  });
});
