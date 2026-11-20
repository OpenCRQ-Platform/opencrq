import type { EventOrigin } from '@app/module';
import { JOBS_CHANGED_CHANNEL } from '@app/module';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { getWorkerDbName, pgConfig } from '../../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const allListeners: Array<pg.Client> = [];

afterAll(async () => {
  await Promise.all(allListeners.map((c) => c.end().catch(() => undefined)));
});

const subscribe = async (): Promise<{ client: pg.Client, received: Array<unknown> }> => {
  const client = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
  allListeners.push(client);
  await client.connect();
  const received: Array<unknown> = [];
  client.on('notification', (msg) => {
    if (msg.channel === JOBS_CHANGED_CHANNEL && msg.payload) {
      received.push(JSON.parse(msg.payload));
    }
  });
  await client.query(`LISTEN ${JOBS_CHANGED_CHANNEL}`);
  return { client, received };
};

const waitFor = (predicate: () => boolean, timeoutMs = 2_000): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        reject(new Error('waitFor timed out'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });

describe('jobs LISTEN/NOTIFY', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('enqueueJob emits a NOTIFY on jobs_changed with the right payload', async () => {
    const { received } = await subscribe();

    const enqueue = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { x: 1 },
    });

    await waitFor(() => received.length > 0);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      jobId: enqueue.jobId,
      kind: 'noop',
      tenantId,
    });
  });

  it('alreadyExisted enqueues (idempotency hit) do not emit a NOTIFY', async () => {
    await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'k1',
    });

    const { received } = await subscribe();
    await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'k1',
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(0);
  });

  it('retryFromDlq emits a NOTIFY so workers can wake on requeue', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 1,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
      jobId,
      'w1',
      { message: 'fail' },
      true,
      () => 0,
    );

    const { received } = await subscribe();
    await services.withOrigin(SYSTEM_ORIGIN).jobs.retryFromDlq(jobId);

    await waitFor(() => received.length > 0);
    expect(received[0]).toMatchObject({ jobId });
  });
});
