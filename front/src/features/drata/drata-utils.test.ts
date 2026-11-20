import { describe, expect, it } from 'vitest';
import { computeControlReadiness, computeRequirementReadiness, readinessFromCounts } from './drata-utils';

describe('computeRequirementReadiness', () => {
  it('derives the readiness fraction from in-scope rows only', () => {
    const result = computeRequirementReadiness([
      { isInScope: true, isReady: true },
      { isInScope: true, isReady: false },
      { isInScope: false, isReady: true },
    ]);
    expect(result).toEqual({
      total: 3,
      inScope: 2,
      readyInScope: 1,
      notReadyInScope: 1,
      outOfScope: 1,
      percent: 50,
    });
  });

  it('returns a null percent when nothing is in scope', () => {
    const result = computeRequirementReadiness([{ isInScope: false, isReady: false }]);
    expect(result.percent).toBeNull();
  });

  it('returns a null percent for an empty list', () => {
    expect(computeRequirementReadiness([]).percent).toBeNull();
  });

  it('rounds the percentage', () => {
    const rows = [
      { isInScope: true, isReady: true },
      { isInScope: true, isReady: true },
      { isInScope: true, isReady: false },
    ];
    expect(computeRequirementReadiness(rows).percent).toBe(67);
  });
});

describe('readinessFromCounts', () => {
  it('rounds an exact half up, as the percentage prints it', () => {
    expect(readinessFromCounts({ total: 200, inScope: 200, readyInScope: 29 }).percent).toBe(15);
  });

  it('derives the same shape from aggregated counts', () => {
    expect(readinessFromCounts({ total: 61, inScope: 34, readyInScope: 19 })).toEqual({
      total: 61,
      inScope: 34,
      readyInScope: 19,
      notReadyInScope: 15,
      outOfScope: 27,
      percent: 56,
    });
  });

  it('returns a null percent when nothing is in scope', () => {
    expect(readinessFromCounts({ total: 3, inScope: 0, readyInScope: 0 }).percent).toBeNull();
  });
});

describe('computeControlReadiness', () => {
  it('excludes archived controls from both totals', () => {
    const result = computeControlReadiness([
      { isReady: true, archivedAt: null },
      { isReady: false, archivedAt: null },
      { isReady: true, archivedAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(result).toEqual({ active: 2, readyActive: 1, archived: 1 });
  });

  it('handles an empty list', () => {
    expect(computeControlReadiness([])).toEqual({ active: 0, readyActive: 0, archived: 0 });
  });
});
