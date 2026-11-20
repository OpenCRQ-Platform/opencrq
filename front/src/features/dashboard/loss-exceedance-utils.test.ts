import type { AnnualLossQuantile } from '@app/module/client';
import { buildExceedanceCurve } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import { breachSegment, niceTicks, probabilityRangeAxis } from './loss-exceedance-utils';

const LEVELS = [...Array.from({ length: 99 }, (_, index) => (index + 1) / 100), 0.995, 0.998, 0.999];

const distribution = (lossYearShare: number, lossPerLevel = 1000) => ({
  lossYearShare,
  quantiles: LEVELS.map((probability): AnnualLossQuantile => ({
    probability,
    loss: probability <= 1 - lossYearShare ? 0 : Math.round((probability - (1 - lossYearShare)) * 100 * lossPerLevel),
  })),
});

describe('breachSegment', () => {
  const curve = buildExceedanceCurve(distribution(0.6));

  it('runs from the threshold amount to where the curve falls to the maximum', () => {
    const segment = breachSegment(curve, { annualLoss: 10_000, maxExceedanceProbability: 0.45 });

    expect(segment[0]).toEqual({ loss: 10_000, probability: 0.5 });
    expect(segment.at(-1)).toEqual({ loss: 15_000, probability: 0.45 });
    expect(segment.every((point) => point.probability >= 0.45)).toBe(true);
  });

  it('is empty within tolerance', () => {
    expect(breachSegment(curve, { annualLoss: 10_000, maxExceedanceProbability: 0.5 })).toEqual([]);
  });
});

describe('niceTicks', () => {
  it('covers the maximum in round steps', () => {
    expect(niceTicks(0.62, 4)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(4_300_000, 5)).toEqual([0, 1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000]);
  });

  it('keeps its steps no finer than the step it is given', () => {
    expect(niceTicks(0.002, 4, 0.001)).toEqual([0, 0.001, 0.002]);
  });

  it('ends on the maximum when it is already round', () => {
    expect(niceTicks(1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('probabilityRangeAxis', () => {
  it('frames the readings and the maximum without starting from zero', () => {
    const axis = probabilityRangeAxis(0.1, 0.245, 4);

    expect(axis.from).toBeCloseTo(0.0855);
    expect(axis.to).toBeCloseTo(0.2595);
    expect(axis.ticks).toEqual([0.1, 0.15, 0.2, 0.25]);
  });

  it('keeps its ticks inside the frame', () => {
    expect(probabilityRangeAxis(0.098, 0.127, 4).ticks).toEqual([0.1, 0.11, 0.12]);
  });

  it('stops at zero and at one', () => {
    expect(probabilityRangeAxis(0.001, 0.04, 4)).toMatchObject({ from: 0, ticks: [0, 0.02, 0.04] });
    expect(probabilityRangeAxis(0.6, 1, 4)).toMatchObject({ to: 1, ticks: [0.6, 0.8, 1] });
  });

  it('frames a flat line around its value', () => {
    const axis = probabilityRangeAxis(0.1, 0.1, 4);

    expect(axis.from).toBeCloseTo(0.09);
    expect(axis.to).toBeCloseTo(0.11);
    expect(axis.ticks).toContain(0.1);
  });

  it('never steps finer than a tenth of a point, which the labels read to', () => {
    expect(probabilityRangeAxis(0.001, 0.0013, 4).ticks).toEqual([0.001]);
    expect(probabilityRangeAxis(0.001, 0.001, 4).ticks).toEqual([0, 0.001, 0.002]);
  });
});
