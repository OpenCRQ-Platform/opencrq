import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGapScale, formatGapRatio, summarizeToleranceGaps } from './tolerance-gap-utils';

describe('summarizeToleranceGaps', () => {
  const row = (gap: number) => ({ gap, outside: gap > 0 });

  it('shows the rows up to the limit and counts the rest', () => {
    const summary = summarizeToleranceGaps([row(5), row(3), row(1), row(-1), row(-4)], 2);

    expect(summary.shown.map(({ gap }) => gap)).toEqual([5, 3]);
    expect(summary).toMatchObject({ otherCount: 3, otherOutsideCount: 1 });
  });

  it('leaves nothing over when every row fits', () => {
    expect(summarizeToleranceGaps([row(5), row(-1)], 8)).toMatchObject({ otherCount: 0, otherOutsideCount: 0 });
  });
});

describe('buildGapScale', () => {
  it('spans both sides of the threshold in round steps', () => {
    const scale = buildGapScale([12_000_000, -3_000_000]);

    expect(scale.ticks).toEqual([-5_000_000, 0, 5_000_000, 10_000_000, 15_000_000]);
    expect(scale.position(0)).toBe(0.25);
    expect(scale.position(15_000_000)).toBe(1);
  });

  it('puts the threshold on the left edge when every scenario overruns', () => {
    const scale = buildGapScale([3, 1]);

    expect(scale.ticks[0]).toBe(0);
    expect(scale.position(0)).toBe(0);
  });

  it('puts the threshold on the right edge when every scenario keeps a margin', () => {
    const scale = buildGapScale([-3, -1]);

    expect(scale.ticks.at(-1)).toBe(0);
    expect(scale.position(0)).toBe(1);
  });

  it('keeps a span when every gap is zero', () => {
    const scale = buildGapScale([0]);

    expect(scale.ticks.length).toBeGreaterThan(1);
    expect(Number.isFinite(scale.position(0))).toBe(true);
  });
});

describe('formatGapRatio', () => {
  it('reads two significant digits', () => {
    expect(formatGapRatio(1.8123)).toBe('1.8×');
    expect(formatGapRatio(0.934)).toBe('0.93×');
  });

  it('takes a third digit rather than reading a ratio off the threshold as on it', () => {
    expect(formatGapRatio(1.048)).toBe('1.05×');
    expect(formatGapRatio(1)).toBe('1×');
  });

  describe('in French', () => {
    afterEach(() => {
      i18n.load('en', {});
      i18n.activate('en');
    });

    it('writes the French decimal separator', () => {
      i18n.load('fr', {});
      i18n.activate('fr');
      expect(formatGapRatio(1.5)).toBe('1,5×');
      expect(formatGapRatio(0.55)).toBe('0,55×');
      expect(formatGapRatio(1.048)).toBe('1,05×');
    });
  });
});
