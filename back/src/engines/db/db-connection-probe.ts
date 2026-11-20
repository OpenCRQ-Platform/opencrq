import type { Pool, PoolClient } from 'pg';

// Always releases the pooled client, including when the probe query itself throws
// (e.g. `57P03 cannot_connect_now` while Postgres is restarting) — otherwise the
// client stays checked out forever and the pool eventually exhausts.
export const probeConnection = async (pool: Pool): Promise<string | undefined> => {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const result = await client.query<{ server_version: string }>('SHOW server_version');
    return result.rows[0]?.server_version;
  } finally {
    client?.release();
  }
};
