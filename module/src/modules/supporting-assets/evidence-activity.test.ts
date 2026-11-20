import { describe, expect, it } from 'vitest';
import { calendarDayIn, countSpansByDay, daysEndingOn, shiftDay } from './evidence-activity';

describe('evidence activity', () => {
  it('should read the calendar day of an instant in the given time zone', () => {
    const lateEvening = new Date('2026-03-10T23:30:00Z');

    expect(calendarDayIn('UTC', lateEvening)).toBe('2026-03-10');
    expect(calendarDayIn('Asia/Tokyo', lateEvening)).toBe('2026-03-11');
    expect(calendarDayIn('America/Los_Angeles', new Date('2026-03-11T05:00:00Z'))).toBe('2026-03-10');
  });

  it('should shift a day across month, year and leap day boundaries', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('should list the days ending on the last one, oldest first', () => {
    expect(daysEndingOn('2026-01-02', 4)).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
  });

  it('should count a span from its first day up to the day before it ends, and an open span to the last day', () => {
    const days = daysEndingOn('2026-01-06', 6);

    const series = countSpansByDay([
      { fromDay: '2026-01-01', toDay: '2026-01-03', findings: 2 },
      { fromDay: '2026-01-02', toDay: null, findings: 1 },
      { fromDay: '2026-01-05', toDay: '2026-01-06', findings: 4 },
    ], days);

    expect(series).toEqual([
      { day: '2026-01-01', count: 2 },
      { day: '2026-01-02', count: 3 },
      { day: '2026-01-03', count: 1 },
      { day: '2026-01-04', count: 1 },
      { day: '2026-01-05', count: 5 },
      { day: '2026-01-06', count: 1 },
    ]);
  });

  it('should leave a span opening after the last day out', () => {
    expect(countSpansByDay([{ fromDay: '2026-01-03', toDay: null, findings: 1 }], ['2026-01-01', '2026-01-02']))
      .toEqual([{ day: '2026-01-01', count: 0 }, { day: '2026-01-02', count: 0 }]);
  });
});
