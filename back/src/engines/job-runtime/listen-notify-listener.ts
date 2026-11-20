import { z } from 'zod';
import { JOBS_CHANGED_CHANNEL } from '@app/module';
import { createLogger } from '../../utils/logger';
import { startPgListenLoop } from '../../utils/pg-listen-loop';

const logger = createLogger({ engine: 'job-runtime' });

const jobNotifyPayloadSchema = z.object({
  jobId: z.string(),
  kind: z.string(),
  tenantId: z.string(),
});

export type JobNotifyPayload = z.infer<typeof jobNotifyPayloadSchema>;

export interface ListenNotifyOptions {
  signal: AbortSignal,
  onNotify: (payload: JobNotifyPayload) => void,
  // Fired after each LISTEN handshake; callers drain to catch up on NOTIFYs
  // dropped during the disconnect window.
  onListening?: () => void,
  reconnectDelayMs?: number,
}

export const startListenNotifyListener = (opts: ListenNotifyOptions): Promise<void> =>
  startPgListenLoop<JobNotifyPayload>({
    channel: JOBS_CHANGED_CHANNEL,
    signal: opts.signal,
    parse: (payload) => jobNotifyPayloadSchema.parse(JSON.parse(payload)),
    onNotify: opts.onNotify,
    onListening: opts.onListening,
    reconnectDelayMs: opts.reconnectDelayMs,
    logger,
  });
