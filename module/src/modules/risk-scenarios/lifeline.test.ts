import { describe, expect, it } from 'vitest';
import type { ScenarioLifelinePoint } from './lifeline';
import { computeLifelineChange } from './lifeline';

const point = (isoDate: string, aleMean: number): ScenarioLifelinePoint => ({
  at: new Date(isoDate),
  aleMean,
  aleP10: aleMean * 0.6,
  aleP90: aleMean * 1.7,
});

describe('computeLifelineChange', () => {
  it('should span the lifeline: its oldest point against its newest', () => {
    const change = computeLifelineChange([
      point('2026-01-01', 100),
      point('2026-01-02', 9000),
      point('2026-01-03', 150),
    ]);

    expect(change).toEqual({ delta: 50, deltaPct: 0.5, spanDays: 2 });
  });

  it('should report a fall as a negative change', () => {
    expect(computeLifelineChange([point('2026-01-01', 200), point('2026-01-02', 150)]))
      .toEqual({ delta: -50, deltaPct: -0.25, spanDays: 1 });
  });

  it('should report no change for a lifeline of fewer than two points', () => {
    expect(computeLifelineChange([])).toBeNull();
    expect(computeLifelineChange([point('2026-01-01', 100)])).toBeNull();
  });

  it('should omit the ratio when the oldest point priced the scenario at zero', () => {
    expect(computeLifelineChange([point('2026-01-01', 0), point('2026-01-02', 500)]))
      .toEqual({ delta: 500, deltaPct: null, spanDays: 1 });
  });
});
