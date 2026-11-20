import { describe, expect, it, vi } from 'vitest';
import type { Widening } from './query-dependency-index';
import { EVERY_TABLE } from './data-changed-hub';
import { ATTRIBUTION_DEADLINE_MS, installQueryDependencyIndex, observeQueryProcedure, QueryDependencyIndex } from './query-dependency-index';

const scan = (...tables: Array<string>) => [{
  Plan: { 'Node Type': 'Append', Plans: tables.map((table) => ({ 'Node Type': 'Seq Scan', 'Relation Name': table })) },
}];

// One plan per statement text; a text without a plan is a statement Postgres refuses to EXPLAIN.
const explainFrom = (plans: Record<string, Array<string>>) => vi.fn((sqlText: string) => {
  const statement = sqlText.replace('EXPLAIN (GENERIC_PLAN, FORMAT JSON) ', '');
  const tables = plans[statement];
  if (tables === undefined) {
    return Promise.reject(new Error(`could not determine data type of parameter $1 in ${statement}`));
  }
  return Promise.resolve(scan(...tables));
});

const ok = { ok: true } as const;
const failed = { ok: false } as const;

const issuing = (index: QueryDependencyIndex, ...statements: Array<string>) => (): Promise<typeof ok> => {
  statements.forEach((statement) => index.logQuery(statement));
  return Promise.resolve(ok);
};

const tick = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

