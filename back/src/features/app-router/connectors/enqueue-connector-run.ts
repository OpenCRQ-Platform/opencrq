import type { ConnectorSource, EnqueueJobOptions, JobBackedConnectorEntry } from '@app/module';
import { config } from '../../../config';
import { defaultThreatsRunState, resolveRunnableConnectors } from './connector-configuration';

interface ConnectorRunServices {
  integrationSettings: { getTenantIntegrationSettings: (tenantId: string) => Promise<Parameters<typeof resolveRunnableConnectors>[2]> },
  defaultThreats: { getSettings: (tenantId: string) => Promise<Parameters<typeof defaultThreatsRunState>[0]> },
  jobs: { enqueueJob: (options: EnqueueJobOptions) => Promise<{ jobId: string }> },
}

/** Who asked for the runs, whether anybody waits on them, and when they may start. */
export type ConnectorRunBooking = Pick<EnqueueJobOptions, 'triggeredBy' | 'triggeredById' | 'interactive' | 'runAfter'>;

/**
 * Enqueues a run of each of `sources` the tenant can run, under the rule Sync now applies. A source
 * the tenant has not configured is left out of the answer.
 *
 * @returns the run booked for each source that could run
 */
export const enqueueConnectorRuns = async (
  services: ConnectorRunServices,
  tenantId: string,
  sources: ReadonlyArray<ConnectorSource>,
  booking: ConnectorRunBooking,
): Promise<Array<{ entry: JobBackedConnectorEntry, jobId: string }>> => {
  const [settings, defaultThreats] = await Promise.all([
    services.integrationSettings.getTenantIntegrationSettings(tenantId),
    services.defaultThreats.getSettings(tenantId),
  ]);
  const runnable = resolveRunnableConnectors(config().connectors, tenantId, settings, defaultThreatsRunState(defaultThreats))
    .filter((connector) => sources.includes(connector.entry.source));
  const minuteSlot = new Date().toISOString().slice(0, 16);
  const booked: Array<{ entry: JobBackedConnectorEntry, jobId: string }> = [];
  for (const { entry, payload } of runnable) {
    if (payload === null) {
      continue;
    }
    const { jobId } = await services.jobs.enqueueJob({
      kind: entry.jobKind,
      tenantId,
      payload,
      idempotencyKey: `${tenantId}:${entry.idempotencyPrefix}-${minuteSlot}`,
      ...booking,
      maxRuntimeMs: entry.maxRuntimeMs,
      maxAttempts: entry.maxAttempts,
    });
    booked.push({ entry, jobId });
  }
  return booked;
};
