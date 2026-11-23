import type { CompletedRunObservation, DoorbellParent, JobDependencyRow } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchedJob, DispatcherSettings, TableSets } from './dispatcher-core';
import type { LogSinkLine } from '../../utils/logger';
import { createLogger, setLogSink } from '../../utils/logger';
import { recordFeedingCycle } from '../../utils/recompute-metrics';
import { createDispatcher, findFeedingCycle } from './dispatcher-core';
import { createFeedingCycleReport } from './feeding-cycle-report';

// The core reads no configuration; the real logger, imported here to run the reporting wiring for
// real, reads the deployment one at module load.
vi.mock('../../config', () => ({
  pmConfig: { telemetry: undefined },
  getProcessName: vi.fn(() => 'test'),
}));

// Spied, not replaced: the counter still runs, and the report's call to it stays observable.
vi.mock('../../utils/recompute-metrics', { spy: true });

const SETTINGS: DispatcherSettings = { factor: 1, floorMs: 1_000, capMs: 60_000, reconnectMinIntervalMs: 0 };

const reads = (jobKind: string, tenantId: string, ...tables: Array<string>): Array<JobDependencyRow> =>
  tables.map((tableName) => ({ jobKind, tenantId, tableName, access: 'read' }));
const writes = (jobKind: string, tenantId: string, ...tables: Array<string>): Array<JobDependencyRow> =>
  tables.map((tableName) => ({ jobKind, tenantId, tableName, access: 'write' }));

const observed = (
  observation: { reads: Array<string>, writes: Array<string> },
  persisted = true,
): CompletedRunObservation => ({ observation, persisted });

/** Read or write sets holding the same tables for each of the given tenants. */
const setsOf = (byKind: Record<string, Array<string>>, tenantIds: Array<string> = ['tenant-1']): TableSets =>
  new Map(Object.entries(byKind).map(([kind, tables]) => [
    kind,
    new Map(tenantIds.map((tenantId) => [tenantId, new Set(tables)])),
  ]));

/** Deterministic clock + timer wheel so debounce behavior is asserted without real waiting. */
const createHarness = (jobs: Array<DispatchedJob>, overrides?: {
  settings?: Partial<DispatcherSettings>,
  observations?: Array<JobDependencyRow>,
  tenants?: Array<string>,
  /** Decides the outcome of the nth enqueue attempt, counting from 1. */
  enqueue?: (attempt: number) => Promise<void>,
  doorbellParents?: Array<DoorbellParent>,
  onFeedingCycle?: (cycle: Array<string>) => void,
}) => {
  let nowMs = 0;
  const tenants = overrides?.tenants ?? ['tenant-1'];
  const timers = new Map<number, { fn: () => void, atMs: number }>();
  let timerSeq = 0;
  const enqueues: Array<{ kind: string, tenantId: string, reason: string, interactive: boolean }> = [];
  const absorbed: Array<{ kind: string, tenantId: string, reason: string }> = [];
  const errors: Array<string> = [];
  const persisted: Array<{ kind: string, tenantId: string, reads: Array<string>, writes: Array<string> }> = [];
  const cycles: Array<Array<string>> = [];

  const dispatcher = createDispatcher(jobs, {
    enqueue: (kind, tenantId, reason, interactive) => {
      enqueues.push({ kind, tenantId, reason, interactive });
      return overrides?.enqueue?.(enqueues.length) ?? Promise.resolve();
    },
    loadObservations: () => Promise.resolve(overrides?.observations ?? []),
    listTenantIds: () => Promise.resolve([...tenants]),
    persistObservation: (kind, tenantId, observation) => {
      persisted.push({ kind, tenantId, ...observation });
      return Promise.resolve();
    },
    loadDoorbellParents: overrides?.doorbellParents === undefined ? undefined : () => Promise.resolve(overrides.doorbellParents ?? []),
    onAskAbsorbed: (kind, tenantId, reason) => {
      absorbed.push({ kind, tenantId, reason });
    },
    settings: { ...SETTINGS, ...overrides?.settings },
    onError: (_err, context) => {
      errors.push(context);
    },
    onFeedingCycle: (cycle) => {
      cycles.push(cycle);
      overrides?.onFeedingCycle?.(cycle);
    },
    now: () => nowMs,
    setTimer: (fn, ms) => {
      timerSeq += 1;
      timers.set(timerSeq, { fn, atMs: nowMs + ms });
      return timerSeq;
    },
    clearTimer: (handle) => {
      if (typeof handle === 'number') {
        timers.delete(handle);
      }
    },
  });

  // Event handling is serialized on a promise chain, so pending events must settle before the
  // timer wheel is read.
  const flush = async () => {
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
    }
  };

  const advance = async (ms: number) => {
    await flush();
    const target = nowMs + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.atMs <= target)
        .sort(([, a], [, b]) => a.atMs - b.atMs)[0];
      if (!due) {
        break;
      }
      nowMs = due[1].atMs;
      timers.delete(due[0]);
      due[1].fn();
      await flush();
    }
    nowMs = target;
    await flush();
  };

  return { dispatcher, advance, enqueues, absorbed, errors, persisted, cycles, tenants };
};