describe('QueryDependencyIndex', () => {
  it('attributes the statements of two concurrent calls to their own procedure', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select orgs': ['organizations'], 'select notifs': ['notifications', 'users'] }) });

    await Promise.all([
      index.observe('organizations.getOrganizations', async () => {
        await tick();
        index.logQuery('select orgs');
        await tick();
        return ok;
      }),
      index.observe('notifications.getNotifications', async () => {
        index.logQuery('select notifs');
        await tick();
        await tick();
        return ok;
      }),
    ]);

    expect(index.readsOf('organizations.getOrganizations')).toEqual(['organizations']);
    expect(index.readsOf('notifications.getNotifications')).toEqual(['notifications', 'users']);
    expect(index.targetsOf(['organizations'])).toEqual({ procedures: ['organizations.getOrganizations'], all: false });
    expect(index.targetsOf(['users'])).toEqual({ procedures: ['notifications.getNotifications'], all: false });
  });

  it('runs one EXPLAIN per statement text, whatever the procedure or the number of calls', async () => {
    const explain = explainFrom({ 'select orgs': ['organizations'] });
    const index = new QueryDependencyIndex({ explain });

    for (const procedure of ['a.first', 'a.first', 'b.second']) {
      await index.observe(procedure, issuing(index, 'select orgs'));
    }

    expect(explain).toHaveBeenCalledTimes(1);
    expect(index.targetsOf(['organizations']).procedures).toEqual(['a.first', 'b.second']);
    expect(index.snapshot()).toMatchObject({ statements: 3, explainsOk: 1, shapes: 1, observed: 2 });
  });

  it('collapses a bound list into one shape, so a longer list costs no new EXPLAIN', async () => {
    const explain = explainFrom({ 'select assets where id in ($1, $2)': ['supporting_assets'] });
    const index = new QueryDependencyIndex({ explain });

    await index.observe('dashboard.getAssetsOverview', issuing(index, 'select assets where id in ($1, $2)'));
    await index.observe('dashboard.getAssetsOverview', issuing(index, 'select assets where id in ($1, $2, $3, $4)'));

    expect(explain).toHaveBeenCalledTimes(1);
    expect(index.snapshot()).toMatchObject({ shapes: 1, explainsOk: 1 });
    expect(index.readsOf('dashboard.getAssetsOverview')).toEqual(['supporting_assets']);
  });

  it('lets the call return when a plan does not come back in time, and narrows once it lands', async () => {
    vi.useFakeTimers();
    try {
      let landPlan: (() => void) | undefined;
      const widenings: Array<Widening> = [];
      const index = new QueryDependencyIndex({
        explain: () => new Promise((resolve) => {
          landPlan = () => resolve(scan('organizations'));
        }),
        onWidened: (w) => widenings.push(w),
      });

      let returned = false;
      const call = index.observe('organizations.getOrganizations', issuing(index, 'select orgs')).then(() => {
        returned = true;
      });
      await vi.advanceTimersByTimeAsync(249);
      expect(returned).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await call;
      expect(returned).toBe(true);
      // Named on every doorbell while its plan is missing, so nothing it read can go unnoticed.
      expect(index.targetsOf(['unrelated_table']).procedures).toEqual(['organizations.getOrganizations']);
      expect(widenings).toEqual([{ procedure: 'organizations.getOrganizations', reason: 'attribution_deferred', subject: 'select orgs', error: undefined }]);

      landPlan!();
      await vi.advanceTimersByTimeAsync(0);
      expect(index.targetsOf(['unrelated_table']).procedures).toEqual([]);
      expect(index.readsOf('organizations.getOrganizations')).toEqual(['organizations']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('widens at the deadline the options set, instead of the default one', async () => {
    vi.useFakeTimers();
    try {
      const widenings: Array<Widening> = [];
      const index = new QueryDependencyIndex({
        // A plan that never lands.
        explain: () => new Promise<unknown>(() => undefined),
        onWidened: (w) => widenings.push(w),
        attributionDeadlineMs: ATTRIBUTION_DEADLINE_MS * 4,
      });

      let returned = false;
      const call = index.observe('organizations.getOrganizations', issuing(index, 'select orgs')).then(() => {
        returned = true;
      });
      await vi.advanceTimersByTimeAsync(ATTRIBUTION_DEADLINE_MS * 4 - 1);
      expect(returned).toBe(false);
      expect(widenings).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      await call;
      expect(returned).toBe(true);
      expect(widenings.map((w) => w.reason)).toEqual(['attribution_deferred']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the plan without widening when the options set no deadline', async () => {
    vi.useFakeTimers();
    try {
      let landPlan: (() => void) | undefined;
      const widenings: Array<Widening> = [];
      const index = new QueryDependencyIndex({
        explain: () => new Promise((resolve) => {
          landPlan = () => resolve(scan('organizations'));
        }),
        onWidened: (w) => widenings.push(w),
        attributionDeadlineMs: null,
      });

      let returned = false;
      const call = index.observe('organizations.getOrganizations', issuing(index, 'select orgs')).then(() => {
        returned = true;
      });
      await vi.advanceTimersByTimeAsync(ATTRIBUTION_DEADLINE_MS * 100);
      expect(returned).toBe(false);
      expect(widenings).toEqual([]);

      landPlan!();
      await call;
      expect(returned).toBe(true);
      expect(widenings).toEqual([]);
      expect(index.readsOf('organizations.getOrganizations')).toEqual(['organizations']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns from observe only once the attribution is done', async () => {
    let releaseExplain: (() => void) | undefined;
    const index = new QueryDependencyIndex({
      explain: () => new Promise((resolve) => {
        releaseExplain = () => resolve(scan('organizations'));
      }),
    });

    let returned = false;
    const call = index.observe('organizations.getOrganizations', issuing(index, 'select orgs')).then(() => {
      returned = true;
    });
    await tick();
    expect(returned).toBe(false);
    expect(index.readsOf('organizations.getOrganizations')).toEqual([]);

    releaseExplain!();
    await call;
    expect(index.readsOf('organizations.getOrganizations')).toEqual(['organizations']);
  });

  it('propagates a throw from the call and still completes its attributions', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select orgs': ['organizations'] }) });

    await expect(index.observe('organizations.getOrganizations', () => {
      index.logQuery('select orgs');
      return Promise.reject(new Error('resolver blew up'));
    })).rejects.toThrow('resolver blew up');

    expect(index.readsOf('organizations.getOrganizations')).toEqual(['organizations']);
  });

  it('never fails a call because the widening report threw', async () => {
    const index = new QueryDependencyIndex({
      explain: explainFrom({}),
      onWidened: () => {
        throw new Error('logger blew up');
      },
    });

    await expect(index.observe('reports.getReport', issuing(index, 'select $1 as untyped'))).resolves.toEqual(ok);
  });

  it('widens only the procedure whose statement EXPLAIN was refused, and names it on every doorbell', async () => {
    const widenings: Array<Widening> = [];
    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select orgs': ['organizations'] }), onWidened: (w) => widenings.push(w) });

    await index.observe('organizations.getOrganizations', issuing(index, 'select orgs'));
    for (let i = 0; i < 2; i += 1) {
      await index.observe('reports.getReport', issuing(index, 'select orgs', 'select $1 as untyped'));
    }

    expect(index.targetsOf(['organizations']).procedures).toEqual(['organizations.getOrganizations', 'reports.getReport']);
    expect(index.targetsOf(['unrelated_table']).procedures).toEqual(['reports.getReport']);
    expect(widenings).toHaveLength(1);
    expect(widenings[0]).toMatchObject({ procedure: 'reports.getReport', reason: 'explain_refused', subject: 'select $1 as untyped' });
    expect(index.snapshot()).toMatchObject({ explainsRefused: 2, widened: 1 });
  });

  it('retries a refused shape and lifts the widening once it plans', async () => {
    let refuse = true;
    const index = new QueryDependencyIndex({
      explain: () => (refuse ? Promise.reject(new Error('no connection')) : Promise.resolve(scan('organizations'))),
    });

    await index.observe('organizations.getOrganizations', issuing(index, 'select orgs'));
    expect(index.targetsOf(['unrelated_table']).procedures).toEqual(['organizations.getOrganizations']);

    refuse = false;
    await index.observe('organizations.getOrganizations', issuing(index, 'select orgs'));

    expect(index.targetsOf(['unrelated_table']).procedures).toEqual([]);
    expect(index.targetsOf(['organizations']).procedures).toEqual(['organizations.getOrganizations']);
    expect(index.snapshot()).toMatchObject({ widened: 0, observed: 1 });
  });

  it('widens a procedure that reads a table no doorbell rings for', async () => {
    const widenings: Array<Widening> = [];
    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select session': ['sessions', 'users'] }), onWidened: (w) => widenings.push(w) });

    await index.observe('authStatus', issuing(index, 'select session'));

    expect(index.targetsOf(['organizations']).procedures).toEqual(['authStatus']);
    expect(widenings).toEqual([{ procedure: 'authStatus', reason: 'silent_table', subject: 'sessions' }]);
  });

  it('names a served procedure that read nothing, since its result may come from the request context', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select orgs': ['organizations'] }) });

    await index.observe('probe.fromContext', () => Promise.resolve(ok));
    await index.observe('organizations.getOrganizations', issuing(index, 'select orgs'));

    expect(index.targetsOf(['users']).procedures).toEqual(['probe.fromContext']);
    expect(index.targetsOf(['organizations']).procedures).toEqual(['organizations.getOrganizations', 'probe.fromContext']);
    expect(index.snapshot()).toMatchObject({ observed: 1, widened: 0, withoutReads: 1 });
  });

  it('names a served procedure whose statements read no table, since its result may still come from the request context', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select now()': [] }) });

    await index.observe('probe.clockAndContext', issuing(index, 'select now()'));

    expect(index.targetsOf(['users']).procedures).toEqual(['probe.clockAndContext']);
    expect(index.snapshot()).toMatchObject({ statements: 1, observed: 0, withoutReads: 1 });
  });

  it('names a procedure that declares no table on no doorbell', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({}) });

    await index.observe('edition.getStatus', () => Promise.resolve(ok), []);

    expect(index.targetsOf(['jobs']).procedures).toEqual([]);
    expect(index.snapshot()).toMatchObject({ observed: 0, declared: 1, widened: 0, withoutReads: 0 });
  });

  it('names a procedure on a doorbell for a table it declares, and on no other', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({}) });

    await index.observe('isLoggedIn', () => Promise.resolve(ok), ['users']);

    expect(index.targetsOf(['users']).procedures).toEqual(['isLoggedIn']);
    expect(index.targetsOf(['jobs']).procedures).toEqual([]);
    expect(index.readsOf('isLoggedIn')).toEqual(['users']);
  });

  it('still attributes what a declared call issues, so a read added later is not hidden by the declaration', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select orgs': ['organizations'] }) });

    await index.observe('isLoggedIn', issuing(index, 'select orgs'), ['users']);

    expect(index.readsOf('isLoggedIn')).toEqual(['organizations', 'users']);
    expect(index.targetsOf(['organizations']).procedures).toEqual(['isLoggedIn']);
    expect(index.snapshot()).toMatchObject({ statements: 1, declared: 1 });
  });

  it('widens a declared call whose statement EXPLAIN refuses', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({}) });

    await index.observe('edition.getStatus', issuing(index, 'select unplannable'), []);

    expect(index.targetsOf(['jobs']).procedures).toEqual(['edition.getStatus']);
    expect(index.snapshot()).toMatchObject({ declared: 0, widened: 1 });
  });

  it('widens a procedure that declares a table no doorbell rings for', async () => {
    const widenings: Array<Widening> = [];
    const index = new QueryDependencyIndex({ explain: explainFrom({}), onWidened: (w) => widenings.push(w) });

    await index.observe('authStatus', () => Promise.resolve(ok), ['sessions']);
    await index.observe('authStatus', () => Promise.resolve(ok), ['sessions']);

    expect(index.targetsOf(['organizations']).procedures).toEqual(['authStatus']);
    expect(widenings).toEqual([{ procedure: 'authStatus', reason: 'silent_table', subject: 'sessions' }]);
    expect(index.snapshot()).toMatchObject({ declared: 0, widened: 1 });
  });

  it('records no declaration from a call that failed', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({}) });

    await index.observe('edition.getStatus', () => Promise.resolve(failed), []);

    expect(index.snapshot()).toMatchObject({ declared: 0, withoutReads: 0 });
  });

  it('decides nothing from a call that failed', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({}) });

    await index.observe('organizations.getOrganizations', () => Promise.resolve(failed));

    expect(index.targetsOf(['organizations']).procedures).toEqual([]);
    expect(index.snapshot()).toMatchObject({ observed: 0, widened: 0, withoutReads: 0 });
  });

  it('stops naming a procedure once a call of it attributes a read', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select orgs': ['organizations'] }) });

    await index.observe('organizations.getOrganization', () => Promise.resolve(ok));
    await index.observe('organizations.getOrganization', issuing(index, 'select orgs'));

    expect(index.targetsOf(['users']).procedures).toEqual([]);
    expect(index.snapshot()).toMatchObject({ observed: 1, withoutReads: 0 });
  });

  it('ignores statements issued outside an observed call and the non-plannable ones inside', async () => {
    const explain = explainFrom({ 'select orgs': ['organizations'] });
    const index = new QueryDependencyIndex({ explain });

    index.logQuery('select orgs');
    await index.observe('organizations.getOrganizations', issuing(index, 'begin', 'commit'));

    expect(explain).not.toHaveBeenCalled();
    expect(index.snapshot()).toMatchObject({ statements: 0, withoutReads: 1 });
  });

  it('resolves the every-table sentinel to all, whatever else the doorbell carries', async () => {
    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select orgs': ['organizations'] }) });
    await index.observe('organizations.getOrganizations', issuing(index, 'select orgs'));

    expect(index.targetsOf([EVERY_TABLE])).toEqual({ procedures: [], all: true });
    expect(index.targetsOf(['organizations', EVERY_TABLE])).toEqual({ procedures: [], all: true });
  });
});

describe('observeQueryProcedure', () => {
  it('passes the call through when no index is installed, and observes it once one is', async () => {
    installQueryDependencyIndex(null);
    const invoke = vi.fn(() => Promise.resolve(ok));
    await observeQueryProcedure('organizations.getOrganizations', invoke);
    expect(invoke).toHaveBeenCalledTimes(1);

    const index = new QueryDependencyIndex({ explain: explainFrom({ 'select orgs': ['organizations'] }) });
    installQueryDependencyIndex(index);
    try {
      await observeQueryProcedure('organizations.getOrganizations', issuing(index, 'select orgs'));
      expect(index.readsOf('organizations.getOrganizations')).toEqual(['organizations']);
    } finally {
      installQueryDependencyIndex(null);
    }
  });
});
