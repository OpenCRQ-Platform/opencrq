import { describe, expect, it } from 'vitest';
import type { AnnualLossQuantile, ToleranceGap } from './loss-exceedance';
import {
  buildExceedanceCurve,
  compareToleranceGaps,
  isOutsideTolerance,
  readExceedance,
  readLossAtProbability,
  readToleranceGap,
  resolveAppliedTolerance,
} from './loss-exceedance';

const LEVELS = [...Array.from({ length: 99 }, (_, index) => (index + 1) / 100), 0.995, 0.998, 0.999];

const distribution = (lossYearShare: number, lossPerLevel = 1000) => ({
  lossYearShare,
  quantiles: LEVELS.map((probability): AnnualLossQuantile => ({
    probability,
    loss: probability <= 1 - lossYearShare ? 0 : Math.round((probability - (1 - lossYearShare)) * 100 * lossPerLevel),
  })),
});

describe('buildExceedanceCurve', () => {
  it('starts at the share of years costing anything and drops the levels costing nothing', () => {
    const curve = buildExceedanceCurve(distribution(0.6));

    expect(curve[0]).toEqual({ loss: 0, probability: 0.6 });
    expect(curve[1]).toEqual({ loss: 1000, probability: 0.59 });
    expect(curve.at(-1)).toEqual({ loss: 59_900, probability: 0.001 });
  });

  it('never rises, whatever the noise of the levels', () => {
    const curve = buildExceedanceCurve({
      lossYearShare: 0.3,
      quantiles: [{ probability: 0.7, loss: 50 }, { probability: 0.71, loss: 40 }, { probability: 0.72, loss: 60 }],
    });

    expect(curve).toEqual([
      { loss: 0, probability: 0.3 },
      { loss: 50, probability: 0.3 },
      { loss: 50, probability: 0.29 },
      { loss: 60, probability: 0.28 },
    ]);
  });
});

describe('readExceedance', () => {
  const curve = buildExceedanceCurve(distribution(0.6));

  it('interpolates below the first level costing anything, from the share of years costing anything', () => {
    expect(readExceedance(curve, 500)).toEqual({ probability: 0.595, beyondTail: false });
  });

  it('interpolates between two levels, so a cent moves the probability by a cent worth', () => {
    const below = readExceedance(curve, 10_000);
    const above = readExceedance(curve, 10_000.01);

    expect(below.probability).toBe(0.5);
    expect(above.probability).toBeLessThan(below.probability);
    expect(below.probability - above.probability).toBeLessThan(1e-6);
  });

  it('reads beyond the tail as below the last level kept', () => {
    expect(readExceedance(curve, 1_000_000)).toEqual({ probability: 0.001, beyondTail: true });
  });

  it('takes the lowest probability where several points share a loss', () => {
    const tied = buildExceedanceCurve({ lossYearShare: 0.5, quantiles: [{ probability: 0.6, loss: 100 }, { probability: 0.7, loss: 100 }, { probability: 0.8, loss: 200 }] });

    expect(readExceedance(tied, 100).probability).toBe(0.3);
  });
});

describe('readLossAtProbability', () => {
  const curve = buildExceedanceCurve(distribution(0.6));

  it('inverts the reading between two levels', () => {
    expect(readLossAtProbability(curve, 0.5)).toBeCloseTo(10_000, 6);
    expect(readLossAtProbability(curve, 0.455)).toBeCloseTo(14_500, 6);
  });

  it('interpolates below the first level costing anything', () => {
    expect(readLossAtProbability(curve, 0.595)).toBeCloseTo(500, 6);
  });

  it('reads no loss at or above the share of years costing anything', () => {
    expect(readLossAtProbability(curve, 0.6)).toBe(0);
    expect(readLossAtProbability(curve, 0.9)).toBe(0);
  });

  it('reads the last level kept at the tail', () => {
    expect(readLossAtProbability(curve, 0.001)).toBe(59_900);
  });

  it('reads the start of a flat stretch, where the curve leaves the probability', () => {
    const flat = [{ loss: 0, probability: 0.5 }, { loss: 100, probability: 0.4 }, { loss: 200, probability: 0.4 }, { loss: 300, probability: 0.2 }];

    expect(readLossAtProbability(flat, 0.4)).toBe(100);
  });
});

