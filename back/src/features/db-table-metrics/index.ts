import type { DatabaseStatistics } from '../../engines/db';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { registerEngine } from '../../engines/engines-manager';
import { createLogger } from '../../utils/logger';

const { logTrace, logFromError } = createLogger({ engine: 'db-table-metrics' });

// Only the worker and monolith entrypoints import this module: the statistics are the database's,
// the same from every process, so one process per container reads them.
registerEngine({
  key: 'db-table-metrics',
  start: (signal) => {
    const tableStatistics = config().telemetry?.observability.table_statistics;
    if (!tableStatistics?.enabled) {
      return {};
    }
    const intervalMs = tableStatistics.interval_ms;

    let lastReading: DatabaseStatistics | null = null;
    dbEngine.registerTableMetrics(() => lastReading);

    let reading: Promise<void> | null = null;
    const read = (): void => {
      // A reading slower than the interval would otherwise have a second one piled on top of it.
      if (reading || signal.aborted) {
        return;
      }
      reading = dbEngine.readTableStatistics()
        .then((statistics) => {
          lastReading = statistics;
        }, (err: unknown) => {
          logFromError(err, 'Reading the database table statistics failed');
        })
        .finally(() => {
          reading = null;
        });
    };

    let timer: NodeJS.Timeout | undefined;
    return {
      // Not on start: the engines start together, and the first reading must find the migrated schema.
      onEnginesStarted: () => {
        if (signal.aborted) {
          return;
        }
        read();
        timer = setInterval(read, intervalMs);
        logTrace('Database table statistics reader started', { intervalMs });
      },
      // Before the database engine ends its pool, which a reading in flight still holds a client of.
      onEnginesStopping: async () => {
        clearInterval(timer);
        await reading;
      },
    };
  },
});