const FS: DispatchedJob = { kind: 'finding-score-recompute', observed: true };

describe('dispatcher routing', () => {
  it('should enqueue for the affected tenant after the debounce delay', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'asset_evidence') });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    expect(h.enqueues).toHaveLength(0);
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'change', interactive: true }]);
  });

  it('should pass on whether the write it routed was awaited', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'asset_evidence') });
    await h.dispatcher.start();
    // A nightly sweep writing a table another job reads: the run it wakes continues that sweep.
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1', origin: 'nightly-recompute', interactive: false });
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'change', interactive: false }]);
  });

  it('should raise a pending sweep ask to interactive when a save folds into it', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'asset_evidence') });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1', origin: 'nightly-recompute', interactive: false });
    // The burst's deadline stands, but the save must not be served on the sweep's window.
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'change', interactive: true }]);
  });

  it('should not enqueue for a table outside the read set', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'asset_evidence') });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'countries', tenantId: 'tenant-1' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should not route on a table the job only writes', async () => {
    const h = createHarness([FS], {
      observations: [...reads(FS.kind, 'tenant-1', 'asset_evidence'), ...writes(FS.kind, 'tenant-1', 'finding_scores')],
    });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'finding_scores', tenantId: 'tenant-1', origin: 'someone-else' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should treat a never-observed job as subscribed to every table', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'whatever_table', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);
  });

  it('should not route runtime bookkeeping tables through the subscribe-all state', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'jobs', tenantId: 'tenant-1' });
    h.dispatcher.handleEvent({ table: 'job_dependencies', tenantId: 'tenant-1' });
    h.dispatcher.handleEvent({ table: 'job_logs', tenantId: 'tenant-1' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should route a global-table event to a tenant created just before it', async () => {
    const h = createHarness([FS], { tenants: ['tenant-1'] });
    await h.dispatcher.start();
    h.tenants.push('tenant-new');
    h.dispatcher.handleEvent({ table: 'tenants', tenantId: 'tenant-new' });
    h.dispatcher.handleEvent({ table: 'mitre_techniques' });
    await h.advance(1_000);
    expect(h.enqueues.map((entry) => entry.tenantId).sort()).toEqual(['tenant-1', 'tenant-new']);
  });

  it('should mark every subscribed tenant on a global-table event', async () => {
    const h = createHarness([FS], {
      tenants: ['tenant-1', 'tenant-2'],
      observations: [...reads(FS.kind, 'tenant-1', 'mitre_techniques'), ...reads(FS.kind, 'tenant-2', 'asset_evidence')],
    });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'mitre_techniques' });
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'change', interactive: true }]);
  });

  it('should ignore an event carrying a tenant absent from the list', async () => {
    const h = createHarness([FS], { tenants: ['tenant-1'] });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-deleted' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should drop the pending debounce and the state of a tenant a refresh no longer lists', async () => {
    const h = createHarness([FS], { tenants: ['tenant-1', 'tenant-2'] });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-2' });
    h.tenants.splice(h.tenants.indexOf('tenant-2'), 1);
    h.dispatcher.handleEvent({ table: 'tenants', tenantId: 'tenant-2' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);

    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'reconnect', interactive: false }]);
  });
});

