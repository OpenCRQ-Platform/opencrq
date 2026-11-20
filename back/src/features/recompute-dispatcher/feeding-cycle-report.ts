import type { Logger } from '../../utils/logger';
import { recordFeedingCycle } from '../../utils/recompute-metrics';

/** What the dispatcher does with a cycle it finds, named so it can run outside the engine's start-up. */
export const createFeedingCycleReport = (logger: Logger) => (cycle: Array<string>): void => {
  recordFeedingCycle(cycle);
  logger.logWarn('Recompute jobs feed each other: their reads and writes form a cycle', { cycle: cycle.join(' -> ') });
};
