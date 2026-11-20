import type { ExceedancePoint, RiskToleranceLike } from '@app/module/client';
import { isOutsideTolerance, readExceedance } from '@app/module/client';

/** From the threshold amount to where the curve falls to the maximum probability. */
export const breachSegment = (curve: ReadonlyArray<ExceedancePoint>, tolerance: RiskToleranceLike): Array<ExceedancePoint> => {
  const { annualLoss, maxExceedanceProbability: max } = tolerance;
  const start = readExceedance(curve, annualLoss);
  if (!isOutsideTolerance(start, tolerance)) {
    return [];
  }
  const segment: Array<ExceedancePoint> = [{ loss: annualLoss, probability: start.probability }];
  for (const point of curve) {
    if (point.loss <= annualLoss) {
      continue;
    }
    if (point.probability > max) {
      segment.push(point);
      continue;
    }
    const previous = segment[segment.length - 1];
    const share = (previous.probability - max) / (previous.probability - point.probability);
    segment.push({ loss: previous.loss + share * (point.loss - previous.loss), probability: max });
    break;
  }
  return segment;
};

const NICE_STEPS = [1, 2, 2.5, 5, 10];

/** A probability label reads to a tenth of a point, so a finer step would print two ticks alike. */
export const PROBABILITY_TICK_STEP = 0.001;

const niceStep = (rough: number, minStep = 0): number => {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return Math.max((NICE_STEPS.find((candidate) => candidate * magnitude >= rough) ?? 10) * magnitude, minStep);
};

/** Round ticks from zero covering `max` in at most `count` steps, the last tick at or above it, never closer than `minStep`. */
export const niceTicks = (max: number, count: number, minStep = 0): Array<number> => {
  if (!(max > 0)) {
    return [0, 1];
  }
  const step = niceStep(max / count, minStep);
  const steps = Math.ceil(max / step - 1e-9);
  return Array.from({ length: steps + 1 }, (_, index) => Number((index * step).toPrecision(12)));
};

export interface ProbabilityAxis {
  from: number,
  to: number,
  ticks: Array<number>,
}

/**
 * An axis framing the probabilities from `low` to `high` rather than from zero: their span padded by
 * a tenth on each side, never below 0 or above 1, with round ticks inside it. The ends are not
 * rounded out to a tick, since a coarse step would pull the bottom back to zero.
 */
export const probabilityRangeAxis = (low: number, high: number, count: number): ProbabilityAxis => {
  const span = high - low;
  const pad = span > 0 ? span / 10 : Math.max(high / 10, 0.001);
  const from = Math.max(low - pad, 0);
  const to = Math.min(high + pad, 1);
  const step = niceStep((to - from) / count, PROBABILITY_TICK_STEP);
  const first = Math.ceil(from / step - 1e-9);
  const last = Math.floor(to / step + 1e-9);
  const ticks = Array.from({ length: Math.max(last - first + 1, 0) }, (_, index) => Number(((first + index) * step).toPrecision(12)));
  return { from, to, ticks };
};
