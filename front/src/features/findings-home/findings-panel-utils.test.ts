import { describe, expect, it } from 'vitest';
import type { UniqueFindingsPanelCounts } from './findings-panel-utils';
import {
  formatPanelCount,
  formatSignedDelta,
  isCountAbbreviated,
  resolveTrendDirection,
  resolveUniqueFindingsTrends,
  toBandCounts,
} from './findings-panel-utils';

describe('toBandCounts', () => {
  it('answers zero on every band when the server reported none', () => {
    expect(toBandCounts([])).toEqual({
      critical: { total: 0, newInWindow: 0 },
      high: { total: 0, newInWindow: 0 },
      medium: { total: 0, newInWindow: 0 },
      low: { total: 0, newInWindow: 0 },
    });
  });

  it('fills in the bands the server had nothing to report for', () => {
    const counts = toBandCounts([{ band: 'critical', total: 12, newInWindow: 3 }]);

    expect(counts.critical).toEqual({ total: 12, newInWindow: 3 });
    expect(counts.high).toEqual({ total: 0, newInWindow: 0 });
  });

  it('keys every reported band by its own name', () => {
    const counts = toBandCounts([
      { band: 'low', total: 1, newInWindow: 0 },
      { band: 'medium', total: 2, newInWindow: 1 },
      { band: 'high', total: 3, newInWindow: 2 },
      { band: 'critical', total: 4, newInWindow: 3 },
    ]);

    expect(counts.low.total).toBe(1);
    expect(counts.medium.newInWindow).toBe(1);
    expect(counts.high.total).toBe(3);
    expect(counts.critical.newInWindow).toBe(3);
  });
});

describe('resolveTrendDirection', () => {
  it('reads a rise as bad news', () => {
    expect(resolveTrendDirection(28)).toBe('worse');
  });

  it('reads a fall as good news', () => {
    expect(resolveTrendDirection(-4)).toBe('better');
  });

  it('reads no movement as flat', () => {
    expect(resolveTrendDirection(0)).toBe('flat');
  });
});

describe('count formatting', () => {
  it('keeps four-digit counts unabbreviated with their thousands separator', () => {
    expect(formatPanelCount(1284, 'en')).toBe('1,284');
    expect(isCountAbbreviated(1284)).toBe(false);
  });

  it('abbreviates from five digits up', () => {
    expect(isCountAbbreviated(9999)).toBe(false);
    expect(isCountAbbreviated(10_000)).toBe(true);
    expect(formatPanelCount(12_345, 'en')).toBe('12.3K');
  });

  it('signs every delta but the flat one', () => {
    expect(formatSignedDelta(28, 'en')).toBe('+28');
    expect(formatSignedDelta(-4, 'en')).toBe('-4');
    expect(formatSignedDelta(0, 'en')).toBe('0');
  });
});

describe('resolveUniqueFindingsTrends', () => {
  const baselines = {
    cveGroupsBefore: 92,
    bandsBefore: [{ band: 'critical', total: 4 }, { band: 'high', total: 3 }, { band: 'low', total: 40 }],
    newInPreviousWindow: 12,
  } as const;
  const counts: UniqueFindingsPanelCounts = {
    uniqueFindings: 120,
    techniqueGroups: 20,
    newInWindow: 9,
    bands: [{ band: 'critical', total: 6, newInWindow: 2 }, { band: 'low', total: 40, newInWindow: 3 }],
    baselines,
  };

  it('compares the CVE groups alone, technique groups left out', () => {
    expect(resolveUniqueFindingsTrends(counts).cveGroups).toBe(8);
  });

  it('compares the new-count with the previous window', () => {
    expect(resolveUniqueFindingsTrends(counts).newInWindow).toBe(-3);
  });

  it('compares every band, a band empty on either side counting zero', () => {
    expect(resolveUniqueFindingsTrends(counts).bands).toEqual({ critical: 2, high: -3, medium: 0, low: 0 });
  });

  it('draws no trend at all without baselines', () => {
    expect(resolveUniqueFindingsTrends({ ...counts, baselines: null })).toEqual({
      cveGroups: null,
      newInWindow: null,
      bands: { critical: null, high: null, medium: null, low: null },
    });
  });

  it('withholds the new-count trend alone when the previous window is not journaled', () => {
    const trends = resolveUniqueFindingsTrends({ ...counts, baselines: { ...baselines, newInPreviousWindow: null } });

    expect(trends.newInWindow).toBeNull();
    expect(trends.cveGroups).toBe(8);
  });
});
