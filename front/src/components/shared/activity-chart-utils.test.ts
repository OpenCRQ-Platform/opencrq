import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, buildMonthLabels, countApplicableByDay, countsByDayOf, DAYS_PER_WEEK, WEEKS } from './activity-chart-utils';

const at = (day: number, hours = 12): Date => new Date(2026, 0, day, hours);

describe('buildMonthLabels', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  const cells = Array.from({ length: WEEKS * DAYS_PER_WEEK }, (_, index) => ({ date: addDays(at(5), index) }));

  it('should name the months in the application language, whatever the runtime default is', () => {
    i18n.load({ en: {}, fr: {} });
    i18n.activate('en');
    expect(buildMonthLabels(cells)[0].label).toBe('Jan');
    i18n.activate('fr');
    expect(buildMonthLabels(cells)[0].label).toBe('janv.');
  });
});

describe('countApplicableByDay', () => {
  it('should count an entity from the day it turned applicable until the day it stopped, by its last change of each day', () => {
    const counts = countApplicableByDay([
      { entityId: 'a', state: 'applicable', stateChangedAt: at(2) },
      { entityId: 'b', state: 'applicable', stateChangedAt: at(3).toISOString() },
      { entityId: 'a', state: 'dismissed', stateChangedAt: at(4) },
      { entityId: 'b', state: 'dismissed', stateChangedAt: at(5, 9) },
      { entityId: 'b', state: 'applicable', stateChangedAt: at(5, 18) },
    ], at(1, 0), at(6, 0));

    expect([...counts.values()]).toEqual([0, 1, 2, 1, 1, 1]);
  });
});

describe('countsByDayOf', () => {
  it('should key a server series by its days, and read no series as no counts', () => {
    expect(countsByDayOf([{ day: '2026-01-02', count: 3 }]).get('2026-01-02')).toBe(3);
    expect(countsByDayOf(undefined).size).toBe(0);
  });
});