describe('dispatcher parent deletion', () => {
  const PARENTS: Array<DoorbellParent> = [
    { child: 'risk_scenarios', parent: 'organizations' },
    { child: 'scenario_loss_estimates', parent: 'risk_scenarios' },
  ];

  it('should enqueue a job subscribed to the child alone when a parent row is deleted', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'scenario_loss_estimates'), doorbellParents: PARENTS });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'risk_scenarios', tenantId: 'tenant-1', op: 'DELETE' });
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'change', interactive: true }]);
  });

  it('should reach the grandchildren, since every level under the deleted row is silent', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'scenario_loss_estimates'), doorbellParents: PARENTS });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'organizations', tenantId: 'tenant-1', op: 'DELETE' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);
  });

  it('should not expand an update or an insert of the parent', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'scenario_loss_estimates'), doorbellParents: PARENTS });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'risk_scenarios', tenantId: 'tenant-1', op: 'UPDATE' });
    h.dispatcher.handleEvent({ table: 'risk_scenarios', tenantId: 'tenant-1', op: 'INSERT' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should still drop the job own echo on the parent', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'scenario_loss_estimates'), doorbellParents: PARENTS });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'risk_scenarios', tenantId: 'tenant-1', op: 'DELETE', origin: FS.kind });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should record the silent children as changed during a run, so the completed observation can judge them', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'asset_evidence'), doorbellParents: PARENTS });
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.handleEvent({ table: 'risk_scenarios', tenantId: 'tenant-1', op: 'DELETE' });
    await h.advance(0);
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 500, observed({ reads: ['asset_evidence', 'scenario_loss_estimates'], writes: [] }));
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'followup', interactive: true }]);
  });

  it('should not route a runtime table reached through the expansion under the subscribe-all state', async () => {
    const h = createHarness([FS], { doorbellParents: [{ child: 'job_errors', parent: 'jobs' }] });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'jobs', tenantId: 'tenant-1', op: 'DELETE' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });
});

describe('dispatcher echo filter', () => {
  it('should drop a change the job itself caused', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'some_table', tenantId: 'tenant-1', origin: FS.kind });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should enqueue when another writer changed a table the job reads and also writes', async () => {
    const h = createHarness([FS], {
      observations: [...reads(FS.kind, 'tenant-1', 'finding_scores'), ...writes(FS.kind, 'tenant-1', 'finding_scores')],
    });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'finding_scores', tenantId: 'tenant-1', origin: 'some-other-job' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);
  });

  it('should drop a change the retention purge caused, on a table the job reads', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'crq_indicator_runs') });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'crq_indicator_runs', tenantId: 'tenant-1', op: 'DELETE', origin: 'jobs-retention', interactive: false });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should drop a global-table echo for every tenant, not only the one that ran', async () => {
    const h = createHarness([FS], { tenants: ['tenant-1', 'tenant-2'] });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'mitre_techniques', origin: FS.kind });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });
});

