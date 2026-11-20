import { describe, expect, it } from 'vitest';
import type { SeverityBand } from './bands';
import { computeAssetPosture, explainAssetPosture, POSTURE_TAIL_CAP } from './asset-posture';

const counts = (overrides: Partial<Record<SeverityBand, number>> = {}): Record<SeverityBand, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  ...overrides,
});

describe('the asset posture', () => {
  it('reads a single finding at 60 as 40', () => {
    expect(computeAssetPosture(60, counts({ medium: 1 }))).toBe(40);
  });

  it('takes a high worst finding off as it stands', () => {
    expect(computeAssetPosture(84, counts({ high: 1 }))).toBe(16);
  });

  it('takes a critical worst finding off as it stands', () => {
    expect(computeAssetPosture(90, counts({ critical: 1 }))).toBe(10);
  });

  it('moves by one point across 70', () => {
    expect(computeAssetPosture(69, counts({ medium: 1 }))).toBe(31);
    expect(computeAssetPosture(70, counts({ high: 1 }))).toBe(30);
  });

  it('adds a fixed increment per finding by band', () => {
    const one = computeAssetPosture(50, counts({ medium: 1 }));
    expect(computeAssetPosture(50, counts({ medium: 1, critical: 20 }))).toBe(one - 1);
    expect(computeAssetPosture(50, counts({ medium: 1, high: 50 }))).toBe(one - 1);
    expect(computeAssetPosture(50, counts({ medium: 201 }))).toBe(one - 1);
  });

  it('stops counting medium and low findings at the cap', () => {
    const atCap = computeAssetPosture(30, counts({ low: POSTURE_TAIL_CAP }));
    expect(computeAssetPosture(30, counts({ low: POSTURE_TAIL_CAP * 3 }))).toBe(atCap);
    expect(computeAssetPosture(30, counts({ low: POSTURE_TAIL_CAP, medium: POSTURE_TAIL_CAP }))).toBe(atCap - 10);
  });

  it('never goes below zero', () => {
    expect(computeAssetPosture(99, counts({ critical: 5000 }))).toBe(0);
  });
});

describe('the posture composition', () => {
  it('replays a posture under the ceiling term by term', () => {
    const { score, composition } = explainAssetPosture(68, counts({ medium: 3, low: 2 }));
    expect(score).toBe(32);
    expect(composition.tail).toEqual([
      { band: 'medium', count: 3, pointsPerFinding: 0.005 },
      { band: 'low', count: 2, pointsPerFinding: 0.005 },
    ]);
    expect(composition.tailPoints).toBeCloseTo(0.025);
    expect(composition.capped).toBe(false);
    expect(composition.unrounded).toBeCloseTo(31.975);
  });

  it('says when the ceiling cut the points removed', () => {
    const { score, composition } = explainAssetPosture(100, counts({ critical: 1, low: 1 }));
    expect(score).toBe(0);
    expect(composition.removedPoints).toBeCloseTo(100.075);
    expect(composition.capped).toBe(true);
    expect(composition.unrounded).toBe(0);
  });

  it('lists the tail counts after the cap', () => {
    const { composition } = explainAssetPosture(30, counts({ low: POSTURE_TAIL_CAP * 3 }));
    expect(composition.tail).toEqual([{ band: 'low', count: POSTURE_TAIL_CAP, pointsPerFinding: 0.005 }]);
  });
});
