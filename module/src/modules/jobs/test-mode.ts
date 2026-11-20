import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type {
  EnqueueJobOptions,
  EnqueueJobResult,
  JobContext,
  JobHandler,
} from './types';

let inlineModeEnabled = false;

export const enableInlineMode = (enabled: boolean): void => {
  inlineModeEnabled = enabled;
};

export const isInlineMode = (): boolean => inlineModeEnabled;

export type HandlerLookup = (kind: string) => JobHandler<Record<string, unknown>, Record<string, unknown>> | undefined;

export interface InlineEnqueueDeps {
  getHandler: HandlerLookup,
  enqueueJob: (opts: EnqueueJobOptions) => Promise<EnqueueJobResult>,
}

// Inline mode: runs the handler synchronously in-process, no DB/NOTIFY/worker.
// For unit tests and dev runs without a worker. Pass-through when disabled.
export const createInlineEnqueueWrapper = (deps: InlineEnqueueDeps) => async (
  opts: EnqueueJobOptions,
): Promise<EnqueueJobResult> => {
  if (!inlineModeEnabled) {
    return deps.enqueueJob(opts);
  }

  const handler = deps.getHandler(opts.kind);
  if (!handler) {
    throw newError('Inline mode: no handler registered', { kind: opts.kind });
  }

  const jobId = uuidv7();
  const ctrl = new AbortController();
  const ctx: JobContext = {
    jobId,
    tenantId: opts.tenantId,
    kind: opts.kind,
    interactive: opts.interactive ?? false,
    payload: opts.payload,
    attempt: 1,
    state: null,
    signal: ctrl.signal,
    updateProgress: async () => {},
    saveStateSnapshot: async () => {},
  };
  await handler(ctx);
  return { jobId, alreadyExisted: false };
};
