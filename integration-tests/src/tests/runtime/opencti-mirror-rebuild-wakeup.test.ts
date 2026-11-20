import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventOrigin, JobHandler } from '@app/module';
import { createDispatcher } from '@app/back/src/features/recompute-dispatcher/dispatcher-core';
import { OPENCTI_MIRROR_REBUILD_JOB } from '@app/back/src/features/opencti-mirror-rebuild';
import { openctiMirrorRebuildHandler } from '@app/back/src/features/opencti-mirror-rebuild/opencti-mirror-rebuild-handler';
import { loadDoorbellParents } from '@app/module';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { OBSERVED_JOB_FIXTURES } from '../../helpers/observed-job-fixtures';
import { db, pool } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The job runtime's own modules build their engine from the backend config while this file is still
// being evaluated, so the connection is resolved inside the factory rather than from its imports.
vi.mock('../../../../back/src/config', async () => {
  const setup = await import('../../setup/pg-config');
  const { SCORE_HISTORY_RETENTION_DAYS } = await import('@app/module');
  return {
    config: () => ({
      postgres: { ...setup.pgConfig, database: setup.getWorkerDbName() },
      jobs: { enabled: true },
      recompute: { score_history_retention_days: SCORE_HISTORY_RETENTION_DAYS },
    }),
    pmConfig: {},
    getProcessName: () => 'test',
  };
});

const services = createTestServices(db);

const workerFeatureNames = (): Array<string> => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../../../../back/src/index-worker.ts'), 'utf8');
  return [...source.matchAll(/^import '\.\/features\/([\w-]+)';/gm)].map((match) => match[1]);
};

const settle = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await settle(25);
  }
};

/**
 * Walks the whole wake-up chain rather than any one link of it: the run installs its own read set,
 * a real `LISTEN` carries the mirror's doorbell, and the dispatcher decides on what the run
 * persisted.
 */