describe('dispatcher debounce', () => {
  it('should fold a burst of events into a single enqueue', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    for (let i = 0; i < 100; i += 1) {
      h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
      await h.advance(10);
    }
    await h.advance(2_000);
    expect(h.enqueues).toHaveLength(1);
  });

  it('should scale the delay with the measured run duration, clamped to the cap', async () => {
    const h = createHarness([FS], { settings: { factor: 2, floorMs: 1_000, capMs: 5_000 } });
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 2_000, null);
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(3_999);
    expect(h.enqueues).toHaveLength(0);
    await h.advance(1);
    expect(h.enqueues).toHaveLength(1);

    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 60_000, null);
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(5_000);
    expect(h.enqueues).toHaveLength(2);
  });

  it('should not let a later event of the burst postpone the run the first one booked', async () => {
    const h = createHarness([FS], { settings: { floorMs: 1_000 } });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(999);
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    expect(h.enqueues).toHaveLength(0);
    await h.advance(1);
    expect(h.enqueues).toHaveLength(1);
  });

  it('should keep enqueueing at the delay under a table that is never quiet', async () => {
    const h = createHarness([FS], { settings: { floorMs: 1_000 } });
    await h.dispatcher.start();
    for (let i = 0; i < 100; i += 1) {
      h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
      await h.advance(50);
    }
    expect(h.enqueues).toHaveLength(5);
  });

  it('should retry a rejected enqueue once the debounce delay elapses again', async () => {
    const h = createHarness([FS], {
      enqueue: (attempt) => (attempt === 1 ? Promise.reject(new Error('queue unreachable')) : Promise.resolve()),
    });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(2);
    expect(h.errors).toEqual([`enqueue ${FS.kind} for tenant-1`]);
  });

  it('should space the retries of a never-succeeding enqueue up to the cap', async () => {
    const h = createHarness([FS], {
      settings: { floorMs: 5_000, capMs: 300_000 },
      enqueue: () => Promise.reject(new Error('tenant_id violates a foreign key')),
    });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(3_600_000);
    expect(h.enqueues.length).toBeGreaterThan(5);
    expect(h.enqueues.length).toBeLessThan(20);
  });

  it('should reset the retry spacing once an enqueue succeeds', async () => {
    const h = createHarness([FS], {
      enqueue: (attempt) => (attempt <= 2 ? Promise.reject(new Error('queue unreachable')) : Promise.resolve()),
    });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(2);
    await h.advance(1_999);
    expect(h.enqueues).toHaveLength(2);
    await h.advance(1);
    expect(h.enqueues).toHaveLength(3);

    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(4);
  });

  it('should drop a retry whose tenant vanished while the enqueue was in flight', async () => {
    let rejectEnqueue: (err: Error) => void = () => {};
    const h = createHarness([FS], {
      tenants: ['tenant-1'],
      enqueue: () => new Promise<void>((_resolve, reject) => {
        rejectEnqueue = reject;
      }),
    });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);

    h.tenants.length = 0;
    h.dispatcher.markAllDirty();
    await h.advance(0);
    rejectEnqueue(new Error('queue unreachable'));
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(1);
    expect(h.errors).toContain(`enqueue ${FS.kind} for tenant-1`);
  });

  it('should not postpone a pending retry when events keep arriving on a hot table', async () => {
    const h = createHarness([FS], {
      enqueue: (attempt) => (attempt === 1 ? Promise.reject(new Error('queue unreachable')) : Promise.resolve()),
    });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);
    // The retry waits its floor delay; events every 200 ms must not push it back.
    for (let i = 0; i < 4; i += 1) {
      h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
      await h.advance(200);
    }
    await h.advance(200);
    expect(h.enqueues).toHaveLength(2);
  });

  it('should report a pending ask absorbed by the run that front-ran it, with its reason', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'asset_evidence') });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(500);
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
    expect(h.absorbed).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'change' }]);
  });

  it('should drop a pending ask when the run it waited for starts first', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(0);
    // The manual path claims the run before the debounce expires, the shadow-mode routine.
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 500, null);
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should not retry a rejected enqueue after stop', async () => {
    const h = createHarness([FS], { enqueue: () => Promise.reject(new Error('queue unreachable')) });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);
    h.dispatcher.stop();
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(1);
  });
});

describe('dispatcher dirty mark', () => {
  it('should convert a change landing mid-run into exactly one follow-up enqueue', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 1_000, null);
    await h.advance(999);
    expect(h.enqueues).toHaveLength(0);
    await h.advance(1);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'followup', interactive: true }]);
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 1_000, null);
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(1);
  });

  it('should turn a reconnect during a run into the dirty mark', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.markAllDirty();
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 1_000, null);
    await h.advance(999);
    expect(h.enqueues).toHaveLength(0);
    await h.advance(1);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'followup', interactive: false }]);
  });

  it('should follow up on a table the run discovered while that table was changing', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'table_1') });
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    // Not in the persisted set: this very run is the one discovering it.
    h.dispatcher.handleEvent({ table: 'table_2', tenantId: 'tenant-1' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 1_000, observed({ reads: ['table_1', 'table_2'], writes: [] }));
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'followup', interactive: true }]);
  });

  it('should not follow up on a table the completed run turned out not to read', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'table_1') });
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.handleEvent({ table: 'countries', tenantId: 'tenant-1' });
    await h.advance(120_000);
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 1_000, observed({ reads: ['table_1'], writes: [] }));
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should not follow up on the run own writes to a table it also reads', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'finding_scores') });
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.handleEvent({ table: 'finding_scores', tenantId: 'tenant-1', origin: FS.kind });
    await h.advance(120_000);
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 1_000, observed({ reads: ['finding_scores'], writes: ['finding_scores'] }));
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });

  it('should refresh the subscription from the completed run observation', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 500, observed({ reads: ['asset_evidence'], writes: ['finding_scores'] }));
    h.dispatcher.handleEvent({ table: 'countries', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(0);
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);
  });
});

