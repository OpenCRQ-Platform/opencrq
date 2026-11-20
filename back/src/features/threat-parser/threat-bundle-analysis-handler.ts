import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import type { ThreatBundlePayload } from './stored-bundle';
import { dbEngine } from '../../engines/db';
import { createLogger } from '../../utils/logger';
import { bundleOrigin, bundleSourceKind, readStoredBundle } from './stored-bundle';

const { logTrace } = createLogger({ feature: 'threats' });

/**
 * Downloads a previously-uploaded STIX bundle from RustFS, parses it, and upserts one
 * `threat_analyses` row (+ child collections) per threat found. The job's own
 * status (`succeeded`/`failed`/`dlq`) is the sole tracking mechanism: nothing is persisted on
 * the `threats` side beyond the analyses themselves.
 */
export const threatBundleAnalysisHandler: JobHandler<ThreatBundlePayload> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }

  logTrace('Downloading STIX bundle from RustFS', { jobId: ctx.jobId, storedFileId: ctx.payload.storedFileId });
  const parsed = await readStoredBundle(ctx.payload, ctx.tenantId);

  const services = createServices([...allServiceDefinitions], dbEngine.db).withOrigin(bundleOrigin(ctx.payload, ctx.tenantId));
  const moved: Array<string> = [];
  let result;
  try {
    result = await services.threatAnalyses.ingestBundle(parsed, ctx.tenantId, bundleSourceKind(ctx.payload), {
      onProbabilitiesChanged: (stixId) => moved.push(stixId),
    });
  } finally {
    // The mirror holds campaigns under these threats, which read their percentages. Marked even when
    // the ingestion failed midway: a retry finds the ones already rescored unchanged and names none.
    await services.openctiConnector.markAttributedChildren(ctx.tenantId, moved);
  }
  logTrace('STIX bundle analysis complete', { jobId: ctx.jobId, created: result.created, updated: result.updated, unchanged: result.unchanged });
};
