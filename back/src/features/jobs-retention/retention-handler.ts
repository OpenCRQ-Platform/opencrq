import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { config } from '../../config';
import { JOB_RUN_RETENTION_DAYS } from '../../config-schema';
import { dbEngine } from '../../engines/db';
import { createLogger } from '../../utils/logger';

const { logTrace } = createLogger({ feature: 'jobs-retention' });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Clocked, not table-driven: it purges job runs and CRQ runs by age, and the CVEs that left the
 * tenant's scope, so it runs unobserved.
 */
export const jobsRetentionHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }

  const jobsConfig = config().jobs;
  const runRetentionDays = jobsConfig?.run_retention_days ?? JOB_RUN_RETENTION_DAYS;
  const now = Date.now();

  const services = createServices([...allServiceDefinitions], dbEngine.db)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });

  const purged = await services.jobs.purgeExpiredRuns(ctx.tenantId, {
    runOlderThan: new Date(now - runRetentionDays * DAY_MS),
  });

  logTrace('Job runs purged', { tenantId: ctx.tenantId, ...purged });

  if (ctx.signal.aborted) {
    return;
  }
  const crqRuns = await services.crqIndicators.purgeExpiredRuns(new Date(now));
  logTrace('CRQ runs purged', { tenantId: ctx.tenantId, ...crqRuns });

  const cvesPurged = await services.cve.purgeOutOfScope(ctx.signal);
  logTrace('CVEs out of scope purged', { tenantId: ctx.tenantId, cvesPurged });
};