describe('dispatcher declared doors', () => {
  it('should mark every registered job dirty on reconnect', async () => {
    const h = createHarness([FS, { kind: 'other-recompute', observed: true }], { tenants: ['tenant-1', 'tenant-2'] });
    await h.dispatcher.start();
    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(4);
    expect(h.enqueues.every((entry) => entry.reason === 'reconnect')).toBe(true);
  });

  it('should reload the tenant list before marking dirty, since the creation notice may be what was lost', async () => {
    const h = createHarness([FS], { tenants: ['tenant-1'] });
    await h.dispatcher.start();
    h.tenants.push('tenant-created-offline');
    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    expect(h.enqueues.map((entry) => entry.tenantId).sort()).toEqual(['tenant-1', 'tenant-created-offline']);
  });

  it('should recover a notification lost while disconnected through the catch-up, with no sweep', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'asset_evidence') });
    await h.dispatcher.start();
    // The change committed while the listener was down: no event ever reaches the dispatcher.
    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'reconnect', interactive: false }]);
  });

  it('should run the first catch-up without deferral and defer the next one to the end of the interval', async () => {
    const h = createHarness([FS], { settings: { reconnectMinIntervalMs: 10_000 } });
    await h.dispatcher.start();
    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    expect(h.enqueues).toHaveLength(1);

    h.dispatcher.markAllDirty();
    await h.advance(5_000);
    expect(h.enqueues).toHaveLength(1);
    await h.advance(5_000);
    expect(h.enqueues).toHaveLength(2);
    expect(h.enqueues[1]?.reason).toBe('reconnect');
  });

  it('should fold every handshake landing during a deferral into the one deferred catch-up', async () => {
    const h = createHarness([FS], { settings: { reconnectMinIntervalMs: 10_000 } });
    await h.dispatcher.start();
    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    h.dispatcher.markAllDirty();
    await h.advance(60_000);
    expect(h.enqueues).toHaveLength(2);
  });

  it('should reload the tenant list when the deferred catch-up finally runs', async () => {
    const h = createHarness([FS], { settings: { reconnectMinIntervalMs: 10_000 }, tenants: ['tenant-1'] });
    await h.dispatcher.start();
    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    h.dispatcher.markAllDirty();
    h.tenants.push('tenant-created-offline');
    await h.advance(20_000);
    expect(h.enqueues.slice(1).map((entry) => entry.tenantId).sort()).toEqual(['tenant-1', 'tenant-created-offline']);
  });

  it('should drop a deferred catch-up on stop', async () => {
    const h = createHarness([FS], { settings: { reconnectMinIntervalMs: 10_000 } });
    await h.dispatcher.start();
    h.dispatcher.markAllDirty();
    await h.advance(1_000);
    h.dispatcher.markAllDirty();
    h.dispatcher.stop();
    await h.advance(60_000);
    expect(h.enqueues).toHaveLength(1);
  });

  it('should not route changes or reconnects to a job registered for its daily hour alone', async () => {
    const h = createHarness([{ kind: 'clocked-only', observed: false }], { tenants: ['tenant-1'] });
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    h.dispatcher.markAllDirty();
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
    h.dispatcher.stop();
  });

  it('should schedule nothing after stop, even for an event still in flight', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.handleEvent({ table: 'asset_evidence', tenantId: 'tenant-1' });
    h.dispatcher.stop();
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });
});

