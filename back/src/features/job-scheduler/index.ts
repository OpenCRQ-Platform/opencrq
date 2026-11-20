import { createServices, defaultThreatsService, integrationSettingsService, jobSchedulesService, jobsService, tenantsService } from '@app/module';
import type { ConnectorScheduleDeps } from './connector-schedule';
import type { DailyScheduleDeps } from './daily-schedule';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { registerEngine } from '../../engines/engines-manager';
import { jobRuntimeEngine } from '../../engines/job-runtime';
import { createLogger } from '../../utils/logger';
import { recordRecomputeAsk } from '../../utils/recompute-metrics';
import { defaultThreatsRunState, resolveRunnableConnectors } from '../app-router/connectors/connector-configuration';
import { runDueConnectorSchedules } from './connector-schedule';
import { minutesOfDay, runDailySchedules } from './daily-schedule';

const logger = createLogger({ engine: 'job-scheduler' });
const { logTrace, logFromError } = logger;

/** Bounds how late an occurrence starts, so it has to stay well under the tightest cadence, an hour. */
const TICK_INTERVAL_MS = 60 * 1000;

// Only the job-running entrypoints (worker and monolith) import this module, so the http process
// never enqueues a scheduled run.
registerEngine({
  key: 'job-scheduler',
  start: (signal) => {
    if (!config().jobs?.enabled) {
      return {};
    }
    const services = createServices(
      [defaultThreatsService, integrationSettingsService, jobSchedulesService, jobsService, tenantsService],
      dbEngine.db,
    ).withOrigin({ type: 'system' });

    const connectorDeps: ConnectorScheduleDeps = {
      listConnectors: async (tenantId) => {
        const [settings, defaultThreats] = await Promise.all([
          services.integrationSettings.getTenantIntegrationSettings(tenantId),
          services.defaultThreats.getSettings(tenantId),
        ]);
        return resolveRunnableConnectors(config().connectors, tenantId, settings, defaultThreatsRunState(defaultThreats));
      },
      schedules: services.jobSchedules,
      jobs: services.jobs,
      now: Date.now,
    };
    const dailyDeps: DailyScheduleDeps = {
      kinds: jobRuntimeEngine.listRegisteredJobs().filter(({ options }) => options.daily).map(({ kind }) => kind),
      atMinutes: minutesOfDay(config().recompute.daily_at),
      schedules: services.jobSchedules,
      jobs: services.jobs,
      now: Date.now,
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

    const tick = async (): Promise<void> => {
      const tenantIds = (await services.tenants.getTenants()).map((tenant) => tenant.id);
      for (const tenantId of tenantIds) {
        // Per tenant and per schedule, so one that fails does not cost the others theirs.
        for (const [serve, message] of [
          [serveConnectors, 'Scheduled connector tick failed'],
          [serveDailyKinds, 'Daily schedule tick failed'],
        ] as const) {
          try {
            await serve(tenantId);
          } catch (err) {
            logFromError(err, message, { tenantId });
          }
        }
      }
    };

    return {
      onEnginesStarted: () => {
        if (signal.aborted) {
          return;
        }
        let ticking = false;
        const timer = setInterval(() => {
          // A tick walks every tenant in turn, so one that outlives its period would otherwise have
          // a second walk piled on top of it.
          if (ticking) {
            return;
          }
          ticking = true;
          void tick()
            .catch((err) => logFromError(err, 'Scheduler tick failed'))
            .finally(() => {
              ticking = false;
            });
        }, TICK_INTERVAL_MS);
        signal.addEventListener('abort', () => clearInterval(timer), { once: true });
        logTrace('Job scheduler started', {
          tickIntervalMs: TICK_INTERVAL_MS,
          dailyKinds: dailyDeps.kinds,
          dailyAt: config().recompute.daily_at,
        });
      },
    };
  },
});
