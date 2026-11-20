import type { Schedule, ScheduleCadence } from '@app/module/client';
import { cadenceTakesTime, cadenceTakesWeekday } from '@app/module/client';

/** What the drawer edits: the day and the time as the wall clock of `timeZone` reads them. */
export interface ScheduleFormFields {
  cadence: ScheduleCadence,
  /** 0 for Sunday, as `Date.getDay` counts. */
  weekday: number,
  /** `HH:MM` on a 24-hour clock. */
  time: string,
  timeZone: string,
}

const DEFAULT_WEEKDAY = 1;
const DEFAULT_TIME = '06:00';

const pad = (value: number): string => String(value).padStart(2, '0');

export const formatMinuteOfDay = (minute: number): string => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

const parseTime = (time: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};

/** A cadence that takes no time has no zone either, so the drawer offers `fallbackTimeZone` for it. */
export const toScheduleFields = (schedule: Schedule, fallbackTimeZone: string): ScheduleFormFields => ({
  cadence: schedule.cadence,
  weekday: schedule.weekday ?? DEFAULT_WEEKDAY,
  time: schedule.atMinute === null ? DEFAULT_TIME : formatMinuteOfDay(schedule.atMinute),
  timeZone: schedule.timeZone ?? fallbackTimeZone,
});

/** Null when the time is not a time. */
export const toSchedule = (fields: ScheduleFormFields): Schedule | null => {
  const { cadence } = fields;
  if (!cadenceTakesTime(cadence)) {
    return { cadence, atMinute: null, weekday: null, timeZone: null };
  }
  const atMinute = parseTime(fields.time);
  if (atMinute === null) {
    return null;
  }
  return { cadence, atMinute, weekday: cadenceTakesWeekday(cadence) ? fields.weekday : null, timeZone: fields.timeZone };
};

export const utcOffsetLabel = (timeZone: string, atMs: number): string => {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(atMs)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  return offset === 'GMT' ? 'UTC' : offset.replace('GMT', 'UTC');
};

/**
 * Every IANA zone the browser knows, labelled with its offset at `atMs`. `UTC` and `current` are
 * kept even where the browser's list leaves them out, so the saved zone always has its option.
 */
export const getTimeZoneOptions = (current: string, atMs: number): Array<{ value: string, label: string }> => {
  const zones = Intl.supportedValuesOf('timeZone');
  const all = [...new Set(['UTC', current, ...zones])];
  return all.map((timeZone) => ({
    value: timeZone,
    label: timeZone === 'UTC' ? timeZone : `${timeZone} (${utcOffsetLabel(timeZone, atMs)})`,
  }));
};

export type NextRunRead =
  | { kind: 'at', at: string }
  | { kind: 'manual' }
  /** A live stream, or a connector that cannot run yet. */
  | { kind: 'none' };

export const readNextRun = (schedule: { cadence: ScheduleCadence, nextRunAt: string | null } | null): NextRunRead => {
  if (schedule === null) {
    return { kind: 'none' };
  }
  if (schedule.cadence === 'manual') {
    return { kind: 'manual' };
  }
  return schedule.nextRunAt === null ? { kind: 'none' } : { kind: 'at', at: schedule.nextRunAt };
};