describe('feeding cycle detection', () => {
  const A: DispatchedJob = { kind: 'job-a', observed: true };
  const B: DispatchedJob = { kind: 'job-b', observed: true };

  it('should name two jobs whose observed reads and writes form a cycle', () => {
    const readSets = setsOf({ 'job-a': ['table_b'], 'job-b': ['table_a'] });
    const writeSets = setsOf({ 'job-a': ['table_a'], 'job-b': ['table_b'] });
    expect(findFeedingCycle([A, B], readSets, writeSets)).toContain('job-a');
  });

  it('should not name a job writing a table it also reads', () => {
    expect(findFeedingCycle([A], setsOf({ 'job-a': ['table_a'] }), setsOf({ 'job-a': ['table_a'] }))).toBeNull();
  });

  it('should name a subscribe-all job feeding a job that feeds it back', () => {
    const readSets = setsOf({ 'job-a': ['*'], 'job-b': ['table_a'] });
    const writeSets = setsOf({ 'job-a': ['table_a'], 'job-b': ['table_b'] });
    expect(findFeedingCycle([A, B], readSets, writeSets)).toContain('job-a');
  });

  it('should not name a subscribe-all job whose peer only writes runtime tables', () => {
    const readSets = setsOf({ 'job-a': ['*'], 'job-b': ['table_a'] });
    const writeSets = setsOf({ 'job-a': ['table_a'], 'job-b': ['jobs'] });
    expect(findFeedingCycle([A, B], readSets, writeSets)).toBeNull();
  });

  it('should not build cycle edges for jobs that were never observed', () => {
    expect(findFeedingCycle([A, B], new Map(), setsOf({ 'job-a': ['table_a'], 'job-b': ['table_b'] }))).toBeNull();
  });

  it('should not name two jobs whose edges only close through different tenants', () => {
    const readSets: TableSets = new Map([
      ['job-a', new Map([['tenant-1', new Set(['table_x'])]])],
      ['job-b', new Map([['tenant-2', new Set(['table_y'])]])],
    ]);
    const writeSets: TableSets = new Map([
      ['job-a', new Map([['tenant-1', new Set(['table_y'])]])],
      ['job-b', new Map([['tenant-2', new Set(['table_x'])]])],
    ]);
    expect(findFeedingCycle([A, B], readSets, writeSets)).toBeNull();
  });

  it('should name a cycle that closes inside a tenant over global tables', () => {
    const tenantIds = ['tenant-1', 'tenant-2'];
    const readSets = setsOf({ 'job-a': ['table_h'], 'job-b': ['table_g'] }, tenantIds);
    const writeSets = setsOf({ 'job-a': ['table_g'], 'job-b': ['table_h'] }, tenantIds);
    expect(findFeedingCycle([A, B], readSets, writeSets)).toContain('job-a');
  });

  /**
   * Every observed job is watermark-scoped, so the job a cycle wakes finds nothing stale and writes
   * nothing: the loop stops on its own, where cutting the routing would freeze both jobs.
   */
  it('should keep routing the jobs of a cycle the persisted observations already hold', async () => {
    const h = createHarness([A, B], {
      observations: [
        ...reads('job-a', 'tenant-1', 'table_b'), ...writes('job-a', 'tenant-1', 'table_a'),
        ...reads('job-b', 'tenant-1', 'table_a'), ...writes('job-b', 'tenant-1', 'table_b'),
      ],
    });
    await h.dispatcher.start();
    expect(h.cycles).toEqual([['job-a', 'job-b', 'job-a']]);
    // A cycle is worth knowing about, never worth failing over: nothing goes to the error channel.
    expect(h.errors).toEqual([]);

    h.dispatcher.handleEvent({ table: 'table_a', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: 'job-b', tenantId: 'tenant-1', reason: 'change', interactive: true }]);
  });

  it('should install a refreshed observation that closes a cycle, and say so', async () => {
    const h = createHarness([A, B], {
      observations: [
        ...reads('job-a', 'tenant-1', 'table_b'), ...writes('job-a', 'tenant-1', 'table_a'),
        ...reads('job-b', 'tenant-1', 'other_table'), ...writes('job-b', 'tenant-1', 'table_b'),
      ],
    });
    await h.dispatcher.start();
    expect(h.cycles).toEqual([]);

    h.dispatcher.onRunCompleted('job-b', 'tenant-1', 100, observed({ reads: ['table_a'], writes: ['table_b'] }));
    expect(h.errors).toEqual([]);
    expect(h.cycles).toEqual([['job-a', 'job-b', 'job-a']]);
    // The set the run actually read is the one it stays subscribed to, so the new table routes.
    expect(h.persisted).toEqual([]);
    h.dispatcher.handleEvent({ table: 'table_a', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: 'job-b', tenantId: 'tenant-1', reason: 'change', interactive: true }]);
  });
});

