import { DATA_CHANGED_CHANNEL } from '@app/module';
import type { Pool } from 'pg';

/** Rings the doorbell the `data_changed` triggers ring, for a table that deliberately carries none. */
export const notifyDataChanged = async (pool: Pool, tenantId: string, table: string): Promise<void> => {
  await pool.query('SELECT pg_notify($1, $2)', [
    DATA_CHANGED_CHANNEL,
    JSON.stringify({ tenantId, table, op: 'INSERT' }),
  ]);
};
