import type { FunctionComponent, ReactElement } from 'react';
import { t } from '@lingui/core/macro';
import type { HeatmapCell } from './activity-heatmap-grid';
import { addDays, buildChartDateRange, CELL_SIZE, DAYS_PER_WEEK, GAP, STEP, toDateKey, WEEKS } from './activity-chart-utils';
import { ActivityHeatmapGrid } from './activity-heatmap-grid';

// Red heat-color scale: light red → dark red based on intensity ratio
const getHeatColor = (count: number, maxCount: number): string => {
  if (count === 0) {
    return 'var(--color-muted-foreground)';
  }
  const ratio = count / maxCount;
  const lightness = Math.round(78 - ratio * 43); // 78% (light red) → 35% (dark red)
  // eslint-disable-next-line lingui/no-unlocalized-strings
  return `hsl(0, 70%, ${lightness}%)`;
};

const getHeatOpacity = (count: number): number => (count === 0 ? 0.18 : 1);

const LEGEND_LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;

interface EvidenceCountActivityChartProps {
  /** The count of each day by its `toDateKey`; a day missing from it counts zero. */
  countsByDay: ReadonlyMap<string, number>,
  getTooltip: (count: number) => string,
  ariaLabel: string,
}

export const EvidenceCountActivityChart: FunctionComponent<EvidenceCountActivityChartProps> = ({
  countsByDay,
  getTooltip,
  ariaLabel,
}): ReactElement => {
  const { today, startDay } = buildChartDateRange();

  const countCells = Array.from({ length: WEEKS * DAYS_PER_WEEK }, (_, i) => {
    const date = addDays(startDay, i);
    const isFuture = date > today;
    return { date, isFuture, count: isFuture ? 0 : countsByDay.get(toDateKey(date)) ?? 0 };
  });

  const maxCount = Math.max(1, ...countCells.map((c) => c.count));

  const cells: Array<HeatmapCell> = countCells.map((cell) => ({
    date: cell.date,
    isFuture: cell.isFuture,
    fill: getHeatColor(cell.count, maxCount),
    opacity: getHeatOpacity(cell.count),
    tooltip: getTooltip(cell.count),
  }));

  const legend = (
    <>
      <span className="txt-sub-content text-muted-foreground">{t`Less`}</span>
      <svg
        viewBox={`0 0 ${LEGEND_LEVELS.length * STEP - GAP} ${CELL_SIZE}`}
        style={{ width: LEGEND_LEVELS.length * STEP - GAP, height: CELL_SIZE }}
      >
        {LEGEND_LEVELS.map((level, i) => (
          <rect
            key={i}
            x={i * STEP}
            y={0}
            width={CELL_SIZE}
            height={CELL_SIZE}
            rx={2}
            style={{
              fill: getHeatColor(level, 1),
              opacity: getHeatOpacity(level),
            }}
          />
        ))}
      </svg>
      <span className="txt-sub-content text-muted-foreground">{t`More`}</span>
    </>
  );

  return (
    <ActivityHeatmapGrid
      cells={cells}
      legend={legend}
      ariaLabel={ariaLabel}
    />
  );
};
