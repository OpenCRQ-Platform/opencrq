import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it } from 'vitest';
import { completeTolerance, countToleranceStatuses, formatProbability, formatToleranceProbability, fromFormValues, isToleranceBlank, isToleranceIncomplete, toFormValues } from './risk-tolerance-utils';

describe('toFormValues / fromFormValues', () => {
  it('reads a stored probability back as the percentage typed', () => {
    expect(toFormValues({ annualLoss: 500_000, maxExceedanceProbability: 0.07 })).toEqual({ annualLoss: 500_000, maxExceedancePercent: 7 });
  });

  it('stores the percentage as a probability', () => {
    expect(fromFormValues({ annualLoss: 1_000_000, maxExceedancePercent: 0.1 })).toEqual({ annualLoss: 1_000_000, maxExceedanceProbability: 0.001 });
  });
});

describe('isToleranceBlank', () => {
  it('reads two untouched fields as blank', () => {
    expect(isToleranceBlank({})).toBe(true);
  });

  it('reads two cleared fields as blank', () => {
    expect(isToleranceBlank({ annualLoss: Number.NaN, maxExceedancePercent: Number.NaN })).toBe(true);
  });

  it('does not read one filled field as blank', () => {
    expect(isToleranceBlank({ annualLoss: 5_000_000, maxExceedancePercent: Number.NaN })).toBe(false);
    expect(isToleranceBlank({ maxExceedancePercent: 5 })).toBe(false);
  });
});

describe('isToleranceIncomplete', () => {
  it('reads exactly one filled field as incomplete, whichever it is', () => {
    expect(isToleranceIncomplete({ annualLoss: 5_000_000, maxExceedancePercent: Number.NaN })).toBe(true);
    expect(isToleranceIncomplete({ maxExceedancePercent: 5 })).toBe(true);
  });

  it('does not read two blank or two filled fields as incomplete', () => {
    expect(isToleranceIncomplete({})).toBe(false);
    expect(isToleranceIncomplete({ annualLoss: Number.NaN, maxExceedancePercent: Number.NaN })).toBe(false);
    expect(isToleranceIncomplete({ annualLoss: 5_000_000, maxExceedancePercent: 5 })).toBe(false);
  });
});

describe('completeTolerance', () => {
  it('converts two filled fields to the tolerance written', () => {
    expect(completeTolerance({ annualLoss: 5_000_000, maxExceedancePercent: 5 })).toEqual({ annualLoss: 5_000_000, maxExceedanceProbability: 0.05 });
  });

  it('writes nothing while either field is blank', () => {
    expect(completeTolerance({})).toBeNull();
    expect(completeTolerance({ annualLoss: 5_000_000, maxExceedancePercent: Number.NaN })).toBeNull();
  });
});

describe('formatProbability', () => {
  it('reads a whole percentage without a decimal', () => {
    expect(formatProbability(0.1)).toBe('10%');
  });

  it('keeps a tenth at any magnitude', () => {
    expect(formatProbability(0.023)).toBe('2.3%');
    expect(formatProbability(0.001)).toBe('0.1%');
    expect(formatProbability(0.4567)).toBe('45.7%');
  });

  describe('in French', () => {
    afterEach(() => {
      i18n.load('en', {});
      i18n.activate('en');
    });

    it('writes the French decimal separator and percent spacing', () => {
      i18n.load('fr', {});
      i18n.activate('fr');
      expect(formatProbability(0.023)).toBe('2,3\u00a0%');
      expect(formatProbability(0.1)).toBe('10\u00a0%');
    });
  });
});

describe('formatToleranceProbability', () => {
  afterEach(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('reads a configured percentage back as typed', () => {
    expect(formatToleranceProbability(0.07)).toBe('7%');
    expect(formatToleranceProbability(0.104)).toBe('10.4%');
    expect(formatToleranceProbability(0.0015)).toBe('0.15%');
  });

  it('writes the French decimal separator and percent spacing', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatToleranceProbability(0.025)).toBe('2,5\u00a0%');
    expect(formatToleranceProbability(0.0015)).toBe('0,15\u00a0%');
  });
});

describe('countToleranceStatuses', () => {
  it('counts the rows outside and within, and those under their own threshold', () => {
    const rows = [
      { outside: true, source: 'scenario' as const },
      { outside: true, source: 'scope' as const },
      { outside: false, source: 'scope' as const },
    ];

    expect(countToleranceStatuses(rows)).toEqual({ simulatedCount: 3, outsideCount: 2, withinCount: 1, ownThresholdCount: 1 });
  });
});
