import type { DrizzleDB } from '@app/module';
import { createServices, defaultThreatsService, integrationSettingsService, jobSchedulesService, jobsService, openctiConnectorService, tenantsService } from '@app/module';
import type { ConnectorScheduleDeps } from './connector-schedule';
import type { DeploymentStreamScheduleDeps } from '../deployment-integrations/deployment-stream-schedule';
import type { DailyScheduleDeps } from './daily-schedule';
import type { config } from '../../config';
import { createLogger } from '../../utils/logger';
import { recordRecomputeAsk } from '../../utils/recompute-metrics';
import { defaultThreatsRunState, resolveRunnableConnectors } from '../app-router/connectors/connector-configuration';
import { runDeploymentStreamSchedule } from '../deployment-integrations/deployment-stream-schedule';
import { runDueConnectorSchedules } from './connector-schedule';
import { runDailySchedules } from './daily-schedule';

const logger = createLogger({ engine: 'job-scheduler' });
const { logTrace, logFromError } = logger;

export const schedulerServices = (db: DrizzleDB) => createServices(
  [defaultThreatsService, integrationSettingsService, jobSchedulesService, jobsService, openctiConnectorService, tenantsService],
  db,
).withOrigin({ type: 'system' });

export interface SchedulerTickDeps {
  services: ReturnType<typeof schedulerServices>,
  connectors: ReturnType<typeof config>['connectors'],
  /** The job kinds registered as daily. */
  dailyKinds: Array<string>,
  /** The minute of the day the daily kinds run at. */
  dailyAtMinutes: number,
  now: () => number,
}

/** One walk of every tenant: its connector occurrences, its daily recomputes, its deployment OpenCTI stream. */
export const createSchedulerTick = ({ services, connectors, dailyKinds, dailyAtMinutes, now }: SchedulerTickDeps) => {
  const connectorDeps: ConnectorScheduleDeps = {
    listConnectors: async (tenantId) => {
      const [settings, defaultThreats] = await Promise.all([
        services.integrationSettings.getTenantIntegrationSettings(tenantId),
        services.defaultThreats.getSettings(tenantId),
      ]);
      return resolveRunnableConnectors(connectors, tenantId, settings, defaultThreatsRunState(defaultThreats));
    },
    schedules: services.jobSchedules,
    jobs: services.jobs,
    now,
  };
  const dailyDeps: DailyScheduleDeps = {
    kinds: dailyKinds,
    atMinutes: dailyAtMinutes,
    schedules: services.jobSchedules,
    jobs: services.jobs,
    now,
  };
  const deploymentStreamDeps: DeploymentStreamScheduleDeps = {
    connection: (tenantId) => connectors?.opencti?.[tenantId],
    getSettings: (tenantId) => services.openctiConnector.getSettings(tenantId),
    jobs: services.jobs,
    now,
  };

  const serveConnectors = async (tenantId: string): Promise<void> => {
    const reports = await runDueConnectorSchedules(tenantId, connectorDeps);
    for (const report of reports) {
      if (report.outcome === 'failed') {
        logFromError(report.error, 'Scheduled connector tick failed', { tenantId, kind: report.kind });
        continue;
      }
      logTrace('Scheduled connector occurrence', { tenantId, ...report, occurrence: report.occurrence.toISOString() });
    }
  };

  const serveDeploymentStream = async (tenantId: string): Promise<void> => {
    const report = await runDeploymentStreamSchedule(tenantId, deploymentStreamDeps);
    if (report.outcome !== 'skipped') {
      logTrace('Deployment OpenCTI stream occurrence', { tenantId, ...report });
    }
  };

  const serveDailyKinds = async (tenantId: string): Promise<void> => {
    const reports = await runDailySchedules(tenantId, dailyDeps);
    for (const report of reports) {
      if (report.outcome === 'failed') {
        logFromError(report.error, 'Daily schedule tick failed', { tenantId, kind: report.kind });
        continue;
      }
      if (report.outcome === 'enqueued') {
        recordRecomputeAsk('dispatcher', report.kind, report.alreadyExisted ?? false, 'daily');
      }
      if (report.outcome === 'exhausted') {
        // Reported once a day at most: the row then waits for the next occurrence.
        logger.logError('Daily recompute gave up for the day after repeated failures', { kind: report.kind, tenantId });
      }
      logTrace('Daily schedule occurrence', { tenantId, ...report, nextRunAt: report.nextRunAt.toISOString() });
    }
  };

  return async (): Promise<void> => {
    const tenantIds = (await services.tenants.getTenants()).map((tenant) => tenant.id);
    for (const tenantId of tenantIds) {
      // Per tenant and per schedule, so one that fails does not cost the others theirs.
      for (const [serve, message] of [
        [serveConnectors, 'Scheduled connector tick failed'],
        [serveDailyKinds, 'Daily schedule tick failed'],
        [serveDeploymentStream, 'Deployment OpenCTI stream tick failed'],
      ] as const) {
        try {
          await serve(tenantId);
        } catch (err) {
          logFromError(err, message, { tenantId });
        }
      }
    }
  };
};
