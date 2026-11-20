import type { JobHandler, PendingMark } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { createLogger } from '../../utils/logger';
import { recordMirrorRebuild } from './mirror-rebuild-metrics';

const { logTrace, logFromError } = createLogger({ engine: 'job-runtime' });

/**
 * How many marked mirror rows one batch takes. Each can name an actor whose relationships the batch
 * holds until it commits, so the figure bounds the worker's heap: 200 rows of the heaviest intrusion
 * sets of a large CTI mirror already take about 330 MB.
 */
export const MIRROR_REBUILD_BATCH_SIZE = 50;

/**
 * What one run may spend before handing the worker slot back, whichever comes first. A backlog that
 * outlives the bound is not dropped: the run books its own follow-up, so a burst under a stream that
 * then falls silent is drained by the queue rather than by the next write that happens to ring.
 */
export const MIRROR_REBUILD_MAX_BATCHES = 20;
export const MIRROR_REBUILD_MAX_RUNTIME_MS = 60_000;

export const openctiMirrorRebuildHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    // Falling back to the shared instance would run unobserved, and the subscription would go stale.
    throw newError('OpenCTI mirror rebuild must run as an observed job', { kind: ctx.kind });
  }
  const services = createServices([...allServiceDefinitions], ctx.runDb)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });

  const startedAtMs = Date.now();
  let batches = 0;
  let scanned = 0;
  let rebuilt = 0;
  let retracted = 0;
  let failed = 0;
  let bounded = false;
  let remaining = false;
  let after: PendingMark | undefined;
  // The first batch runs whatever it finds: an empty scan is what keeps the mirror in the observed
  // read set, which is the subscription the next mirror write's doorbell routes on.
  for (;;) {
    const batch = await services.openctiConnector.rebuildPendingBatch(
      ctx.tenantId,
      MIRROR_REBUILD_BATCH_SIZE,
      after,
    );
    batches += 1;
    scanned += batch.scanned;
    rebuilt += batch.rebuilt;
    retracted += batch.retracted;
    failed += batch.failures.length;
    remaining = batch.remaining;
    for (const failure of batch.failures) {
      logFromError(failure.error, 'OpenCTI actor rebuild failed, its rows stay marked', { tenantId: ctx.tenantId, stixId: failure.stixId });
    }
    // Each batch scans past the last row of the one before, so a run walks the backlog once whatever
    // it manages to settle: rows an actor's failure left marked are stepped over rather than taken
    // again, and the run ends when the scan finds nothing beyond that bound.
    if (!batch.locked || batch.scanned === 0 || batch.bound === null || ctx.signal.aborted) {
      break;
    }
    after = batch.bound;
    if (batches >= MIRROR_REBUILD_MAX_BATCHES || Date.now() - startedAtMs >= MIRROR_REBUILD_MAX_RUNTIME_MS) {
      bounded = true;
      break;
    }
  }

  logTrace('OpenCTI mirror rebuilt', { tenantId: ctx.tenantId, batches, scanned, rebuilt, retracted, failed, bounded });
  recordMirrorRebuild({ rebuilt, retracted, failed });
  // A per-actor failure is not a run failure, so the row's status cannot carry it: without this the
  // count lives in the logs alone and a reader of `jobs` sees a clean run.
  await ctx.updateProgress({
    processedTotal: rebuilt + retracted,
    message: `${rebuilt} rebuilt, ${retracted} retracted, ${failed} failed`,
  });

  return { continuation: bounded && remaining };
};
