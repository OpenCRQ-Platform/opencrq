import { createServices, DATA_CHANGED_CHANNEL, jobDependenciesService, jobsService, loadDoorbellParents, tenantsService } from '@app/module';
import { z } from 'zod';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { registerEngine } from '../../engines/engines-manager';
import { jobRuntimeEngine } from '../../engines/job-runtime';
import { createLogger } from '../../utils/logger';
import { startPgListenLoop } from '../../utils/pg-listen-loop';
import { recordRecomputeAsk } from '../../utils/recompute-metrics';
import { createDispatcher } from './dispatcher-core';
import { createFeedingCycleReport } from './feeding-cycle-report';

const logger = createLogger({ engine: 'recompute-dispatcher' });
const { logTrace, logFromError } = logger;

const dispatchedPayloadSchema = z.object({
  tenantId: z.string().nullish(),
  table: z.string(),
  op: z.string(),
  origin: z.string().nullish(),
  interactive: z.boolean().nullish(),
});

// An engine, not a feature `activate`: the dispatcher loads persisted observations from a database
// that is not connected until engines have started. Only the job-running entrypoints (worker and
// monolith) import this module, never the http-only one, so the http process never routes events
// into the job queue.
registerEngine({
  key: 'recompute-dispatcher',
  start: (signal) => {
    if (!config().jobs?.enabled) {
      return {};
    }
    const settings = config().recompute;

    const registrations = jobRuntimeEngine.listRegisteredJobs()
      .filter((registration) => registration.options.observed);
    if (registrations.length === 0) {
      return {};
    }

    const services = createServices([jobsService, jobDependenciesService, tenantsService], dbEngine.db)
      .withOrigin({ type: 'system' });

    const dispatcher = createDispatcher(
      registrations.map((registration) => ({ kind: registration.kind, observed: true })),
      {
        enqueue: async (kind, tenantId, reason, interactive) => {
          const { alreadyExisted } = await services.jobs.enqueueJob({
            kind,
            tenantId,
            payload: {},
            // A data change did ask, whoever made it; whether anybody waits on the answer is the
            // routed change's own, not the routing's: a reconnect names no waiter, and a run woken
            // by a sweep continues that sweep.
            triggeredBy: 'event',
            interactive,
          });
          recordRecomputeAsk('dispatcher', kind, alreadyExisted, reason);
          logTrace('Dispatcher enqueued recompute', { kind, tenantId, reason, alreadyExisted });
        },
        loadObservations: () => services.jobDependencies.getAllObservations(),
        listTenantIds: async () => (await services.tenants.getTenants()).map((tenant) => tenant.id),
        persistObservation: (kind, tenantId, observation) => services.jobDependencies.replaceObservation(kind, tenantId, observation),
        loadDoorbellParents: () => loadDoorbellParents(dbEngine.db),
        onAskAbsorbed: (kind, tenantId, reason) => logTrace('Dispatcher ask absorbed by a run', { kind, tenantId, reason }),
        settings: {
          factor: settings.debounce_factor,
          floorMs: settings.debounce_floor_ms,
          capMs: settings.debounce_cap_ms,
          reconnectMinIntervalMs: settings.reconnect_min_interval_ms,
        },
        onError: (err, context) => logFromError(err, 'Dispatcher error', { context }),
        onFeedingCycle: createFeedingCycleReport(logger),
      },
    );

    // Wired before engines start so no run can complete unobserved by the dispatcher; the
    // DB-dependent boot work stays below, after migrations.
    jobRuntimeEngine.addRunListener({
      onRunStarted: dispatcher.onRunStarted,
      onRunCompleted: dispatcher.onRunCompleted,
    });
    signal.addEventListener('abort', () => dispatcher.stop(), { once: true });

    return {
      onEnginesStarted: async (): Promise<void> => {
        await dispatcher.start();

        startPgListenLoop({
          channel: DATA_CHANGED_CHANNEL,
          signal,
          parse: (payload) => dispatchedPayloadSchema.parse(JSON.parse(payload)),
          onNotify: (event) => dispatcher.handleEvent(event),
          onListening: () => dispatcher.markAllDirty(),
          logger,
        }).catch((err) => logFromError(err, 'data_changed LISTEN listener stopped unexpectedly'));

        logTrace('Recompute dispatcher started', {
          jobs: registrations.map(({ kind }) => kind),
        });
      },
    };
  },
});
