import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { Lifeline, LIFELINE_VIEWBOX_HEIGHT, LIFELINE_VIEWBOX_WIDTH } from '../../../../components/shared';
import { formatDollar } from '../../../../utils';
import { placeLifelineByTime } from '../../scenario-lifeline-utils';

export interface ScenarioLifelineSample {
  at: string,
  aleMean: number,
  aleP10: number | null,
  aleP90: number | null,
}

interface ScenarioLifelineProps {
  points: Array<ScenarioLifelineSample>,
}

const sparklineLabel = (oldest: string, latest: string): string =>
  t`Annual loss exposure over time, ${oldest} at the oldest simulation and ${latest} at the latest`;

/**
 * The track a scenario with no history draws instead of a series: it wanders the way a real one
 * does, over the same floor, and ends in a hollow marker, so the box reads as a lifeline that has
 * not started rather than one flat at zero. Dashed and toneless, since nothing on it is a
 * measurement.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- SVG path data, not copy
const WAITING_TRACK_PATH = 'M0,70 L14,54 L28,66 L42,44 L56,58 L70,36 L86,50 L100,32';
const WAITING_TRACK_END_Y = 0.32;
const WAITING_FLOOR_Y = 88;

/** A scenario's exposure history as a sparkline of its means, or a waiting track before its first run. */
export const ScenarioLifeline: FunctionComponent<ScenarioLifelineProps> = ({ points }) => {
  const [now] = useState(() => new Date());
  if (points.length === 0) {
    return (
      <div
        className="pointer-events-none relative h-12 w-full text-muted-foreground/60"
        role="img"
        aria-label={t`No quantified simulation history`}
      >
        <svg
          className="h-full w-full overflow-visible"
          viewBox={`0 0 ${LIFELINE_VIEWBOX_WIDTH} ${LIFELINE_VIEWBOX_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            x1="0"
            x2={LIFELINE_VIEWBOX_WIDTH}
            y1={WAITING_FLOOR_Y}
            y2={WAITING_FLOOR_Y}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={WAITING_TRACK_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-current"
          style={{ left: '100%', top: `${WAITING_TRACK_END_Y * 100}%` }}
        />
      </div>
    );
  }

  const oldest = points[0];
  const latest = points[points.length - 1];

  // Scaled on the means only: the p10 to p90 band is wide enough (p10 routinely sits near zero)
  // that scaling to it flattens every run-to-run move into a straight line, which is the one thing
  // this graph exists to show. The band is carried by the figures printed beside the graph.
  return (
    <Lifeline
      values={points.map((point) => point.aleMean)}
      xs={placeLifelineByTime(points.map((point) => point.at), now)}
      rise="bad"
      ariaLabel={sparklineLabel(formatDollar(oldest.aleMean), formatDollar(latest.aleMean))}
    />
  );
};