/**
 * Every observation refresh of a job inside a cycle detects the same cycle again, and a tenant
 * running a connector refreshes several a minute: reported once per detection, one standing cycle
 * is a continuous log stream for as long as the process lives.
 */
describe('feeding cycles are reported once each', () => {
  const A: DispatchedJob = { kind: 'job-a', observed: true };
  const B: DispatchedJob = { kind: 'job-b', observed: true };
  const C: DispatchedJob = { kind: 'job-c', observed: true };

  const cyclingHarness = (onFeedingCycle?: (cycle: Array<string>) => void) => createHarness([A, B, C], {
    observations: [
      ...reads('job-a', 'tenant-1', 'table_b'), ...writes('job-a', 'tenant-1', 'table_a'),
      ...reads('job-b', 'tenant-1', 'table_a'), ...writes('job-b', 'tenant-1', 'table_b'),
    ],
    onFeedingCycle,
  });

  it('should report one standing cycle once, whatever the number of refreshes', async () => {
    const h = cyclingHarness();
    await h.dispatcher.start();
    expect(h.cycles).toHaveLength(1);

    for (let i = 0; i < 10; i += 1) {
      h.dispatcher.onRunCompleted('job-a', 'tenant-1', 100, observed({ reads: ['table_b'], writes: ['table_a'] }));
    }

    expect(h.cycles).toEqual([['job-a', 'job-b', 'job-a']]);
    expect(h.errors).toEqual([]);
  });

  it('should report a second cycle that a later observation opens', async () => {
    const h = cyclingHarness();
    await h.dispatcher.start();
    h.dispatcher.onRunCompleted('job-a', 'tenant-1', 100, observed({ reads: ['table_b'], writes: ['table_a'] }));
    expect(h.cycles).toHaveLength(1);

    // `job-c` joins the graph with edges of its own, which is a cycle the first report never named.
    h.dispatcher.onRunCompleted('job-c', 'tenant-1', 100, observed({ reads: ['table_a'], writes: ['table_c'] }));
    h.dispatcher.onRunCompleted('job-a', 'tenant-1', 100, observed({ reads: ['table_c'], writes: ['table_a'] }));

    expect(h.cycles).toHaveLength(2);
    expect(h.cycles[1]).not.toEqual(h.cycles[0]);
    expect(h.cycles[1]).toContain('job-c');
    expect(h.errors).toEqual([]);
  });

  /**
   * The engine's own wiring, run against the real logger: a report that throws is swallowed by the
   * caller's error handling, so the cycle is never named and the finalisation carrying it is logged
   * as a failure instead.
   */
  it('should report through the real logger and the real counter without throwing', async () => {
    const h = cyclingHarness(createFeedingCycleReport(createLogger({ engine: 'recompute-dispatcher' })));
    const captured: Array<LogSinkLine> = [];
    setLogSink((line) => captured.push(line));

    try {
      await expect(h.dispatcher.start()).resolves.not.toThrow();
    } finally {
      setLogSink(null);
    }

    expect(h.cycles).toHaveLength(1);
    expect(h.errors).toEqual([]);
    expect(captured.map((line) => line.message)).toContain('Recompute jobs feed each other: their reads and writes form a cycle');
    expect(vi.mocked(recordFeedingCycle)).toHaveBeenCalledWith(['job-a', 'job-b', 'job-a']);
  });

  it('should count one metric point per distinct cycle, which is what the dashboards document', async () => {
    const h = cyclingHarness();
    await h.dispatcher.start();

    for (let i = 0; i < 10; i += 1) {
      h.dispatcher.onRunCompleted('job-b', 'tenant-1', 100, observed({ reads: ['table_a'], writes: ['table_b'] }));
    }

    expect(h.cycles).toHaveLength(1);
  });
});

