import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { probeConnection } from './db-connection-probe';

const createMockPool = (queryImpl: () => Promise<unknown>) => {
  const client = { query: vi.fn(queryImpl), release: vi.fn() };
  const pool = { connect: vi.fn(() => Promise.resolve(client)) };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock, partial object satisfies Pool interface in practice
  return { pool: pool as unknown as Pool, client };
};

describe('probeConnection', () => {
  it('returns the server version and releases the client when the probe query succeeds', async () => {
    const { pool, client } = createMockPool(() => Promise.resolve({ rows: [{ server_version: '16.4 (Debian 16.4-1.pgdg120+1)' }] }));

    await expect(probeConnection(pool)).resolves.toBe('16.4 (Debian 16.4-1.pgdg120+1)');

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('resolves to undefined when the server returns no row', async () => {
    const { pool } = createMockPool(() => Promise.resolve({ rows: [] }));

    await expect(probeConnection(pool)).resolves.toBeUndefined();
  });

  it('still releases the client when the probe query throws', async () => {
    const { pool, client } = createMockPool(() => Promise.reject(new Error('cannot_connect_now')));

    await expect(probeConnection(pool)).rejects.toThrow('cannot_connect_now');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to release when pool.connect itself throws', async () => {
    const pool = { connect: vi.fn(() => Promise.reject(new Error('pool exhausted'))) };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock, partial object satisfies Pool interface in practice
    await expect(probeConnection(pool as unknown as Pool)).rejects.toThrow('pool exhausted');
  });
});
