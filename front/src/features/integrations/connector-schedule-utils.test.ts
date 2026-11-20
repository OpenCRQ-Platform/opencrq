import { describe, expect, it } from 'vitest';
import { getTimeZoneOptions, readNextRun, toSchedule, toScheduleFields, utcOffsetLabel } from './connector-schedule-utils';

describe('connector schedule form fields', () => {
  it('stores the day and the time as entered, with the zone they are read in', () => {
    expect(toSchedule({ cadence: 'weekly', weekday: 1, time: '07:30', timeZone: 'Europe/Paris' }))
      .toEqual({ cadence: 'weekly', atMinute: 7 * 60 + 30, weekday: 1, timeZone: 'Europe/Paris' });
  });

  it('reads a saved schedule back as it was entered', () => {
    expect(toScheduleFields({ cadence: 'daily', atMinute: 6 * 60, weekday: null, timeZone: 'UTC' }, 'Europe/Paris'))
      .toEqual({ cadence: 'daily', weekday: 1, time: '06:00', timeZone: 'UTC' });
  });

  it('offers the fallback zone on a cadence that carries none', () => {
    expect(toScheduleFields({ cadence: 'every_6_hours', atMinute: null, weekday: null, timeZone: null }, 'Europe/Paris').timeZone)
      .toBe('Europe/Paris');
  });

  it('stores no day, time or zone for a cadence that takes none', () => {
    expect(toSchedule({ cadence: 'every_6_hours', weekday: 3, time: '09:15', timeZone: 'Europe/Paris' }))
      .toEqual({ cadence: 'every_6_hours', atMinute: null, weekday: null, timeZone: null });
  });

  it('stores no day for a daily cadence', () => {
    expect(toSchedule({ cadence: 'daily', weekday: 3, time: '09:15', timeZone: 'UTC' })?.weekday).toBeNull();
  });

  it('takes an hour typed without its leading zero', () => {
    expect(toSchedule({ cadence: 'daily', weekday: 1, time: '6:30', timeZone: 'UTC' })?.atMinute).toBe(6 * 60 + 30);
  });

  it('refuses a time that is not one', () => {
    expect(toSchedule({ cadence: 'daily', weekday: 1, time: '', timeZone: 'UTC' })).toBeNull();
    expect(toSchedule({ cadence: 'daily', weekday: 1, time: '25:00', timeZone: 'UTC' })).toBeNull();
  });

  it('labels each zone with its offset at the given instant, UTC first', () => {
    const summer = getTimeZoneOptions('Europe/Paris', Date.parse('2026-10-02T12:00:00Z'));
    const winter = getTimeZoneOptions('Europe/Paris', Date.parse('2026-12-02T12:00:00Z'));
    expect(summer[0]).toEqual({ value: 'UTC', label: 'UTC' });
    expect(summer.find(({ value }) => value === 'Europe/Paris')?.label).toBe('Europe/Paris (UTC+02:00)');
    expect(winter.find(({ value }) => value === 'Europe/Paris')?.label).toBe('Europe/Paris (UTC+01:00)');
    expect(summer.filter(({ value }) => value === 'Europe/Paris')).toHaveLength(1);
  });

  it('reads the offset in force at the instant, not today', () => {
    expect(utcOffsetLabel('America/New_York', Date.parse('2026-10-03T10:00:00Z'))).toBe('UTC-04:00');
    expect(utcOffsetLabel('America/New_York', Date.parse('2026-11-03T11:00:00Z'))).toBe('UTC-05:00');
    expect(utcOffsetLabel('Asia/Kolkata', Date.parse('2026-10-03T10:00:00Z'))).toBe('UTC+05:30');
  });
});

describe('a connector card next run', () => {
  it('reads the instant of a scheduled connector', () => {
    expect(readNextRun({ cadence: 'every_6_hours', nextRunAt: '2026-10-03T18:00:00.000Z' }))
      .toEqual({ kind: 'at', at: '2026-10-03T18:00:00.000Z' });
  });

  it('reads a connector on manual only as manual', () => {
    expect(readNextRun({ cadence: 'manual', nextRunAt: null })).toEqual({ kind: 'manual' });
  });

  it('reads nothing for a live stream', () => {
    expect(readNextRun(null)).toEqual({ kind: 'none' });
  });

  it('reads nothing for a scheduled connector that cannot run yet', () => {
    expect(readNextRun({ cadence: 'daily', nextRunAt: null })).toEqual({ kind: 'none' });
  });
});