describe('feeding cycles that do not converge', () => {
  const A: DispatchedJob = { kind: 'job-a', observed: true };
  const B: DispatchedJob = { kind: 'job-b', observed: true };

  const askFromJob = async (h: ReturnType<typeof createHarness>, times: number, origin = 'job-b') => {
    for (let i = 0; i < times; i += 1) {
      h.dispatcher.handleEvent({ table: 'table_a', tenantId: 'tenant-1', origin });
      await h.advance(1_000);
    }
  };

  it('should report a run other jobs alone keep asking for, naming them', async () => {
    const h = createHarness([A, B], { observations: reads('job-a', 'tenant-1', 'table_a') });
    await h.dispatcher.start();

    await askFromJob(h, 19);
    expect(h.errors).not.toContain('feeding cycle');

    await askFromJob(h, 1);
    expect(h.errors).toContain('feeding cycle');
    expect(h.enqueues).toHaveLength(20);
  });

  it('should not report asks from a job no change wakes, such as a connector sync', async () => {
    const sync: DispatchedJob = { kind: 'connector-sync', observed: false };
    const h = createHarness([A, sync], { observations: reads('job-a', 'tenant-1', 'table_a') });
    await h.dispatcher.start();

    await askFromJob(h, 30, sync.kind);
    expect(h.errors).not.toContain('feeding cycle');
    expect(h.enqueues).toHaveLength(30);
  });

  it('should not report asks a client write took part in', async () => {
    const h = createHarness([A], { observations: reads('job-a', 'tenant-1', 'table_a') });
    await h.dispatcher.start();

    for (let i = 0; i < 30; i += 1) {
      h.dispatcher.handleEvent({ table: 'table_a', tenantId: 'tenant-1' });
      await h.advance(1_000);
    }
    expect(h.errors).not.toContain('feeding cycle');
  });

  it('should forget asks that fall out of the window', async () => {
    const h = createHarness([A], { observations: reads('job-a', 'tenant-1', 'table_a') });
    await h.dispatcher.start();

    await askFromJob(h, 19);
    await h.advance(60_000);
    await askFromJob(h, 19);
    expect(h.errors).not.toContain('feeding cycle');
  });
});

describe('dispatcher observation persistence', () => {
  it('should write back an observation the run could not persist', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 500, observed({ reads: ['*'], writes: [] }, false));
    expect(h.persisted).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reads: ['*'], writes: [] }]);
  });

  it('should not write back an observation the run already persisted', async () => {
    const h = createHarness([FS]);
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 500, observed({ reads: ['asset_evidence'], writes: [] }));
    expect(h.persisted).toEqual([]);
  });

  it('should keep the set a run installed while start was still loading the persisted rows', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', '*') });
    const starting = h.dispatcher.start();
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 500, observed({ reads: ['asset_evidence'], writes: [] }));
    await starting;
    h.dispatcher.handleEvent({ table: 'countries', tenantId: 'tenant-1' });
    await h.advance(120_000);
    expect(h.enqueues).toHaveLength(0);
  });
});

describe('dispatcher widened observation', () => {
  it('should route on every table but the runtime ones after a run hands back the sentinel', async () => {
    const h = createHarness([FS], { observations: reads(FS.kind, 'tenant-1', 'asset_evidence') });
    await h.dispatcher.start();
    h.dispatcher.onRunStarted(FS.kind, 'tenant-1');
    h.dispatcher.onRunCompleted(FS.kind, 'tenant-1', 500, observed({ reads: ['*'], writes: [] }));
    h.dispatcher.handleEvent({ table: 'countries', tenantId: 'tenant-1' });
    h.dispatcher.handleEvent({ table: 'jobs', tenantId: 'tenant-1' });
    await h.advance(1_000);
    expect(h.enqueues).toEqual([{ kind: FS.kind, tenantId: 'tenant-1', reason: 'change', interactive: true }]);
  });
});
