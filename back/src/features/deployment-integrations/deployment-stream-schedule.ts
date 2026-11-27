import type { EnqueueJobOptions, EnqueueJobResult, RunSummary } from '@app/module';
import type { DeploymentConnection, OpenctiBindingSettings } from './deployment-integrations';
import { retryDue } from '../job-scheduler/connector-schedule';
import { OPENCTI_DEPLOYMENT_STREAM_JOB, openctiBindingKind, openctiDeploymentStreamKey } from './deployment-integrations';

/** How long a tenant not connected waits after a provisioning run before the next one. */
export const DEPLOYMENT_STREAM_RETRY_MS = 5 * 60 * 1000;

/**
 * Whether the tenant still owes a provisioning: nothing is bound (OpenCTI was down, or the token
 * lacked a right), or the binding is the deployment's own and its stream no longer authenticates,
 * which is how OpenCTI answers for a stream deleted there. A binding an admin made is never retried.
 */
export const needsDeploymentStream = (settings: OpenctiBindingSettings | null | undefined): boolean => {
  const binding = openctiBindingKind(settings);
  return binding === 'none' || (binding === 'deployment' && settings?.authFailedAt !== null);
};

export interface DeploymentStreamScheduleDeps {
  connection: (tenantId: string) => DeploymentConnection | undefined,
  getSettings: (tenantId: string) => Promise<OpenctiBindingSettings | null | undefined>,
  jobs: {
    getRunSummariesByKind: (tenantId: string, kinds: ReadonlyArray<string>) => Promise<Array<RunSummary>>,
    enqueueJob: (options: EnqueueJobOptions) => Promise<EnqueueJobResult>,
  },
  now: () => number,
}

export type DeploymentStreamScheduleReport = { outcome: 'skipped' | 'skipped_active' | 'enqueued' };

/** Asks for the tenant's provisioning again while it is not connected, at most once per retry period. */
export const runDeploymentStreamSchedule = async (
  tenantId: string,
  deps: DeploymentStreamScheduleDeps,
): Promise<DeploymentStreamScheduleReport> => {
  if (!deps.connection(tenantId) || !needsDeploymentStream(await deps.getSettings(tenantId))) {
    return { outcome: 'skipped' };
  }
  const [summary] = await deps.jobs.getRunSummariesByKind(tenantId, [OPENCTI_DEPLOYMENT_STREAM_JOB]);
  if (!retryDue(summary, deps.now(), DEPLOYMENT_STREAM_RETRY_MS)) {
    return { outcome: 'skipped' };
  }
  const enqueued = await deps.jobs.enqueueJob({
    kind: OPENCTI_DEPLOYMENT_STREAM_JOB,
    tenantId,
    payload: {},
    idempotencyKey: openctiDeploymentStreamKey(tenantId),
    triggeredBy: 'scheduler',
    interactive: false,
    skipIfActive: true,
    maxAttempts: 1,
  });
  return { outcome: enqueued.alreadyExisted ? 'skipped_active' : 'enqueued' };
};
