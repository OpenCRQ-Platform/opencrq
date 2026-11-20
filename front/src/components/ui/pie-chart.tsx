import type { FunctionComponent } from 'react';
import type { ChartSegment } from './chart-segment';

interface PieChartProps {
  segments: Array<ChartSegment>,
  total: number,
  /** Tailwind size class (`size-36`), as the bar takes its height: the caller owns the scale. */
  size: string,
  ariaLabel: string,
  ariaDescribedBy?: string,
}

// A CSS `conic-gradient` on a plain `div`: the chart wrapper covers area charts only
// (`buildAreaChartOptions`), so a pie is new work either way, and a gradient needs no new
// dependency and no new design token.
const buildConicGradient = (segments: ReadonlyArray<ChartSegment>, total: number): string => {
  let cursor = 0;
  const stops = segments.map((segment) => {
    const start = cursor;
    cursor += (segment.value / total) * 360;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS gradient stop syntax, not copy
    return `${segment.color} ${start}deg ${cursor}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
};

export const PieChart: FunctionComponent<PieChartProps> = ({ segments, total, size, ariaLabel, ariaDescribedBy }) => {
  const className = `shrink-0 rounded-full border border-border ${size}`;

  // Every share is zero when the total is, and a gradient of empty stops paints a solid disc of
  // the last colour — an empty disc says there is nothing to split, which is what happened.
  if (total === 0) {
    return <div aria-label={ariaLabel} className={`bg-muted ${className}`} role="img" />;
  }

  return (
    <div
      aria-describedby={ariaDescribedBy}
      aria-label={ariaLabel}
      className={className}
      role="img"
      style={{ background: buildConicGradient(segments, total) }}
    />
  );
};