describe('the OpenCTI mirror rebuild is woken by a write to the mirror', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let listener: pg.Client;
  let dispatcher: ReturnType<typeof createDispatcher>;
  let asked: Array<{ kind: string, tenantId: string }>;

  const dispatcherDeps = (): Parameters<typeof createDispatcher>[1] => ({
    enqueue: (kind, forTenant) => {
      asked.push({ kind, tenantId: forTenant });
      return Promise.resolve();
    },
    loadObservations: () => services.withOrigin({ type: 'system' }).jobDependencies.getAllObservations(),
    listTenantIds: async () => (await services.withOrigin({ type: 'system' }).tenants.getTenants()).map((tenant) => tenant.id),
    persistObservation: () => Promise.resolve(),
    loadDoorbellParents: () => loadDoorbellParents(db),
    settings: { factor: 0, floorMs: 10, capMs: 50, reconnectMinIntervalMs: 1_000 },
    onError: () => undefined,
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    asked = [];

    dispatcher = createDispatcher([{ kind: OPENCTI_MIRROR_REBUILD_JOB, observed: true }], dispatcherDeps());

    listener = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
    await listener.connect();
    listener.on('notification', (message) => {
      dispatcher.handleEvent(JSON.parse(message.payload ?? '{}'));
    });
    await listener.query('LISTEN data_changed');
  });

  afterEach(async () => {
    dispatcher.stop();
    await listener.end();
  });

  /** The run itself installs the subscription the dispatcher then routes on. */
  const installReadSet = async (kind: string, handler: JobHandler) => {
    const { createRunObservation, finalizeRunObservation } = await import('@app/back/src/engines/job-runtime/run-observation');
    const { createJobContext } = await import('@app/back/src/engines/job-runtime/job-context-factory');
    const observation = createRunObservation(pool);
    await handler(createJobContext({
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
    }));
    return finalizeRunObservation(pool, observation, kind, tenantId, false, () => undefined);
  };

  const installMirrorReadSet = () => installReadSet(OPENCTI_MIRROR_REBUILD_JOB, openctiMirrorRebuildHandler);

  it('should ask for a run on a mirror write alone', async () => {
    const persisted = await installMirrorReadSet();
    expect(persisted.reads).toContain('opencti_stream_objects');
    await dispatcher.start();

    await services.withOrigin(adminOrigin).openctiConnector.upsertStreamObject(
      tenantId,
      'intrusion-set--00000000-0000-4000-8000-00000000dead',
      'intrusion-set',
      { id: 'intrusion-set--00000000-0000-4000-8000-00000000dead', type: 'intrusion-set', name: 'Woken Actor' },
    );

    await waitFor(() => asked.length > 0);
    expect(asked[0]).toEqual({ kind: OPENCTI_MIRROR_REBUILD_JOB, tenantId });
  });

  /**
   * A backfill writes the mirror faster than the throttle delay for hours. Re-arming the timer on
   * each event, as a debounce does, would leave it forever short of its own deadline, so the proof
   * is that the asks keep coming while the writer never pauses.
   */
  it('should keep asking for a run while the mirror is written without a pause', async () => {
    await installMirrorReadSet();
    dispatcher.stop();
    const askedAtMs: Array<number> = [];
    dispatcher = createDispatcher([{ kind: OPENCTI_MIRROR_REBUILD_JOB, observed: true }], {
      ...dispatcherDeps(),
      enqueue: () => {
        askedAtMs.push(Date.now());
        return Promise.resolve();
      },
      settings: { factor: 0, floorMs: 50, capMs: 50, reconnectMinIntervalMs: 1_000 },
    });
    await dispatcher.start();

    const startedAtMs = Date.now();
    let written = 0;
    while (Date.now() - startedAtMs < 1_000) {
      written += 1;
      const stixId = `intrusion-set--00000000-0000-4000-8000-${String(written).padStart(12, '0')}`;
      await services.withOrigin(adminOrigin).openctiConnector.upsertStreamObject(
        tenantId,
        stixId,
        'intrusion-set',
        { id: stixId, type: 'intrusion-set', name: `Streamed Actor ${written}` },
      );
    }

    expect(askedAtMs.length).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it('should ask for nothing when a table the run never reads is written', async () => {
    await installMirrorReadSet();
    await dispatcher.start();

    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: uuidv7(), name: 'Unrelated' }]);

    await settle(500);
    expect(asked).toEqual([]);
  });

  /**
   * The mirror job shares `threat_analyses` with the other actor recomputes, reading and
   * writing it as they do, so together they close feeding cycles. The dispatcher routes on the sets
   * those runs really persist, and this asserts the mirror job is still woken with all of them in.
   */
  it('should still be woken with every observed job of the worker registered beside it', async () => {
    for (const name of workerFeatureNames()) {
      await import(`../../../../back/src/features/${name}/index.ts`);
    }
    const { listFeatures } = await import('@app/back/src/features/features-manager');
    listFeatures().forEach((feature) => feature.activate(new AbortController().signal));
    const { jobRuntimeEngine } = await import('@app/back/src/engines/job-runtime');
    const registrations = jobRuntimeEngine.listRegisteredJobs().filter(({ options }) => options.observed);
    expect(registrations.map(({ kind }) => kind)).toContain(OPENCTI_MIRROR_REBUILD_JOB);
    expect(registrations.length).toBeGreaterThan(1);

    const cycles: Array<Array<string>> = [];
    for (const { kind } of registrations) {
      await OBSERVED_JOB_FIXTURES[kind]({ services, db, tenantId, adminOrigin });
      await installReadSet(kind, jobRuntimeEngine.getHandler(kind)!);
    }
    dispatcher.stop();
    dispatcher = createDispatcher(
      registrations.map(({ kind }) => ({ kind, observed: true })),
      { ...dispatcherDeps(), onFeedingCycle: (cycle) => cycles.push(cycle) },
    );
    await dispatcher.start();
    // The cycle is real, and every kind of it still routes: that is what this asserts.
    expect(cycles.length).toBeGreaterThan(0);

    asked = [];
    await services.withOrigin(adminOrigin).openctiConnector.upsertStreamObject(
      tenantId,
      'intrusion-set--00000000-0000-4000-8000-00000000beef',
      'intrusion-set',
      { id: 'intrusion-set--00000000-0000-4000-8000-00000000beef', type: 'intrusion-set', name: 'Crowded Actor' },
    );

    await waitFor(() => asked.some((ask) => ask.kind === OPENCTI_MIRROR_REBUILD_JOB));
  }, 60_000);
});
