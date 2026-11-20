import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import type { DismissalType, EvidenceHistoryOrigin } from '@app/module/client';
import type { HeatmapCell } from '../../../components/shared/activity-heatmap-grid';
import type { FlawKind } from '../../finding-detail/dismissal-vocabulary';
import { addDays, buildChartDateRange, CELL_SIZE, DAYS_PER_WEEK, toDateKey, WEEKS } from '../../../components/shared/activity-chart-utils';
import { ActivityHeatmapGrid } from '../../../components/shared/activity-heatmap-grid';
import { dismissedStateFilterLabel, dismissedStateLabel } from '../../finding-detail/dismissal-vocabulary';

const APPLICABLE_COLOR = 'var(--fds-color-feedback-error-primary)';
/**
 * A finding someone set aside is never painted green: it is a decision on record, not a good
 * outcome, so it takes the neutral weight and the reader reads intervention, not resolution.
 */
const DISMISSED_COLOR = 'var(--fds-color-feedback-neutral-primary)';
const NO_DATA_COLOR = 'var(--fds-color-feedback-neutral-secondary-transparency-30)';

const getCellFill = (state: string | null): string => {
  if (state === 'applicable') {
    return APPLICABLE_COLOR;
  }
  if (state === 'dismissed') {
    return DISMISSED_COLOR;
  }
  return NO_DATA_COLOR;
};

export interface ActivityHistoryEntry {
  state: string,
  stateChangedAt: Date | string,
  origin?: EvidenceHistoryOrigin,
  dismissalType?: DismissalType | null,
}

interface FindingActivityChartProps {
  history: Array<ActivityHistoryEntry>,
  /** Names the causes the dismissed colour stands for in the legend. */
  kind: FlawKind,
}

export const FindingActivityChart: FunctionComponent<FindingActivityChartProps> = ({
  history,
  kind,
}): ReactElement => {
  const { today, startDay } = buildChartDateRange();

  const cells: Array<HeatmapCell> = [];
  let cursor = 0;
  let current: ActivityHistoryEntry | null = null;

  for (let i = 0; i < WEEKS * DAYS_PER_WEEK; i++) {
    const date = addDays(startDay, i);
    const isFuture = date > today;
    const dateKey = toDateKey(date);
    if (!isFuture) {
      while (cursor < history.length && toDateKey(new Date(history[cursor].stateChangedAt)) <= dateKey) {
        current = history[cursor];
        cursor++;
      }
    }
    const entry = isFuture ? null : current;
    const state = entry?.state ?? null;
    const tooltip = state === 'applicable'
      ? t`Applicable`
      : state === 'dismissed'
        ? dismissedStateLabel({ kind, origin: entry?.origin, dismissalType: entry?.dismissalType })
        : t`No data`;
    cells.push({ date, isFuture, fill: getCellFill(state), opacity: 1, tooltip });
  }

  // Legacy `txt-*` typography: the chart is also rendered by two @filigran/ui surfaces, and the
  // migration moves a surface whole rather than one shared component ahead of its callers.
  const legend = (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <svg viewBox={`0 0 ${CELL_SIZE} ${CELL_SIZE}`} style={{ width: CELL_SIZE, height: CELL_SIZE }}>
          <rect x={0} y={0} width={CELL_SIZE} height={CELL_SIZE} rx={2} style={{ fill: APPLICABLE_COLOR }} />
        </svg>
        <span className="txt-sub-content text-muted-foreground">{t`Applicable`}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <svg viewBox={`0 0 ${CELL_SIZE} ${CELL_SIZE}`} style={{ width: CELL_SIZE, height: CELL_SIZE }}>
          <rect x={0} y={0} width={CELL_SIZE} height={CELL_SIZE} rx={2} style={{ fill: DISMISSED_COLOR }} />
        </svg>
        <span className="txt-sub-content text-muted-foreground">{dismissedStateFilterLabel(kind)}</span>
      </div>
    </div>
  );

  return (
    <ActivityHeatmapGrid
      cells={cells}
      legend={legend}
      ariaLabel={t`Finding state heatmap`}
    />
  );
};
