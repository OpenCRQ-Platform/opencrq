import { describe, expect, it } from 'vitest';
import type { Schedule } from './cadence';
import { isWellFormedSchedule, nextOccurrence, offeredCadences } from './cadence';

const at = (iso: string): number => Date.parse(iso);
const next = (schedule: Schedule, iso: string): string | undefined => nextOccurrence(schedule, at(iso))?.toISOString();

const interval = (cadence: Schedule['cadence']): Schedule => ({ cadence, atMinute: null, weekday: null, timeZone: null });

describe('schedule cadence', () => {
  it('has no next occurrence on a manual schedule', () => {
    expect(nextOccurrence(interval('manual'), at('2026-10-02T14:00:00Z'))).toBeNull();
  });

  it('puts the sub-daily cadences on the clock, from UTC midnight', () => {
    expect(next(interval('hourly'), '2026-10-02T14:20:00Z')).toBe('2026-10-02T15:00:00.000Z');
    expect(next(interval('every_6_hours'), '2026-10-02T14:20:00Z')).toBe('2026-10-02T18:00:00.000Z');
    expect(next(interval('every_12_hours'), '2026-10-02T14:20:00Z')).toBe('2026-10-03T00:00:00.000Z');
  });

  it('never returns the instant it is asked from, so a slot just served is not served twice', () => {
    expect(next(interval('every_6_hours'), '2026-10-02T18:00:00Z')).toBe('2026-10-03T00:00:00.000Z');
    expect(next({ cadence: 'daily', atMinute: 6 * 60, weekday: null, timeZone: 'UTC' }, '2026-10-02T06:00:00Z')).toBe('2026-10-03T06:00:00.000Z');
  });

  it('runs a daily schedule today while its time is ahead, tomorrow once it has passed', () => {
    const daily: Schedule = { cadence: 'daily', atMinute: 6 * 60 + 30, weekday: null, timeZone: 'UTC' };
    expect(next(daily, '2026-10-02T05:00:00Z')).toBe('2026-10-02T06:30:00.000Z');
    expect(next(daily, '2026-10-02T07:00:00Z')).toBe('2026-10-03T06:30:00.000Z');
  });

  it('runs a weekly schedule on its weekday', () => {
    // 2026-10-02 is a Friday; 1 is Monday.
    const weekly: Schedule = { cadence: 'weekly', atMinute: 6 * 60, weekday: 1, timeZone: 'UTC' };
    expect(next(weekly, '2026-10-02T14:00:00Z')).toBe('2026-10-05T06:00:00.000Z');
    expect(next(weekly, '2026-10-05T05:59:00Z')).toBe('2026-10-05T06:00:00.000Z');
    expect(next(weekly, '2026-10-05T06:00:00Z')).toBe('2026-10-12T06:00:00.000Z');
  });

  it('lands on the first future slot however far in the past it is asked to catch up from', () => {
    const daily: Schedule = { cadence: 'daily', atMinute: 6 * 60, weekday: null, timeZone: 'UTC' };
    const twoDaysLate = at('2026-10-02T14:00:00Z');
    expect(nextOccurrence(daily, twoDaysLate)?.toISOString()).toBe('2026-10-03T06:00:00.000Z');
  });

  it('keeps the wall-clock time of its zone across a daylight-saving switch', () => {
    // Paris is on UTC+2 until 2026-10-25 03:00, on UTC+1 after.
    const daily: Schedule = { cadence: 'daily', atMinute: 6 * 60, weekday: null, timeZone: 'Europe/Paris' };
    expect(next(daily, '2026-10-24T12:00:00Z')).toBe('2026-10-25T05:00:00.000Z');
    expect(next(daily, '2026-10-23T12:00:00Z')).toBe('2026-10-24T04:00:00.000Z');
  });

  it('reads the weekday in its zone, where it can differ from the UTC one', () => {
    const weekly: Schedule = { cadence: 'weekly', atMinute: 60, weekday: 1, timeZone: 'Europe/Paris' };
    expect(next(weekly, '2026-10-02T14:00:00Z')).toBe('2026-10-04T23:00:00.000Z');
    const tokyo: Schedule = { cadence: 'daily', atMinute: 23 * 60, weekday: null, timeZone: 'Asia/Tokyo' };
    expect(next(tokyo, '2026-10-02T14:30:00Z')).toBe('2026-10-03T14:00:00.000Z');
  });

  it('runs a time skipped by the spring switch an hour later that day', () => {
    // 2027-03-28 02:30 does not exist in Paris: the clock jumps from 02:00 to 03:00.
    const daily: Schedule = { cadence: 'daily', atMinute: 2 * 60 + 30, weekday: null, timeZone: 'Europe/Paris' };
    expect(next(daily, '2027-03-27T12:00:00Z')).toBe('2027-03-28T01:30:00.000Z');
    // West of UTC too: New York jumps from 02:00 to 03:00 on 2026-03-08.
    const newYork: Schedule = { ...daily, timeZone: 'America/New_York' };
    expect(next(newYork, '2026-03-07T12:00:00Z')).toBe('2026-03-08T07:30:00.000Z');
  });

  it('runs a time the autumn switch reads twice on its second reading', () => {
    const paris: Schedule = { cadence: 'daily', atMinute: 2 * 60 + 30, weekday: null, timeZone: 'Europe/Paris' };
    expect(next(paris, '2026-10-24T12:00:00Z')).toBe('2026-10-25T01:30:00.000Z');
    const newYork: Schedule = { cadence: 'daily', atMinute: 60 + 30, weekday: null, timeZone: 'America/New_York' };
    expect(next(newYork, '2026-10-31T12:00:00Z')).toBe('2026-11-01T06:30:00.000Z');
  });

  it('offers manual always, and no recurring cadence tighter than the minimum', () => {
    expect(offeredCadences(1)).toEqual(['manual', 'hourly', 'every_6_hours', 'every_12_hours', 'daily', 'weekly']);
    expect(offeredCadences(6)).toEqual(['manual', 'every_6_hours', 'every_12_hours', 'daily', 'weekly']);
    expect(offeredCadences(12)).toEqual(['manual', 'every_12_hours', 'daily', 'weekly']);
  });

  it('asks a time of the daily and weekly cadences only, and a weekday of the weekly one only', () => {
    expect(isWellFormedSchedule(interval('every_6_hours'))).toBe(true);
    expect(isWellFormedSchedule({ cadence: 'every_6_hours', atMinute: 0, weekday: null, timeZone: null })).toBe(false);
    expect(isWellFormedSchedule({ cadence: 'daily', atMinute: null, weekday: null, timeZone: 'UTC' })).toBe(false);
    expect(isWellFormedSchedule({ cadence: 'daily', atMinute: 1440, weekday: null, timeZone: 'UTC' })).toBe(false);
    expect(isWellFormedSchedule({ cadence: 'daily', atMinute: 1439, weekday: 2, timeZone: 'UTC' })).toBe(false);
    expect(isWellFormedSchedule({ cadence: 'weekly', atMinute: 0, weekday: 7, timeZone: 'UTC' })).toBe(false);
    expect(isWellFormedSchedule({ cadence: 'weekly', atMinute: 0, weekday: 0, timeZone: 'UTC' })).toBe(true);
    expect(isWellFormedSchedule({ cadence: 'daily', atMinute: 0, weekday: null, timeZone: null })).toBe(false);
    expect(isWellFormedSchedule({ cadence: 'daily', atMinute: 0, weekday: null, timeZone: 'Mars/Olympus' })).toBe(false);
    expect(isWellFormedSchedule({ cadence: 'hourly', atMinute: null, weekday: null, timeZone: 'UTC' })).toBe(false);
  });
});
