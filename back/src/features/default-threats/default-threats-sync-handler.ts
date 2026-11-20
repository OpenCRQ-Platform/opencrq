import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices, NonRetryableError } from '@app/module';
import { fromError, newError } from '@app/utils';
import { dbEngine } from '../../engines/db';
import { createLogger } from '../../utils/logger';
import { datasetUrl, FETCH_TIMEOUT_MS, loadStamp, parseDatasetBody } from './default-threats-dataset';

const { logFromError, logTrace } = createLogger({ feature: 'default-threats' });

export const DEFAULT_THREATS_SYNC_JOB = 'default-threats-sync';

export interface DefaultThreatsSyncState extends Record<string, unknown> {
  fileChanged: boolean,
  attackRelease: string | null,
  /** Null on an unchanged file: the count belongs to the load that read it. */
  ignoredTechniqueClaims: number | null,
}

/**
 * Loads the dataset file when it changed since the tenant's last load: the recorded `ETag` (or
 * `Last-Modified`) makes an unchanged file a 304. A tenant with no record, or one recorded under
 * another app or outcome model version, loads whatever the file says, since an upgrade may bring
 * techniques the last load ignored and rescores every threat the file does not judge. A failure keeps
 * the threats the last load wrote.
 */
export const defaultThreatsSyncHandler: JobHandler<Record<string, unknown>, DefaultThreatsSyncState> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  const services = createServices([...allServiceDefinitions], dbEngine.db)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });

  const settings = await services.defaultThreats.getSettings(ctx.tenantId);
  if (!settings.enabled) {
    logTrace('Default Threats is switched off, nothing to sync', { jobId: ctx.jobId });
    return;
  }
  const url = datasetUrl();

  const stamp = loadStamp();
  const headers: Record<string, string> = {};
  if (settings.loadedAt !== null && settings.appVersion === stamp) {
    if (settings.etag) {
      headers['If-None-Match'] = settings.etag;
    } else if (settings.lastModified) {
      headers['If-Modified-Since'] = settings.lastModified;
    }
  }

  try {
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
    const res = await fetch(url, { headers, signal });
    if (res.status === 304) {
      await ctx.saveStateSnapshot({ fileChanged: false, attackRelease: settings.attackRelease, ignoredTechniqueClaims: null });
      logTrace('Default Threats dataset unchanged', { jobId: ctx.jobId });
      return;
    }
    if (!res.ok) {
      if (res.status !== 429 && res.status >= 400 && res.status < 500) {
        throw new NonRetryableError(`Default Threats dataset error: ${res.status} ${res.statusText}`);
      }
      throw newError(`Default Threats dataset error: ${res.status} ${res.statusText}`);
    }

    // Read outside the parse's try: a body cut short by the timeout or the connection is a retry, not an unreadable file.
    const dataset = parseDatasetBody(await res.text());
    await ctx.updateProgress({ processedTotal: 0, expectedTotal: dataset.threats.length });
    if (ctx.signal.aborted) {
      return;
    }

    const loaded = await services.defaultThreats.loadDataset(dataset, {
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      appVersion: stamp,
    });
    await ctx.updateProgress({ processedTotal: dataset.threats.length });
    await ctx.saveStateSnapshot({
      fileChanged: true,
      attackRelease: dataset.attackRelease,
      ignoredTechniqueClaims: dataset.ignoredTechniqueClaims,
    });
    logTrace('Default Threats dataset loaded', { jobId: ctx.jobId, ...loaded, ignoredTechniqueClaims: dataset.ignoredTechniqueClaims });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw fromError(err, `Default Threats dataset fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    logFromError(err, 'Default Threats sync failed', { jobId: ctx.jobId, attempt: ctx.attempt });
    throw err;
  }
};
