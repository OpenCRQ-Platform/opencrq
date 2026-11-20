import { t } from '@lingui/core/macro';
import type { ConnectorListEntry } from './connector-list-utils';
import { EMPTY_VALUE, formatCompactCount, formatRelativeTime } from '../../utils';

type RunFigureEntry = Pick<ConnectorListEntry, 'enabled' | 'activeRun' | 'lastRun'>;

/**
 * What the connector's own run counted, in the unit that run reports in. Never a count of rows in the
 * database: that is a different figure, and the two do not agree. A connector switched off reports
 * nothing: its last run describes threats the switch has since removed.
 */
export const objectsRead = (entry: RunFigureEntry): string => {
  const run = entry.enabled ? entry.activeRun ?? entry.lastRun : null;
  if (run === null) {
    return EMPTY_VALUE;
  }
  const processed = formatCompactCount(run.processedTotal);
  return run.expectedTotal === null ? processed : `${processed} / ${formatCompactCount(run.expectedTotal)}`;
};

export const lastRunRead = (entry: RunFigureEntry): string => {
  if (!entry.enabled) {
    return EMPTY_VALUE;
  }
  if (entry.activeRun !== null) {
    return t`Running`;
  }
  if (entry.lastRun?.finishedAt == null) {
    return t`Never`;
  }
  return formatRelativeTime(entry.lastRun.finishedAt);
};
