import { describe, expect, it } from 'vitest';
import { countActiveThreats } from './threat-signal-utils';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

describe('countActiveThreats', () => {
  it('counts a threat last observed 89 days ago', () => {
    expect(countActiveThreats([{ lastObservedAt: daysAgo(89) }], NOW)).toBe(1);
  });

  it('does not count a threat last observed 91 days ago', () => {
    expect(countActiveThreats([{ lastObservedAt: daysAgo(91) }], NOW)).toBe(0);
  });

  it('does not count a threat that was never dated', () => {
    expect(countActiveThreats([{ lastObservedAt: null }], NOW)).toBe(0);
  });

  it('reads an ISO string like the equivalent Date', () => {
    expect(countActiveThreats([{ lastObservedAt: daysAgo(89).toISOString() }, { lastObservedAt: daysAgo(91).toISOString() }], NOW)).toBe(1);
  });

  it('counts only the active ones among several', () => {
    const analyses = [
      { lastObservedAt: daysAgo(3) },
      { lastObservedAt: daysAgo(60) },
      { lastObservedAt: daysAgo(120) },
      { lastObservedAt: null },
    ];

    expect(countActiveThreats(analyses, NOW)).toBe(2);
  });
});
