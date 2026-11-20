import { describe, expect, it } from 'vitest';
import {
  buildSeverityMix,
  impactedShare,
} from './findings-dashboard-utils';

describe('impactedShare', () => {
  it('is null on an empty population rather than zero', () => {
    expect(impactedShare(3, 12)).toBe(0.25);
    expect(impactedShare(0, 0)).toBeNull();
  });
});

describe('buildSeverityMix', () => {
  it('keeps severity order, drops empty buckets and shares out of the full total', () => {
    const mix = buildSeverityMix({ critical: 1, high: 0, medium: 2, low: 0, none: 0, unscored: 1 });

    expect(mix.total).toBe(4);
    expect(mix.segments).toEqual([
      { bucket: 'critical', count: 1, share: 0.25 },
      { bucket: 'medium', count: 2, share: 0.5 },
      { bucket: 'unscored', count: 1, share: 0.25 },
    ]);
  });

  it('reports a zero total without producing NaN shares', () => {
    expect(buildSeverityMix({ critical: 0, high: 0, medium: 0, low: 0, none: 0, unscored: 0 }))
      .toEqual({ total: 0, segments: [] });
  });
});
