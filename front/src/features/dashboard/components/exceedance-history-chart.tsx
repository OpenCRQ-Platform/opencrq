import type { FunctionComponent } from 'react';
import type { ExceedanceHistory } from '../exceedance-history-utils';
import { formatProbability } from '../../risk-tolerance/risk-tolerance-utils';
import { probabilityRangeAxis } from '../loss-exceedance-utils';

const HEIGHT = 160;
const VIEWBOX_WIDTH = 100;
const LINE_COLOR = 'var(--fds-color-filigran-brand-primary)';
const OUTSIDE_COLOR = 'var(--fds-color-feedback-error-primary)';
const WITHIN_COLOR = 'var(--fds-color-feedback-success-primary)';

interface ExceedanceHistoryChartProps {
  history: ExceedanceHistory,
  maxExceedanceProbability: number,
  outside: boolean,
  ariaLabel: string,
  axis: { start: string, end: string },
}

/**
 * The plot is a 100-wide box stretched to the panel's width, so strokes carry `non-scaling-stroke`
 * and the labels and the end marker are HTML, which the stretch would otherwise distort.
 */
export const ExceedanceHistoryChart: FunctionComponent<ExceedanceHistoryChartProps> = ({ history, maxExceedanceProbability, outside, ariaLabel, axis }) => {
  const probabilities = history.points.map((point) => point.probability);
  const { from: yMin, to: yMax, ticks: yTicks } = probabilityRangeAxis(
    Math.min(maxExceedanceProbability, ...probabilities),
    Math.max(maxExceedanceProbability, ...probabilities),
    4,
  );
  const x = (share: number): number => share * VIEWBOX_WIDTH;
  const y = (probability: number): number => (1 - (probability - yMin) / (yMax - yMin)) * HEIGHT;
  const toPoints = (points: ReadonlyArray<{ x: number, probability: number }>): string =>
    points.map((point) => `${x(point.x)},${y(point.probability)}`).join(' ');
  const gapPoints = (stretch: ReadonlyArray<{ x: number, probability: number }>): string =>
    `${toPoints(stretch)} ${x(stretch[stretch.length - 1].x)},${y(maxExceedanceProbability)} ${x(stretch[0].x)},${y(maxExceedanceProbability)}`;
  const latest = history.points.at(-1);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div className="relative w-10 shrink-0 font-content-caption text-content-caption tabular-nums" style={{ height: HEIGHT }}>
          {yTicks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2 text-default-secondary" style={{ top: y(tick) }}>
              {formatProbability(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 grow" style={{ height: HEIGHT }}>
          <svg
            className="h-full w-full overflow-visible"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={ariaLabel}
          >
            <g className="text-default-secondary" stroke="currentColor" strokeOpacity={0.2}>
              {yTicks.map((tick) => <line key={tick} x1={0} x2={VIEWBOX_WIDTH} y1={y(tick)} y2={y(tick)} vectorEffect="non-scaling-stroke" />)}
            </g>
            {history.aboveStretches.map((stretch) => (
              <polygon key={stretch[0].x} points={gapPoints(stretch)} fill={OUTSIDE_COLOR} fillOpacity={0.15} />
            ))}
            <line
              x1={0}
              x2={VIEWBOX_WIDTH}
              y1={y(maxExceedanceProbability)}
              y2={y(maxExceedanceProbability)}
              stroke={OUTSIDE_COLOR}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={toPoints(history.points)}
              fill="none"
              stroke={LINE_COLOR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {history.aboveStretches.map((stretch) => (
              <polyline
                key={stretch[0].x}
                points={toPoints(stretch)}
                fill="none"
                stroke={OUTSIDE_COLOR}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {latest !== undefined && (
            <span
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
              style={{ left: `${latest.x * 100}%`, top: y(latest.probability), background: outside ? OUTSIDE_COLOR : WITHIN_COLOR }}
            />
          )}
        </div>
      </div>
      <div className="flex justify-between pl-12 font-content-compact text-content-compact text-default-secondary">
        <span>{axis.start}</span>
        <span>{axis.end}</span>
      </div>
    </div>
  );
};
