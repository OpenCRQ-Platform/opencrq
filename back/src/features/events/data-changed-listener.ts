import { z } from 'zod';
import { DATA_CHANGED_CHANNEL } from '@app/module';
import { createLogger } from '../../utils/logger';
import { startPgListenLoop } from '../../utils/pg-listen-loop';

const logger = createLogger({ feature: 'events' });

const dataChangedPayloadSchema = z.object({
  tenantId: z.string().optional(),
  table: z.string(),
  op: z.string(),
  // The job kind whose run caused the write: the recompute dispatcher drops a job's own echo on it.
  origin: z.string().nullish(),
  // Whether anybody waits on that run (jobs.interactive): the hub picks a throttle window from it.
  interactive: z.boolean().nullish(),
});

export type DataChangedPayload = z.infer<typeof dataChangedPayloadSchema>;

export interface DataChange {
  // null for a global table, one without tenant_id.
  tenantId: string | null,
  // The job kind whose run produced the write, null when a user wrote.
  origin: string | null,
  // Whether anybody waits on that run, null when a user wrote directly.
  interactive: boolean | null,
  table: string,
  op: string,
}

export interface DataChangedListenerOptions {
  signal: AbortSignal,
  onNotify: (change: DataChange) => void,
  // Fired after each LISTEN handshake; callers drain to catch up on NOTIFYs
  // dropped during the disconnect window.
  onListening?: () => void,
  reconnectDelayMs?: number,
}

export const startDataChangedListener = (opts: DataChangedListenerOptions): Promise<void> =>
  startPgListenLoop<DataChangedPayload>({
    channel: DATA_CHANGED_CHANNEL,
    signal: opts.signal,
    parse: (payload) => dataChangedPayloadSchema.parse(JSON.parse(payload)),
    onNotify: (parsed) => opts.onNotify({
      tenantId: parsed.tenantId ?? null,
      origin: parsed.origin ?? null,
      interactive: parsed.interactive ?? null,
      table: parsed.table,
      op: parsed.op,
    }),
    onListening: opts.onListening,
    reconnectDelayMs: opts.reconnectDelayMs,
    logger,
  });
