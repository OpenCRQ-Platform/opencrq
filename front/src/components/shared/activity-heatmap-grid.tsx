import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import {
  buildMonthLabels,
  CELL_SIZE,
  CHART_WIDTH,
  DAY_LABEL_WIDTH,
  DAYS_PER_WEEK,
  LABEL_HEIGHT,
  STEP,
  SVG_HEIGHT,
  toDateKey,
} from './activity-chart-utils';

export interface HeatmapCell {
  date: Date,
  isFuture: boolean,
  fill: string,
  opacity: number,
  tooltip: string,
}

interface ActivityHeatmapGridProps {
  cells: Array<HeatmapCell>,
  legend: ReactNode,
  ariaLabel: string,
}

export const ActivityHeatmapGrid: FunctionComponent<ActivityHeatmapGridProps> = ({
  cells,
  legend,
  ariaLabel,
}): ReactElement => {
  const monthLabels = buildMonthLabels(cells);

  const dayLabels: Array<{ index: number, label: string }> = [
    { index: 0, label: t`Mon` },
    { index: 2, label: t`Wed` },
    { index: 4, label: t`Fri` },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div style={{ maxWidth: CHART_WIDTH, overflowX: 'auto' }}>
        <div style={{ width: CHART_WIDTH }}>
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${SVG_HEIGHT}`}
            style={{ width: CHART_WIDTH, height: SVG_HEIGHT, display: 'block' }}
            role="img"
            aria-label={ariaLabel}
          >
            {monthLabels.map(({ week, label }) => (
              <text
                key={`${week}-${label}`}
                x={DAY_LABEL_WIDTH + week * STEP}
                y={LABEL_HEIGHT - 2}
                style={{ fontSize: 9, fill: 'var(--color-muted-foreground)' }}
              >
                {label}
              </text>
            ))}

            {dayLabels.map(({ index, label }) => (
              <text
                key={label}
                x={0}
                y={LABEL_HEIGHT + index * STEP + CELL_SIZE - 1}
                style={{ fontSize: 9, fill: 'var(--color-muted-foreground)' }}
              >
                {label}
              </text>
            ))}

            {cells.map((cell, i) => {
              const week = Math.floor(i / DAYS_PER_WEEK);
              const day = i % DAYS_PER_WEEK;
              return (
                <rect
                  key={toDateKey(cell.date)}
                  x={DAY_LABEL_WIDTH + week * STEP}
                  y={LABEL_HEIGHT + day * STEP}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  rx={2}
                  style={{
                    fill: cell.isFuture ? 'transparent' : cell.fill,
                    opacity: cell.isFuture ? 0 : cell.opacity,
                  }}
                >
                  {!cell.isFuture && (
                    <title>{`${toDateKey(cell.date)}: ${cell.tooltip}`}</title>
                  )}
                </rect>
              );
            })}
          </svg>

          <div className="flex justify-end items-center gap-1.5" style={{ paddingTop: 4 }}>
            {legend}
          </div>
        </div>
      </div>
    </div>
  );
};
