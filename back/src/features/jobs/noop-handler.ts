import type { JobHandler } from '@app/module';
import { newError } from '@app/utils';

export interface NoopJobPayload extends Record<string, unknown> {
  delayMs?: number,
}

// Minimal handler for boot wiring + integration tests. Sleeps `delayMs`
// honouring the AbortSignal so cancel/timeout paths can be exercised.
export const noopHandler: JobHandler<NoopJobPayload, Record<string, unknown>> = async (ctx) => {
  const delayMs = typeof ctx.payload.delayMs === 'number' ? ctx.payload.delayMs : 0;
  if (delayMs <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(newError(`Aborted: ${String(ctx.signal.reason)}`));
    };
    if (ctx.signal.aborted) {
      onAbort();
      return;
    }
    ctx.signal.addEventListener('abort', onAbort, { once: true });
  });
};
