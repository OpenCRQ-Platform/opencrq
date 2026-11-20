import { describe, expect, it } from 'vitest';
import {
  bandsFallingBehind,
  monthStartTimestamp,
  occupancyBarRatio,
  occupancyLevel,
  occupancySparkline,
  openChangeOverMonths,
  openChangeOverWindow,
  paceVerdict,
  roundRate,
} from './remediation-pace-utils';

describe('occupancyLevel', () => {
  it('turns red from 90 %, amber from 80 %', () => {
    expect(occupancyLevel({ occupancy: 0.9, newPerMonth: 9 })).toBe('over');
    expect(occupancyLevel({ occupancy: 0.89, newPerMonth: 9 })).toBe('near');
    expect(occupancyLevel({ occupancy: 0.8, newPerMonth: 8 })).toBe('near');
    expect(occupancyLevel({ occupancy: 0.79, newPerMonth: 8 })).toBe('within');
  });

  it('reads a band receiving findings with no closing capacity as over', () => {
    expect(occupancyLevel({ occupancy: null, newPerMonth: 2 })).toBe('over');
    expect(occupancyLevel({ occupancy: null, newPerMonth: 0 })).toBe('within');
  });
});

describe('occupancyBarRatio', () => {
  it('caps the bar at full and fills it for a band with no capacity', () => {
    expect(occupancyBarRatio({ occupancy: 1.4, newPerMonth: 14 })).toBe(1);
    expect(occupancyBarRatio({ occupancy: 0.5, newPerMonth: 5 })).toBe(0.5);
    expect(occupancyBarRatio({ occupancy: null, newPerMonth: 3 })).toBe(1);
    expect(occupancyBarRatio({ occupancy: null, newPerMonth: 0 })).toBe(0);
  });
});

describe('bandsFallingBehind', () => {
  it('names the bands at or above the alert threshold, hottest first as given', () => {
    expect(bandsFallingBehind([
      { band: 'critical', occupancy: 0.64, newPerMonth: 9 },
      { band: 'high', occupancy: 0.97, newPerMonth: 38 },
      { band: 'medium', occupancy: 0.98, newPerMonth: 64 },
      { band: 'low', occupancy: null, newPerMonth: 4 },
    ])).toEqual(['high', 'medium', 'low']);
  });
});

describe('paceVerdict', () => {
  it('states the net drift a week and its direction', () => {
    expect(paceVerdict({ newInWindow: 151, closedInWindow: 90 }, 90)).toEqual({ direction: 'behind', perWeek: 4.7 });
    expect(paceVerdict({ newInWindow: 10, closedInWindow: 40 }, 30)).toEqual({ direction: 'clearing', perWeek: 7 });
  });

  it('reads a drift rounding to zero as level', () => {
    expect(paceVerdict({ newInWindow: 100, closedInWindow: 100 }, 90)).toEqual({ direction: 'level', perWeek: 0 });
    expect(paceVerdict({ newInWindow: 101, closedInWindow: 100 }, 90)).toEqual({ direction: 'behind', perWeek: 0.1 });
  });
});

describe('openChangeOverWindow', () => {
  it('is relative to the open count when the window started, and null from zero', () => {
    expect(openChangeOverWindow({ openAtWindowStart: 532, openCount: 612 })).toBeCloseTo(0.15, 2);
    expect(openChangeOverWindow({ openAtWindowStart: 0, openCount: 4 })).toBeNull();
  });
});

describe('openChangeOverMonths', () => {
  it('compares the last month end with the one six months before', () => {
    expect(openChangeOverMonths([1, 2, 3, 4, 5, 140, 142, 146, 152, 160, 168, 177], 6)).toBeCloseTo(37 / 140);
    expect(openChangeOverMonths([5, 6], 6)).toBeNull();
  });
});

describe('roundRate', () => {
  it('keeps one decimal below ten', () => {
    expect(roundRate(158.4)).toBe(158);
    expect(roundRate(0.34)).toBe(0.3);
  });
});

describe('monthStartTimestamp', () => {
  it('reads a month key as its first UTC day', () => {
    expect(new Date(monthStartTimestamp('2026-09')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('occupancySparkline', () => {
  it('caps each month between empty and full, keeping the gaps', () => {
    expect(occupancySparkline([0.4, 2.3, null, -0.1, 1])).toEqual([0.4, 1, null, 0, 1]);
  });
});