describe('isOutsideTolerance', () => {
  const curve = buildExceedanceCurve(distribution(0.6));

  it('is outside when the probability of exceeding the amount is above the maximum', () => {
    expect(isOutsideTolerance(readExceedance(curve, 10_000), { annualLoss: 10_000, maxExceedanceProbability: 0.4 })).toBe(true);
  });

  it('is within when the probability equals the maximum', () => {
    expect(isOutsideTolerance(readExceedance(curve, 10_000), { annualLoss: 10_000, maxExceedanceProbability: 0.5 })).toBe(false);
  });

  it('is within at the last level kept when the maximum is the tail itself', () => {
    expect(isOutsideTolerance(readExceedance(curve, 59_900), { annualLoss: 59_900, maxExceedanceProbability: 0.001 })).toBe(false);
  });

  it('is within beyond the tail, whatever the maximum', () => {
    expect(isOutsideTolerance(readExceedance(curve, 2_000_000), { annualLoss: 2_000_000, maxExceedanceProbability: 0.001 })).toBe(false);
  });

  it('is outside below the first level when the share of years costing anything is above the maximum', () => {
    expect(isOutsideTolerance(readExceedance(curve, 1), { annualLoss: 1, maxExceedanceProbability: 0.5 })).toBe(true);
  });
});

describe('resolveAppliedTolerance', () => {
  const scope = { annualLoss: 1_000_000, maxExceedanceProbability: 0.1 };
  const own = { annualLoss: 500_000, maxExceedanceProbability: 0.05 };

  it('applies the scenario threshold over the scope one', () => {
    expect(resolveAppliedTolerance(scope, own)).toEqual({ tolerance: own, source: 'scenario' });
  });

  it('falls back to the scope threshold', () => {
    expect(resolveAppliedTolerance(scope, null)).toEqual({ tolerance: scope, source: 'scope' });
  });

  it('applies nothing when neither sets one', () => {
    expect(resolveAppliedTolerance(null, null)).toBeNull();
  });
});

describe('readToleranceGap', () => {
  const lossYears = distribution(0.6);

  it('reads an overrun as the loss exceeded at the maximum probability past the threshold amount', () => {
    const gap = readToleranceGap(lossYears, { annualLoss: 10_000, maxExceedanceProbability: 0.45 }, null);

    expect(gap?.source).toBe('scope');
    expect(gap?.loss).toBeCloseTo(15_000, 6);
    expect(gap?.gap).toBeCloseTo(5000, 6);
    expect(gap?.ratio).toBeCloseTo(1.5, 6);
    expect(gap?.outside).toBe(true);
  });

  it('reads a margin as a negative gap, against the scenario own threshold over the scope one', () => {
    const gap = readToleranceGap(lossYears, { annualLoss: 1, maxExceedanceProbability: 0.01 }, { annualLoss: 20_000, maxExceedanceProbability: 0.5 });

    expect(gap?.source).toBe('scenario');
    expect(gap?.gap).toBeCloseTo(-10_000, 6);
    expect(gap?.ratio).toBeCloseTo(0.5, 6);
    expect(gap?.outside).toBe(false);
  });

  it('reads minus the threshold amount when the maximum is at or above the share of years costing anything', () => {
    expect(readToleranceGap(lossYears, { annualLoss: 8000, maxExceedanceProbability: 0.7 }, null)).toMatchObject({ loss: 0, gap: -8000, ratio: 0, outside: false });
  });

  it('is within with no gap when the probability of exceeding the amount equals the maximum', () => {
    expect(readToleranceGap(lossYears, { annualLoss: 10_000, maxExceedanceProbability: 0.5 }, null)).toMatchObject({ outside: false });
    expect(readToleranceGap(lossYears, { annualLoss: 10_000, maxExceedanceProbability: 0.5 }, null)?.gap).toBeCloseTo(0, 6);
  });

  it('agrees with the status on either side of every threshold amount', () => {
    for (const annualLoss of [1, 999, 5000, 10_000, 25_000, 59_899, 59_900, 70_000]) {
      for (const maxExceedanceProbability of [0.001, 0.05, 0.3, 0.59, 0.6]) {
        const gap = readToleranceGap(lossYears, { annualLoss, maxExceedanceProbability }, null);
        expect(gap?.outside).toBe((gap?.gap ?? 0) > 1e-6);
      }
    }
  });

  it('reads nothing without a threshold or without a distribution', () => {
    expect(readToleranceGap(lossYears, null, null)).toBeNull();
    expect(readToleranceGap(null, { annualLoss: 1, maxExceedanceProbability: 0.1 }, null)).toBeNull();
  });
});

describe('compareToleranceGaps', () => {
  const gapOf = (gap: number, outside: boolean): ToleranceGap => ({
    tolerance: { annualLoss: 1, maxExceedanceProbability: 0.1 },
    source: 'scope',
    loss: 0,
    gap,
    ratio: 0,
    outside,
  });

  it('puts the overruns first, largest first, then the smallest margins', () => {
    const sorted = [gapOf(-5, false), gapOf(3, true), gapOf(-1, false), gapOf(9, true)].toSorted(compareToleranceGaps);

    expect(sorted.map((row) => row.gap)).toEqual([9, 3, -1, -5]);
  });

  it('keeps an overrun above a margin whatever a rounding left of its gap', () => {
    expect([gapOf(0, false), gapOf(-1e-12, true)].toSorted(compareToleranceGaps).map((row) => row.outside)).toEqual([true, false]);
  });
});
