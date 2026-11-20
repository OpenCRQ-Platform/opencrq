import type { JobHandler, ParsedThreat } from '@app/module';
import { allServiceDefinitions, createServices, NonRetryableError } from '@app/module';
import type { ThreatBundlePayload } from './stored-bundle';
import { dbEngine } from '../../engines/db';
import { createLogger } from '../../utils/logger';
import { bundleOrigin, bundleSourceKind, readStoredBundle } from './stored-bundle';

const { logFromError, logTrace, logWarn } = createLogger({ feature: 'threats' });

export const THREAT_BUNDLE_OUTCOME_RESCORE_JOB = 'threat-bundle-outcome-rescore';

/** How many STIX ids a warning about unrescorable threats names: enough to look one up, not a flood. */
export const UNREACHABLE_SAMPLE_SIZE = 10;

// A type, not an interface: the job registry asks for a payload assignable to `Record<string, unknown>`.
export type ThreatBundleOutcomeRescorePayload = {
  /** Oldest upload first. */
  files: Array<ThreatBundlePayload>,
  /** The threats to rescore, which no other source holds. */
  stixIds: Array<string>,
};

const authorKey = (file: ThreatBundlePayload): string =>
  'userId' in file ? `user:${file.userId}` : `service-account:${file.serviceAccountId}`;

/**
 * Rescores the threats only uploaded STIX files hold, under a new outcome model. A threat several
 * files carry is rescored once, from the latest upload, since that is the snapshot its analysis was
 * last rewritten from; one run reads every file so no older upload can land after a newer one.
 * `rescoreOnly` leaves alone a threat deleted since, or already rescored by a newer ingestion, which
 * is also what makes a retry rewrite nothing twice.
 */
export const threatBundleOutcomeRescoreHandler: JobHandler<ThreatBundleOutcomeRescorePayload> = async (ctx) => {
  const wanted = new Set(ctx.payload.stixIds);
  const latest = new Map<string, { entry: ParsedThreat, file: ThreatBundlePayload }>();
  for (const file of ctx.payload.files) {
    if (ctx.signal.aborted) {
      return;
    }
    let parsed: Array<ParsedThreat>;
    try {
      parsed = await readStoredBundle(file, ctx.tenantId);
    } catch (error) {
      if (!(error instanceof NonRetryableError)) {
        throw error;
      }
      // One unreadable upload must not hold back the threats the others carry.
      logFromError(error, 'Skipped a STIX file the outcome rescore could not read', { tenantId: ctx.tenantId, storedFileId: file.storedFileId });
      continue;
    }
    for (const entry of parsed) {
      if (wanted.has(entry.threat.stixId)) {
        latest.set(entry.threat.stixId, { entry, file });
      }
    }
  }

  const unreachable = [...wanted].filter((stixId) => !latest.has(stixId));
  if (unreachable.length > 0) {
    logWarn('Threats scored under an older outcome model are in no stored STIX file', {
      tenantId: ctx.tenantId, count: unreachable.length, stixIds: unreachable.slice(0, UNREACHABLE_SAMPLE_SIZE),
    });
  }

  const byAuthor = new Map<string, { file: ThreatBundlePayload, entries: Array<ParsedThreat> }>();
  for (const { entry, file } of latest.values()) {
    const group = byAuthor.get(authorKey(file)) ?? { file, entries: [] };
    group.entries.push(entry);
    byAuthor.set(authorKey(file), group);
  }

  let rescored = 0;
  let skipped = 0;
  for (const { file, entries } of byAuthor.values()) {
    if (ctx.signal.aborted) {
      return;
    }
    const services = createServices([...allServiceDefinitions], dbEngine.db).withOrigin(bundleOrigin(file, ctx.tenantId));
    const moved: Array<string> = [];
    try {
      const result = await services.threatAnalyses.ingestBundle(entries, ctx.tenantId, bundleSourceKind(file), {
        rescoreOnly: true,
        onProbabilitiesChanged: (stixId) => moved.push(stixId),
      });
      rescored += result.updated;
      skipped += result.skipped;
    } finally {
      // The mirror may have rebuilt the campaigns under these threats before this run reached them, on
      // the percentages of the previous model. Marked even when the ingestion failed midway, as the upload does.
      await services.openctiConnector.markAttributedChildren(ctx.tenantId, moved);
    }
  }
  logTrace('STIX files rescored for the outcome model', {
    tenantId: ctx.tenantId, files: ctx.payload.files.length, wanted: wanted.size, found: latest.size, rescored, skipped,
  });
};
