import type { Logger } from '@app/back/src/utils/logger';
import { startPgListenLoop } from '@app/back/src/utils/pg-listen-loop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db, pool } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The loop connects through the backend's own config, which the shared setup stubs out.
vi.mock('../../../../back/src/config', () => ({
  config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() } }),
  pmConfig: {},
  getProcessName: () => 'test',
}));

const services = createTestServices(db);

const silentLogger: Logger = {
  logTrace: () => {},
  logTraceFromError: () => {},
  logWarn: () => {},
  logError: () => {},
  logFromError: () => {},
  logFatalError: (message) => {
    throw new Error(message);
  },
  logFromFatalError: (e) => {
    throw e instanceof Error ? e : new Error(String(e));
  },
  enrich: () => silentLogger,
};

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const terminateListener = async (): Promise<void> => {
  const { rows } = await pool.query<{ pid: number }>(
    'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query = $1',
    ['LISTEN data_changed'],
  );
  expect(rows).toHaveLength(1);
  await pool.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
};

describe('pg listen loop reconnect', () => {
  const controller = new AbortController();
  let loop: Promise<void>;

  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    tenantId = (await createTenantWithAdmin(services)).tenantId;
  });

  afterEach(async () => {
    controller.abort();
    await loop;
  });

  it('fires onListening again after the connection is lost, so a change lost in the gap can be caught up', async () => {
    const handshakes: Array<number> = [];
    const notified: Array<{ table: string }> = [];
    loop = startPgListenLoop<{ table: string }>({
      channel: 'data_changed',
      signal: controller.signal,
      parse: (payload) => {
        const parsed: unknown = JSON.parse(payload);
        if (typeof parsed !== 'object' || parsed === null || !('table' in parsed) || typeof parsed.table !== 'string') {
          throw new Error('unexpected payload');
        }
        return { table: parsed.table };
      },
      onNotify: (event) => {
        notified.push(event);
      },
      onListening: () => {
        handshakes.push(Date.now());
      },
      reconnectDelayMs: 500,
      logger: silentLogger,
    });
    await waitFor(() => handshakes.length === 1);

    // The notification fires at commit, so holding the write in an open transaction and committing
    // it right after the terminate puts the change inside the gap whatever the runner's speed.
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('UPDATE tenants SET name = $2 WHERE id = $1', [tenantId, 'lost in the gap']);
      await terminateListener();
      await writer.query('COMMIT');
    } finally {
      writer.release();
    }

    await waitFor(() => handshakes.length === 2);
    expect(notified.filter((event) => event.table === 'tenants')).toHaveLength(0);

    await pool.query('UPDATE tenants SET name = $2 WHERE id = $1', [tenantId, 'after the reconnect']);
    await waitFor(() => notified.some((event) => event.table === 'tenants'));
  });
});
