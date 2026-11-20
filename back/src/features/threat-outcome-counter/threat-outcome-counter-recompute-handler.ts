import type { EventOrigin, JobHandler } from '@app/module';
import { allServiceDefinitions, createServices, originTrigger, OUTCOME_COUNTER_VERSION, planOutcomeCounterRecompute } from '@app/module';
import { newError } from '@app/utils';
import type { ThreatBundlePayload } from '../threat-parser/stored-bundle';
import { dbEngine } from '../../engines/db';
import { THREAT_BUNDLE_OUTCOME_RESCORE_JOB, UNREACHABLE_SAMPLE_SIZE } from '../threat-parser/threat-bundle-outcome-rescore-handler';
import { createLogger } from '../../utils/logger';

const { logFromError, logTrace, logWarn } = createLogger({ engine: 'job-runtime' });

export const THREAT_OUTCOME_COUNTER_RECOMPUTE_JOB = 'threat-outcome-counter-recompute';

/** One rescore of the stored files per model version: the queue then knows they were asked for. */
export const bundleRescoreKey = (): string => `${THREAT_BUNDLE_OUTCOME_RESCORE_JOB}-${OUTCOME_COUNTER_VERSION}`;

/**
 * Sends every analysis scored under another model version (or under none) back to where the counter's
 * inputs live, which is not this database: the OpenCTI mirror for a threat the mirror holds, the
 * uploaded STIX files for the rest. The mirror rebuild and the bundle rescore then rescore it. A default
 * threat is never sent: its own sync rescores it (`getStaleOutcomeAnalyses`).
 *
 * It lives in the handler because it needs the threat analyses, the mirror, the stored files and the
 * queue together: `threat-analyses` cannot depend on `opencti-connector`, which depends on it.
 *
 * A version is recorded once every stale analysis has been sent back, and from then on that row is
 * the run's only read: the rescoring writes the analyses batch after batch, and a run still reading
 * them would be woken by each one. A new version reaches the job through the boot catch-up every
 * observed job gets.
 */
export const threatOutcomeCounterRecomputeHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    // Falling back to the shared instance would run unobserved, and the subscription would go stale.
    throw newError('threat outcome counter recompute must run as an observed job', { kind: ctx.kind });
  }
  const origin: EventOrigin = { type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive };
  const services = createServices([...allServiceDefinitions], ctx.runDb).withOrigin(origin);

  if (await services.threatAnalyses.getDispatchedOutcomeCounterVersion() === OUTCOME_COUNTER_VERSION) {
    return;
  }

  // Only the analyses are read when none is stale: a run that read the mirror for nothing would be
  // woken by every object the OpenCTI stream writes.
  const stale = await services.threatAnalyses.getStaleOutcomeAnalyses();
  if (stale.length === 0) {
    await services.threatAnalyses.recordDispatchedOutcomeCounterVersion(OUTCOME_COUNTER_VERSION);
    return;
  }
  const [mirrorMarks, files] = await Promise.all([
    services.openctiConnector.getLiveThreatMarks(ctx.tenantId, stale.map((analysis) => analysis.stixId)),
    services.fileStorage.getFileAuthors(),
  ]);

  // Queue work goes through the shared instance, never `runDb`: reading `jobs` on the observed one
  // would subscribe this kind to the queue, and every lease renewal would ask for it again.
  const queueServices = createServices([...allServiceDefinitions], dbEngine.db).withOrigin(origin);
  // Every stored file is a STIX upload: the threat uploader is the one route that stores files. A new
  // kind of upload must be told apart here, or it would be re-run as a bundle and fail.
  const replayable = files.flatMap((file): Array<{ file: typeof file, payload: ThreatBundlePayload }> => {
    const payload = file.createdBy !== null
      ? { storedFileId: file.id, userId: file.createdBy }
      : file.createdByServiceAccountId !== null
        ? { storedFileId: file.id, serviceAccountId: file.createdByServiceAccountId }
        : null;
    // An author deleted since the upload leaves no origin to analyse the file under.
    return payload ? [{ file, payload }] : [];
  });

  const plan = planOutcomeCounterRecompute({
    stale,
    mirrorStixIds: new Set(mirrorMarks.map((mark) => mark.stixId)),
    bundleFiles: replayable.map(({ file }) => ({ id: file.id, uploadedAt: file.createdAt })),
  });

  // A threat already marked waits on a rebuild: marking it again would only wake the mirror's own
  // subscribers a second time without changing what the rebuild does.
  const alreadyPending = new Set(mirrorMarks.filter((mark) => mark.pending).map((mark) => mark.stixId));
  const toMark = plan.mirrorStixIds.filter((stixId) => !alreadyPending.has(stixId));
  if (toMark.length > 0) {
    await services.openctiConnector.markThreatsPending(ctx.tenantId, toMark);
  }

  const payloadByFileId = new Map(replayable.map(({ file, payload }) => [file.id, payload]));
  const rescoreFiles = plan.bundleFileIdsInOrder.flatMap((fileId) => payloadByFileId.get(fileId) ?? []);
  let booked = false;
  let unbooked = false;
  if (rescoreFiles.length > 0 && !(await queueServices.jobs.getBookedIdempotencyKeys(ctx.tenantId, [bundleRescoreKey()])).has(bundleRescoreKey())) {
    if (ctx.signal.aborted) {
      unbooked = true;
    } else {
      try {
        await queueServices.jobs.enqueueJob({
          kind: THREAT_BUNDLE_OUTCOME_RESCORE_JOB,
          tenantId: ctx.tenantId,
          payload: { files: rescoreFiles, stixIds: plan.fileStixIds },
          idempotencyKey: bundleRescoreKey(),
          ...originTrigger(origin),
          interactive: ctx.interactive,
          skipIfActive: true,
        });
        booked = true;
      } catch (error) {
        // Not booked, so the version stays unrecorded and tomorrow's run asks again.
        unbooked = true;
        logFromError(error, 'Could not book the rescore of the STIX files for a new outcome model', { tenantId: ctx.tenantId });
      }
    }
  }
  if (plan.fileStixIds.length > 0 && rescoreFiles.length === 0) {
    // Still recorded below: no retry can find a source, one that appears later rescores the threat by
    // itself, and an unrecorded version would keep this job reading the analyses on every write.
    logWarn('Threats scored under an older outcome model have no source left to rescore them', {
      tenantId: ctx.tenantId, count: plan.fileStixIds.length, stixIds: plan.fileStixIds.slice(0, UNREACHABLE_SAMPLE_SIZE),
    });
  }
  if (!unbooked) {
    await services.threatAnalyses.recordDispatchedOutcomeCounterVersion(OUTCOME_COUNTER_VERSION);
  }
  logTrace('Threat outcome counter recompute planned', {
    tenantId: ctx.tenantId,
    stale: stale.length,
    marked: toMark.length,
    fileThreats: plan.fileStixIds.length,
    filesRescoreBooked: booked,
  });
};
