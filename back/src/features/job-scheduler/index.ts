import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { registerEngine } from '../../engines/engines-manager';
import { jobRuntimeEngine } from '../../engines/job-runtime';
import { createLogger } from '../../utils/logger';
import { minutesOfDay } from './daily-schedule';
import { createSchedulerTick, schedulerServices } from './scheduler-tick';

const { logTrace, logFromError } = createLogger({ engine: 'job-scheduler' });

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
    const dailyKinds = jobRuntimeEngine.listRegisteredJobs().filter(({ options }) => options.daily).map(({ kind }) => kind);
    const tick = createSchedulerTick({
      services: schedulerServices(dbEngine.db),
      connectors: config().connectors,
      dailyKinds,
      dailyAtMinutes: minutesOfDay(config().recompute.daily_at),
      now: Date.now,
    });

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
          dailyKinds,
          dailyAt: config().recompute.daily_at,
        });
      },
    };
  },
});
