export interface AnnualLossQuantile {
  /** The cumulative level: the year's loss stays at or below `loss` with this probability. */
  probability: number,
  loss: number,
}

export interface AnnualLossDistributionLike {
  lossYearShare: number,
  quantiles: ReadonlyArray<AnnualLossQuantile>,
}

export interface RiskToleranceLike {
  annualLoss: number,
  maxExceedanceProbability: number,
}

/** The probability that the year's loss exceeds `loss`. */
export interface ExceedancePoint {
  loss: number,
  probability: number,
}

export interface ExceedanceReading {
  probability: number,
  /** Past the last level the run keeps: `probability` is then an upper bound, the true one lies below it. */
  beyondTail: boolean,
}

export const TOLERANCE_SOURCES = ['scenario', 'scope'] as const;
export type ToleranceSource = typeof TOLERANCE_SOURCES[number];

export interface AppliedTolerance {
  tolerance: RiskToleranceLike,
  source: ToleranceSource,
}

export interface ToleranceGap extends AppliedTolerance {
  /** The loss the year exceeds with the maximum tolerated probability. */
  loss: number,
  /** `loss` minus the threshold amount: positive, the overrun; negative, the margin left. */
  gap: number,
  ratio: number,
  outside: boolean,
}

/** `1 − 0.999` is `0.0010000000000000009` in floating point, which would read a probability equal to the maximum as above it. */
const roundProbability = (value: number): number => Math.round(value * 1e9) / 1e9;

/**
 * From `(0, lossYearShare)` on. Levels at a zero loss are dropped, the first point stands for them,
 * and the curve is kept non-increasing whatever the sampling noise of the levels.
 */
export const buildExceedanceCurve = (distribution: AnnualLossDistributionLike): Array<ExceedancePoint> => {
  const curve: Array<ExceedancePoint> = [{ loss: 0, probability: roundProbability(distribution.lossYearShare) }];
  for (const quantile of distribution.quantiles) {
    if (quantile.loss <= 0) {
      continue;
    }
    const previous = curve[curve.length - 1];
    curve.push({
      loss: Math.max(quantile.loss, previous.loss),
      probability: Math.min(roundProbability(1 - quantile.probability), previous.probability),
    });
  }
  return curve;
};

/**
 * Linear between points, so a threshold moving by a cent never flips the status. Where several points
 * share a loss, the lowest probability holds: exceeding is strict.
 */
export const readExceedance = (curve: ReadonlyArray<ExceedancePoint>, loss: number): ExceedanceReading => {
  const last = curve[curve.length - 1];
  if (loss >= last.loss) {
    return { probability: last.probability, beyondTail: loss > last.loss };
  }
  let index = 0;
  while (index + 1 < curve.length && curve[index + 1].loss <= loss) {
    index += 1;
  }
  const from = curve[index];
  const to = curve[index + 1];
  const share = (loss - from.loss) / (to.loss - from.loss);
  return { probability: roundProbability(from.probability + share * (to.probability - from.probability)), beyondTail: false };
};

/**
 * The inverse of `readExceedance`, on the same segments: the largest loss still exceeded with more than
 * `probability`, so it lies past a threshold amount exactly when that amount reads above `probability`.
 */
export const readLossAtProbability = (curve: ReadonlyArray<ExceedancePoint>, probability: number): number => {
  if (probability >= curve[0].probability) {
    return 0;
  }
  const index = curve.findIndex((point) => point.probability <= probability);
  if (index === -1) {
    return curve[curve.length - 1].loss;
  }
  const from = curve[index - 1];
  const to = curve[index];
  const share = (from.probability - probability) / (from.probability - to.probability);
  return from.loss + share * (to.loss - from.loss);
};

/** A probability equal to the maximum is within tolerance, and past the tail it is below 0.1%, under any maximum. */
export const isOutsideTolerance = (reading: ExceedanceReading, tolerance: RiskToleranceLike): boolean =>
  !reading.beyondTail && reading.probability > tolerance.maxExceedanceProbability;

export const resolveAppliedTolerance = (
  scopeTolerance: RiskToleranceLike | null,
  ownTolerance: RiskToleranceLike | null,
): AppliedTolerance | null => {
  if (ownTolerance !== null) {
    return { tolerance: ownTolerance, source: 'scenario' };
  }
  return scopeTolerance === null ? null : { tolerance: scopeTolerance, source: 'scope' };
};

/** `null` without a threshold applied or without a distribution to read it on. */
export const readToleranceGap = (
  distribution: AnnualLossDistributionLike | null,
  scopeTolerance: RiskToleranceLike | null,
  ownTolerance: RiskToleranceLike | null,
): ToleranceGap | null => {
  const applied = resolveAppliedTolerance(scopeTolerance, ownTolerance);
  if (applied === null || distribution === null) {
    return null;
  }
  const curve = buildExceedanceCurve(distribution);
  const { annualLoss, maxExceedanceProbability } = applied.tolerance;
  const loss = readLossAtProbability(curve, maxExceedanceProbability);
  return {
    ...applied,
    loss,
    gap: loss - annualLoss,
    ratio: loss / annualLoss,
    outside: isOutsideTolerance(readExceedance(curve, annualLoss), applied.tolerance),
  };
};

/** Overruns first, then the smallest margins. The status leads, so a rounding tie never sorts a margin above an overrun. */
export const compareToleranceGaps = (left: ToleranceGap, right: ToleranceGap): number =>
  Number(right.outside) - Number(left.outside) || right.gap - left.gap;
