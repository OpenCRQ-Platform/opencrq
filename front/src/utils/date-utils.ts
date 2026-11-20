import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A date the API stores as a calendar day, read as that day here. `new Date('2027-02-17')` is UTC
 * midnight, which every timezone west of Greenwich prints as the 16th.
 */
export const parseCalendarDate = (value: string): Date | null => {
  const parts = CALENDAR_DATE.exec(value);
  if (parts === null) {
    return null;
  }
  const at = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return Number.isNaN(at.getTime()) ? null : at;
};

/** Date-only formatter: "12 Jan 2025" */
export const formatDate = (date: string | Date): string =>
  (typeof date === 'string' ? parseCalendarDate(date) ?? new Date(date) : date)
    .toLocaleDateString(i18n.locale || 'en', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

/** A month's own name, 1 to 12: "April" */
export const formatMonthName = (month: number): string => {
  const name = new Date(2000, month - 1, 1).toLocaleDateString(i18n.locale || 'en', { month: 'long' });
  return name.charAt(0).toLocaleUpperCase(i18n.locale || 'en') + name.slice(1);
};

/** A calendar day's month and year: "Apr 2025" */
export const formatMonthYear = (date: string): string =>
  (parseCalendarDate(date) ?? new Date(date)).toLocaleDateString(i18n.locale || 'en', { month: 'short', year: 'numeric' });

/** Full datetime formatter: "12 Jan 2025, 14:32:07" */
export const formatDateTime = (date: string | Date): string =>
  new Date(date).toLocaleString(i18n.locale || 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** "12 Jan 2025, 14:32" */
export const formatDateMinute = (date: string | Date, timeZone?: string): string =>
  new Date(date).toLocaleString(i18n.locale || 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });

/** "14:32" */
export const formatTimeOfDay = (date: string | Date): string =>
  new Date(date).toLocaleTimeString(i18n.locale || 'en', { hour: '2-digit', minute: '2-digit' });

/** A date with the parts `options` asks for, in the application language: `{ month: 'long', year: 'numeric' }` reads "April 2025". */
export const formatDateWith = (date: string | number | Date, options: Intl.DateTimeFormatOptions): string =>
  new Date(date).toLocaleDateString(i18n.locale || 'en', options);

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

// eslint-disable-next-line no-restricted-syntax -- reads the browser's time zone, formats nothing
export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

// Older engines ship the `weekInfo` accessor in place of the standard method, and the library types do not know it.
const weekInfoOf = (tag: string): unknown => {
  const locale = new Intl.Locale(tag);
  return 'getWeekInfo' in locale ? locale.getWeekInfo() : Reflect.get(locale, 'weekInfo');
};

/**
 * The day a week starts on in a locale, 0 for Sunday to 6 for Saturday, from the runtime's own locale
 * data so a language added later needs no entry here. Undefined where the runtime cannot say.
 */
export const firstDayOfWeek = (tag: string): (typeof WEEK_DAYS)[number] | undefined => {
  const info = weekInfoOf(tag);
  if (typeof info !== 'object' || info === null || !('firstDay' in info) || typeof info.firstDay !== 'number') {
    return undefined;
  }
  const { firstDay } = info;
  return WEEK_DAYS.find((day) => day === firstDay % 7);
};

/** The calendar day a local reading falls on, in the form the API stores. */
export const toCalendarDate = (at: Date): string =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

const localTime = (at: Date): string =>
  `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;

/** What turns a local reading into an instant, as "+02:00". */
const utcOffset = (at: Date): string => {
  const minutes = -at.getTimezoneOffset();
  const magnitude = `${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
  if (minutes < 0) {
    return `-${magnitude}`;
  }
  return `+${magnitude}`;
};

/**
 * Log-line formatter: "2026-09-01 14:32:07.418 +02:00", in local time, same shape in every locale. A
 * stream connector logs for days under one header, so the day belongs on the line; the milliseconds
 * are there because retries land inside the same second and a log whose lines share a timestamp
 * cannot be read in order.
 */
export const formatLogTimestamp = (date: string | Date): string => {
  const at = new Date(date);
  return `${toCalendarDate(at)} ${localTime(at)} ${utcOffset(at)}`;
};

/** The same instant as RFC 3339, for anything that will be parsed rather than read. */
export const formatRfc3339 = (date: string | Date): string => {
  const at = new Date(date);
  return `${toCalendarDate(at)}T${localTime(at)}${utcOffset(at)}`;
};

const DAY_MS = 86_400_000;

/** Whole days elapsed since a date, floored at zero so a clock skew never reads as negative. */
export const daysSince = (date: string | Date | null, now: Date = new Date()): number | null => {
  if (date === null) {
    return null;
  }
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - target.getTime()) / DAY_MS));
};

export const formatRelativeTime = (date: string | Date): string => {
  const target = new Date(date);
  const elapsedMs = Date.now() - target.getTime();
  const format = new Intl.RelativeTimeFormat(i18n.locale || 'en', { numeric: 'auto' });

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return format.format(0, 'second');
  }
  if (minutes < 60) {
    return format.format(-minutes, 'minute');
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return format.format(-hours, 'hour');
  }
  const days = Math.floor(elapsedMs / DAY_MS);
  if (days < 7) {
    return format.format(-days, 'day');
  }
  if (days < 30) {
    return format.format(-Math.floor(days / 7), 'week');
  }
  if (days < 365) {
    return format.format(-Math.floor(days / 30), 'month');
  }
  return format.format(-Math.floor(days / 365), 'year');
};

/**
 * Rounded rather than floored: a slot on the hour, read a few seconds early, still reads as that
 * hour. A date already past reads as now.
 */
export const formatTimeUntil = (date: string | Date): string => {
  const aheadMs = new Date(date).getTime() - Date.now();
  const format = new Intl.RelativeTimeFormat(i18n.locale || 'en', { numeric: 'auto' });

  const minutes = Math.round(aheadMs / 60_000);
  if (minutes < 1) {
    return format.format(0, 'second');
  }
  if (minutes < 60) {
    return format.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return format.format(hours, 'hour');
  }
  const days = Math.round(aheadMs / DAY_MS);
  if (days < 7) {
    return format.format(days, 'day');
  }
  return format.format(Math.round(days / 7), 'week');
};

export const formatTimestamp = (date: string | Date): string => {
  const target = new Date(date);
  const seconds = Math.floor((Date.now() - target.getTime()) / 1000);

  if (seconds < 60) {
    return t`Just now`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t`${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t`${hours}h ago`;
  }
  return formatRelativeTime(target);
};

/** Milliseconds between two instants, null while either edge is missing, a run in progress having no end yet. Floored at zero to absorb clock drift. */
export const msBetween = (from: string | Date | null, to: string | Date | null): number | null => {
  if (from === null || to === null) {
    return null;
  }
  return Math.max(0, new Date(to).getTime() - new Date(from).getTime());
};

/**
 * A duration already in milliseconds (e.g. from `runTimings` or `msBetween`), read at whichever
 * grain its size calls for: seconds alone under a minute, minutes and seconds under an hour, hours
 * and minutes beyond.
 */
export const formatDurationMs = (ms: number | null): string | null => {
  if (ms === null) {
    return null;
  }
  const elapsed = Math.max(0, Math.round(ms / 1000));
  if (elapsed < 60) {
    return t`${elapsed}s`;
  }
  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, '0');
  if (minutes < 60) {
    return t`${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = String(minutes % 60).padStart(2, '0');
  return t`${hours}h ${remainingMinutes}m`;
};
