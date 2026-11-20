import { t } from '@lingui/core/macro';
import { pricedFraction } from '@app/module/client';
import { roundToDecimals, toPercentPoints } from '@app/utils/decimals';
import type { CrqRun } from '../crq-run-cards';
import { computePert, formatFixed, formatPointsAsPercent } from '../../../../utils';

export type DecompositionRun = Pick<CrqRun,
  | 'id'
  | 'createdAt'
  | 'aleMean' | 'aleP10' | 'aleP90'
  | 'tefMin' | 'tefLikely' | 'tefMax'
  | 'outcomeEvicted' | 'outcomeImpactDetected' | 'outcomeImpactUndetected'
  | 'magnitudeMean'
>;

export interface RunTimeline {
  /** The scenario's latest two runs, newest first. */
  latest: ReadonlyArray<DecompositionRun>,
  /** Its quantified runs as of evenly spread dates, oldest first, the first being the period's first quantified run. */
  points: ReadonlyArray<DecompositionRun>,
  until: string | Date,
}

export interface TimeAxis {
  start: Date,
  end: Date,
}

export interface SeriesPoint {
  at: Date,
  value: number,
  /** From 0 to 1 across the axis. */
  x: number,
}

export interface FactorReading {
  value: number | null,
  change: number | null,
  series: Array<SeriesPoint>,
}

export interface AleDecomposition {
  loss: FactorReading & { p10: number | null, p90: number | null, previous: { value: number, at: Date } | null },
  threat: FactorReading,
  defences: FactorReading,
  business: FactorReading,
  /** From the period's first sampled run to `until`, null without one. */
  axis: TimeAxis | null,
}

export const threatOf = (run: DecompositionRun): number | null =>
  (run.tefMin === null || run.tefLikely === null || run.tefMax === null
    ? null
    : computePert(run.tefMin, run.tefLikely, run.tefMax));

export const defencesOf = (run: DecompositionRun): number | null =>
  (run.outcomeEvicted === null || run.outcomeImpactDetected === null || run.outcomeImpactUndetected === null
    ? null
    : toPercentPoints(pricedFraction({
      evicted: run.outcomeEvicted,
      impactDetected: run.outcomeImpactDetected,
      impactUndetected: run.outcomeImpactUndetected,
    })));

const businessOf = (run: DecompositionRun): number | null => run.magnitudeMean;

/** A series whose last point is the run in force now is held to the axis end: that value is still the current one. */
const buildSeries = (
  points: ReadonlyArray<DecompositionRun>,
  axis: TimeAxis | null,
  currentRunId: string | undefined,
  valueOf: (run: DecompositionRun) => number | null,
): Array<SeriesPoint> => {
  if (axis === null) {
    return [];
  }
  const start = axis.start.getTime();
  const span = axis.end.getTime() - start;
  const xOf = (at: Date): number => (span <= 0 ? 1 : (at.getTime() - start) / span);

  const plotted = points.flatMap((run) => {
    const value = valueOf(run);
    const at = new Date(run.createdAt);
    return value === null || Number.isNaN(at.getTime()) ? [] : [{ runId: run.id, at, value }];
  });
  const series = plotted.map(({ at, value }) => ({ at, value, x: xOf(at) }));
  const last = plotted.at(-1);
  if (last !== undefined && last.runId === currentRunId && xOf(last.at) < 1) {
    series.push({ at: axis.end, value: last.value, x: 1 });
  }
  return series;
};

const axisOf = (timeline: RunTimeline): TimeAxis | null => {
  const first = timeline.points[0];
  if (first === undefined) {
    return null;
  }
  const start = new Date(first.createdAt);
  const end = new Date(timeline.until);
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? null : { start, end };
};

const buildFactorReading = (
  timeline: RunTimeline,
  axis: TimeAxis | null,
  valueOf: (run: DecompositionRun) => number | null,
): FactorReading => {
  const [latest, previous] = timeline.latest;
  const latestValue = latest === undefined ? null : valueOf(latest);
  const previousValue = previous === undefined ? null : valueOf(previous);
  return {
    value: latestValue,
    change: latestValue === null || previousValue === null ? null : latestValue - previousValue,
    series: buildSeries(timeline.points, axis, latest?.id, valueOf),
  };
};

export const buildAleDecomposition = (timeline: RunTimeline): AleDecomposition => {
  const [latest, previous] = timeline.latest;
  const axis = axisOf(timeline);
  return {
    loss: {
      ...buildFactorReading(timeline, axis, (run) => run.aleMean),
      p10: latest?.aleP10 ?? null,
      p90: latest?.aleP90 ?? null,
      previous: previous === undefined || previous.aleMean === null
        ? null
        : { value: previous.aleMean, at: new Date(previous.createdAt) },
    },
    threat: buildFactorReading(timeline, axis, threatOf),
    defences: buildFactorReading(timeline, axis, defencesOf),
    business: buildFactorReading(timeline, axis, businessOf),
    axis,
  };
};

/**
 * The change between the previous reading and `value`, each rounded to `fractionDigits` first, so
 * the printed change is the difference of the two printed figures.
 */
export const printedChange = (value: number, change: number, fractionDigits: number): number =>
  roundToDecimals(roundToDecimals(value, fractionDigits) - roundToDecimals(value - change, fractionDigits), fractionDigits);

export const THREAT_DIGITS = 2;
export const DEFENCES_DIGITS = 1;

export const formatThreat = (value: number): string => formatFixed(value, THREAT_DIGITS);

/** The effective susceptibility, held in percentage points. */
export const formatDefences = (percentPoints: number): string => formatPointsAsPercent(percentPoints, DEFENCES_DIGITS);

export const pointsLabel = (signedPoints: string): string => t`${signedPoints} pts`;
