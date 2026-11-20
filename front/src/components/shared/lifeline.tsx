import type { FunctionComponent } from 'react';
import { useId } from 'react';
import type { LifelineRise, LifelineShape } from './lifeline-utils';
import { cn } from '../../utils';
import { buildLifelineGeometry, LIFELINE_TONE_CLASS, LIFELINE_VIEWBOX_HEIGHT, LIFELINE_VIEWBOX_WIDTH } from './lifeline-utils';

interface LifelineProps extends LifelineShape {
  values: ReadonlyArray<number | null>,
  rise: LifelineRise,
  ariaLabel: string,
  className?: string,
  /** False leaves the latest value unmarked. */
  endMarker?: boolean,
  /** False draws the line alone: no area, no start reference. */
  filled?: boolean,
  /** Replaces the direction tone. */
  toneClassName?: string,
}

/**
 * A numeric series as a sparkline: the line filled down to the floor, the level it started from as
 * a reference line, and a marker on its latest value.
 *
 * The box is a fixed 100x100 stretched to the caller's width, so every stroke carries
 * `vector-effect: non-scaling-stroke` to stay one width, and the end marker is HTML rather than a
 * circle, which the same stretch would flatten into an ellipse.
 */
export const Lifeline: FunctionComponent<LifelineProps> = ({
  values,
  rise,
  ariaLabel,
  className,
  xs,
  curve,
  domain,
  endMarker,
  filled,
  toneClassName,
}) => {
  const gradientId = useId();
  const geometry = buildLifelineGeometry(values, { xs, curve, domain });

  if (geometry === null) {
    return null;
  }

  const { linePath, areaPath, endX, endY, startY, direction } = geometry;

  return (
    <div className={cn('pointer-events-none relative h-12 w-full', toneClassName ?? LIFELINE_TONE_CLASS[rise][direction], className)}>
      <svg
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${LIFELINE_VIEWBOX_WIDTH} ${LIFELINE_VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        {filled !== false && areaPath !== null && <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />}
        {filled !== false && (
          <line
            x1="0"
            x2={LIFELINE_VIEWBOX_WIDTH}
            y1={startY * LIFELINE_VIEWBOX_HEIGHT}
            y2={startY * LIFELINE_VIEWBOX_HEIGHT}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {linePath !== '' && (
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {endMarker !== false && endX !== null && endY !== null && (
        <span
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-background"
          style={{ left: `${endX * 100}%`, top: `${endY * 100}%` }}
        />
      )}
    </div>
  );
};
