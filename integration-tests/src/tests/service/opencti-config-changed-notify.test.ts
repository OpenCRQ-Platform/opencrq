import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import type { EventOrigin } from '@app/module';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const CHANNEL = 'opencti_config_changed';

const services = createTestServices(db);
const allListeners: Array<pg.Client> = [];

afterAll(async () => {
  await Promise.all(allListeners.map((c) => c.end().catch(() => undefined)));
});

const subscribe = async (): Promise<{ received: Array<string> }> => {
  const client = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
  allListeners.push(client);
  await client.connect();
  const received: Array<string> = [];
  client.on('notification', (msg) => {
    if (msg.channel === CHANNEL && msg.payload) {
      received.push(msg.payload);
    }
  });
  await client.query(`LISTEN ${CHANNEL}`);
  return { received };
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

// Give a genuine non-event a chance to (incorrectly) fire before asserting its absence.
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('opencti_config_changed LISTEN/NOTIFY', () => {
  let tenantId: string;
  let serviceAccountId: string;
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    adminOrigin = setup.origin;

    serviceAccountId = uuidv7();
    await services.withOrigin(setup.origin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: 'Test OpenCTI Bot',
    });
  });

  it('notifies on the very first configure', async () => {
    const { received } = await subscribe();

    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');

    await waitFor(() => received.length > 0);
    expect(received).toEqual([tenantId]);
  });

  it('does not notify on a normal cursor flush', async () => {
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
    const { received } = await subscribe();

    await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', new Date(), null, 0, 0);
    await sleep(200);

    expect(received).toEqual([]);
  });

  it('notifies on a reconfigure that resets cursor/lastEventAt/reachedLiveTailAt, even with identical stream/service account', async () => {
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
    await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', new Date(), new Date(), 0, 0);
    const { received } = await subscribe();

    // Same streamId/serviceAccountId as before: only cursor/lastEventAt/reachedLiveTailAt reset.
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');

    await waitFor(() => received.length > 0);
    expect(received).toEqual([tenantId]);
  });

  it('notifies on a reconnect, so the worker puts the consumer back on the live edge', async () => {
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
    await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', new Date(), null, 0, 0);
    const { received } = await subscribe();

    await services.withOrigin(adminOrigin).openctiConnector.reconnectAtLiveTail(tenantId);

    await waitFor(() => received.length > 0);
    expect(received).toEqual([tenantId]);
  });

  it('notifies on a reconnect of a stream that has never recorded an event, which changes no other watched column', async () => {
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
    const { received } = await subscribe();

    await services.withOrigin(adminOrigin).openctiConnector.reconnectAtLiveTail(tenantId);

    await waitFor(() => received.length > 0);
    expect(received).toEqual([tenantId]);
  });

  it('notifies on a second consecutive reconnect, which changes no position because the first cleared it', async () => {
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
    await services.withOrigin(adminOrigin).openctiConnector.reconnectAtLiveTail(tenantId);
    const { received } = await subscribe();

    await services.withOrigin(adminOrigin).openctiConnector.reconnectAtLiveTail(tenantId);

    await waitFor(() => received.length > 0);
    expect(received).toEqual([tenantId]);
  });

  it('notifies on a reset, so the consumer restarts from the stream origin', async () => {
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
    await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', new Date(), new Date(), 0, 0);
    const { received } = await subscribe();

    await services.withOrigin(adminOrigin).openctiConnector.resetStreamState(tenantId);

    await waitFor(() => received.length > 0);
    expect(received).toEqual([tenantId]);
  });

  it('notifies when the configured service account is deactivated/reactivated, so a running consumer reconciles immediately', async () => {
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
    const { received } = await subscribe();

    await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(serviceAccountId, { active: false });
    await waitFor(() => received.length > 0);
    expect(received).toEqual([tenantId]);

    await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(serviceAccountId, { active: true });
    await waitFor(() => received.length > 1);
    expect(received).toEqual([tenantId, tenantId]);
  });

  it('does not notify when deactivating a service account not used by any OpenCTI connector', async () => {
    const unusedServiceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: unusedServiceAccountId, name: 'Unused Bot' });
    const { received } = await subscribe();

    await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(unusedServiceAccountId, { active: false });
    await sleep(200);

    expect(received).toEqual([]);
  });

  it('does not notify on a service account field change unrelated to active', async () => {
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
    const { received } = await subscribe();

    await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(serviceAccountId, { name: 'Renamed Bot' });
    await sleep(200);

    expect(received).toEqual([]);
  });
});
