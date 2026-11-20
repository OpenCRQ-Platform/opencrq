import { describe, expect, it } from 'vitest';
import type { ExceedanceHistoryPointLike } from './exceedance-history-utils';
import { readExceedanceHistory, sinceNeedsYear } from './exceedance-history-utils';

const TODAY = '2026-10-05';
const WINDOW_DAYS = 365;
const WINDOW_START = '2025-10-06';

const series = (readings: Array<[string, number | null]>): Array<ExceedanceHistoryPointLike> =>
  readings.map(([date, exceedance]) => ({ date, exceedance }));

describe('readExceedanceHistory', () => {
  it('skips a day without a distribution and reads the change from the first reading to the latest', () => {
    const history = readExceedanceHistory(series([['2025-10-06', 0.08], ['2026-01-10', null], ['2026-10-05', 0.11]]), 0.1, TODAY, WINDOW_DAYS, WINDOW_START);

    expect(history.points.map(({ date, probability }) => ({ date, probability }))).toEqual([
      { date: '2025-10-06', probability: 0.08 },
      { date: '2026-10-05', probability: 0.11 },
    ]);
    expect(history.points.map(({ x }) => x)).toEqual([0, 1]);
    expect(history.change).toBeCloseTo(0.03);
    expect(history.direction).toBe('up');
  });

  it('has no change from a single reading', () => {
    const history = readExceedanceHistory(series([['2026-10-05', 0.11]]), 0.1, TODAY, WINDOW_DAYS, WINDOW_START);

    expect(history).toMatchObject({ change: null, direction: 'flat' });
  });

  it('opens and closes a stretch above the maximum where the line crosses it', () => {
    const history = readExceedanceHistory(
      series([['2025-10-06', 0.08], ['2026-04-06', 0.12], ['2026-10-05', 0.08]]),
      0.1,
      TODAY,
      WINDOW_DAYS,
      WINDOW_START,
    );

    expect(history.aboveStretches).toHaveLength(1);
    const [stretch] = history.aboveStretches;
    expect(stretch.map(({ probability }) => probability)).toEqual([0.1, 0.12, 0.1]);
    expect(stretch[0].x).toBeCloseTo(history.points[1].x / 2);
    expect(stretch[2].x).toBeCloseTo((history.points[1].x + 1) / 2);
  });

  it('counts a reading equal to the maximum as within it', () => {
    const history = readExceedanceHistory(series([['2025-10-06', 0.1], ['2026-10-05', 0.1]]), 0.1, TODAY, WINDOW_DAYS, WINDOW_START);

    expect(history).toMatchObject({ aboveStretches: [], since: null });
  });

  it('dates an overrun from the first reading of the latest stretch outside', () => {
    const history = readExceedanceHistory(
      series([['2025-10-06', 0.12], ['2025-11-10', 0.09], ['2025-12-03', 0.11], ['2026-10-05', 0.13]]),
      0.1,
      TODAY,
      WINDOW_DAYS,
      WINDOW_START,
    );

    expect(history.since).toEqual({ status: 'outside', date: '2025-12-03' });
  });

  it('dates a return from the first reading back within', () => {
    const history = readExceedanceHistory(
      series([['2025-10-06', 0.12], ['2026-04-02', 0.09], ['2026-10-05', 0.07]]),
      0.1,
      TODAY,
      WINDOW_DAYS,
      WINDOW_START,
    );

    expect(history.since).toEqual({ status: 'back', date: '2026-04-02' });
  });

  it('claims the whole window only when its first day holds an outside reading', () => {
    const history = readExceedanceHistory(series([['2025-10-06', 0.12], ['2026-10-05', 0.13]]), 0.1, TODAY, WINDOW_DAYS, WINDOW_START);

    expect(history.since).toEqual({ status: 'outsideThroughout' });
  });

  it("reads the window's first day from the server, not from a browser clock a day behind it", () => {
    const history = readExceedanceHistory(series([['2025-10-06', 0.12], ['2026-10-04', 0.13]]), 0.1, '2026-10-04', WINDOW_DAYS, WINDOW_START);

    expect(history.since).toEqual({ status: 'outsideThroughout' });
  });

  it('dates an overrun from the first reading when the history is shorter than the window', () => {
    const history = readExceedanceHistory(series([['2026-09-20', 0.12], ['2026-10-05', 0.13]]), 0.1, TODAY, WINDOW_DAYS, WINDOW_START);

    expect(history.since).toEqual({ status: 'outside', date: '2026-09-20' });
  });

  it('dates an overrun from the only reading of a scenario priced today', () => {
    const history = readExceedanceHistory(series([['2026-10-05', 0.12]]), 0.1, TODAY, WINDOW_DAYS, WINDOW_START);

    expect(history.since).toEqual({ status: 'outside', date: '2026-10-05' });
  });

  it('says nothing for a scenario within its tolerance all along', () => {
    const history = readExceedanceHistory(series([['2025-10-06', 0.02], ['2026-10-05', 0.03]]), 0.1, TODAY, WINDOW_DAYS, WINDOW_START);

    expect(history.since).toBeNull();
  });
});

describe('sinceNeedsYear', () => {
  it('names the year only for the month the window holds twice', () => {
    expect(sinceNeedsYear('2025-10-06', TODAY)).toBe(true);
    expect(sinceNeedsYear('2026-10-01', TODAY)).toBe(false);
    expect(sinceNeedsYear('2025-12-03', TODAY)).toBe(false);
  });
});
