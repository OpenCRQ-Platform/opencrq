import type { DataChangedSignal } from '@app/back/src/features/events/data-changed-hub';
import type { EventOrigin } from '@app/module';
import { createDataChangedHub } from '@app/back/src/features/events/data-changed-hub';
import { startDataChangedListener } from '@app/back/src/features/events/data-changed-listener';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The listener connects through the backend's own config, which the shared setup stubs out.
vi.mock('../../../../back/src/config', () => ({
  config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() } }),
  pmConfig: {},
  getProcessName: () => 'test',
}));

const services = createTestServices(db);

// Short windows keep the test quick. What it pins is that the two writer classes are throttled
// against separate clocks, not the values a deployment runs.
const WINDOW_MS = 50;
const JOB_WINDOW_MS = 1_000;

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

describe('data_changed doorbell throttling by writer', () => {
  let controller: AbortController;
  let loop: Promise<void>;
  let hub: ReturnType<typeof createDataChangedHub>;
  let doorbells: Array<DataChangedSignal>;
  let subscription: Promise<void>;
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;

    controller = new AbortController();
    hub = createDataChangedHub({ windowMs: WINDOW_MS, jobWindowMs: JOB_WINDOW_MS });
    doorbells = [];
    const stream = hub.subscribe({ tenantIds: [tenantId], signal: controller.signal });
    subscription = (async () => {
      try {
        for await (const signal of stream) {
          doorbells.push(signal);
        }
      } catch {
        // AbortError on teardown: the normal way a subscription ends.
      }
    })();

    let listening = false;
    // The wiring features/events/index.ts installs between the LISTEN and the hub, so the test
    // fails if the listener stops forwarding the payload's origin or table.
    loop = startDataChangedListener({
      signal: controller.signal,
      onNotify: ({ tenantId: notifiedTenant, origin, interactive, table }) => hub.publish(notifiedTenant, origin, interactive, table),
      onListening: () => {
        listening = true;
      },
    });
    await waitFor(() => listening);
  });

  afterEach(async () => {
    controller.abort();
    await loop;
    await subscription;
    hub.closeAll();
  });

  it('should collapse a job burst spanning many user windows into a single doorbell', async () => {
    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'probe-recompute', interactive: false };

    // What a full-estate recompute looks like from the outside: writes landing continuously, each
    // one well past the window a user's own edit would ring in.
    for (let i = 0; i < 5; i += 1) {
      await services.withOrigin(jobOrigin).jobs.enqueueJob({ kind: `probe-bulk-${i}`, tenantId, payload: {} });
      await settle(WINDOW_MS * 2);
    }
    expect(doorbells).toHaveLength(0);

    await settle(JOB_WINDOW_MS);
    expect(doorbells).toHaveLength(1);
  });

  it('should ring a user write while a job burst is still in flight', async () => {
    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'probe-recompute', interactive: false };
    await services.withOrigin(jobOrigin).jobs.enqueueJob({ kind: 'probe-bulk', tenantId, payload: {} });

    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: uuidv7(), name: 'Org under a running job' }]);
    await settle(WINDOW_MS * 4);

    expect(doorbells.length).toBeGreaterThanOrEqual(1);
    expect(doorbells[0].tables).toEqual(['organizations']);
  });

  it('should ring a job run downstream of a real change on the fast window, not the coarse one', async () => {
    const eventOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'probe-recompute', interactive: true };
    await services.withOrigin(eventOrigin).jobs.enqueueJob({ kind: 'probe-event-triggered', tenantId, payload: {} });

    await settle(WINDOW_MS * 4);
    expect(doorbells).toHaveLength(1);
  });

  // The two ways one recompute kind runs: woken by a save the analyst is waiting on, and sweeping
  // the estate at boot. Keyed on the kind alone they would share a bucket, and the save would wait
  // out the sweep's window.
  it('should separate the two windows of one recompute kind', async () => {
    const sweepOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'financial-estimates-recompute', interactive: false };
    const savedOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'financial-estimates-recompute', interactive: true };

    await services.withOrigin(sweepOrigin).jobs.enqueueJob({ kind: 'probe-sweep', tenantId, payload: {} });
    await services.withOrigin(savedOrigin).jobs.enqueueJob({ kind: 'probe-saved', tenantId, payload: {} });

    await settle(WINDOW_MS * 4);
    expect(doorbells).toHaveLength(1);

    await settle(JOB_WINDOW_MS);
    expect(doorbells).toHaveLength(2);
  });

  // A sync runs under its caller's authorization, so its writes carry a `client`/`connector`
  // origin and the run itself only shows through the tag hung on it. The window has to come off
  // that tag, or a person waiting on Sync now waits out a sweep's clock.
  it('should ring a run writing under its caller authorization on the window its tag declares', async () => {
    const borrowed: EventOrigin = { type: 'client', userId: adminUserId, tenantId, job: { jobKind: 'probe-sync', interactive: true } };
    await services.withOrigin(borrowed).jobs.enqueueJob({ kind: 'probe-borrowed', tenantId, payload: {} });

    await settle(WINDOW_MS * 4);
    expect(doorbells).toHaveLength(1);
  });
});
