import { i18n } from '@lingui/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { firstDayOfWeek, formatDate, formatDateWith, formatDurationMs, formatLogTimestamp, formatRelativeTime, formatRfc3339, formatTimestamp, formatTimeUntil, msBetween, parseCalendarDate, toCalendarDate } from './date-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NOW = new Date('2026-08-10T12:00:00.000Z');

const at = (offsetMs: number): Date => new Date(NOW.getTime() - offsetMs);

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const freeze = () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
};

describe('formatRelativeTime', () => {
  it('should read as a phrase that can sit inside a sentence', () => {
    freeze();
    expect(formatRelativeTime(at(70 * DAY))).toBe('2 months ago');
  });

  it('should name the largest unit that fits', () => {
    freeze();
    expect(formatRelativeTime(at(30 * SECOND))).toBe('now');
    expect(formatRelativeTime(at(5 * MINUTE))).toBe('5 minutes ago');
    expect(formatRelativeTime(at(3 * HOUR))).toBe('3 hours ago');
    expect(formatRelativeTime(at(3 * DAY))).toBe('3 days ago');
    expect(formatRelativeTime(at(14 * DAY))).toBe('2 weeks ago');
    expect(formatRelativeTime(at(400 * DAY))).toBe('last year');
  });

  it('should say yesterday rather than one day ago', () => {
    freeze();
    expect(formatRelativeTime(at(DAY + HOUR))).toBe('yesterday');
  });

  it('should accept an ISO string as well as a date', () => {
    freeze();
    expect(formatRelativeTime(at(3 * DAY).toISOString())).toBe('3 days ago');
  });
});

describe('formatTimeUntil', () => {
  const ahead = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

  it('should name the largest unit that fits, ahead of now', () => {
    freeze();
    expect(formatTimeUntil(ahead(5 * MINUTE))).toBe('in 5 minutes');
    expect(formatTimeUntil(ahead(4 * HOUR))).toBe('in 4 hours');
    expect(formatTimeUntil(ahead(3 * DAY))).toBe('in 3 days');
    expect(formatTimeUntil(ahead(7 * DAY))).toBe('next week');
  });

  it('should read a slot on the hour as that hour when read a little early', () => {
    freeze();
    expect(formatTimeUntil(ahead(4 * HOUR - 20 * SECOND))).toBe('in 4 hours');
  });

  it('should say tomorrow rather than in one day', () => {
    freeze();
    expect(formatTimeUntil(ahead(DAY + HOUR))).toBe('tomorrow');
  });

  it('should read a date already past as now', () => {
    freeze();
    expect(formatTimeUntil(at(5 * MINUTE))).toBe('now');
  });
});

describe('formatTimestamp', () => {
  it('should keep its compact form under a day', () => {
    freeze();
    expect(formatTimestamp(at(30 * SECOND))).toBe('Just now');
    expect(formatTimestamp(at(5 * MINUTE))).toBe('5m ago');
    expect(formatTimestamp(at(3 * HOUR))).toBe('3h ago');
  });

  it('should hand over to the relative phrase past a day', () => {
    freeze();
    expect(formatTimestamp(at(3 * DAY))).toBe('3 days ago');
    expect(formatTimestamp(at(70 * DAY))).toBe('2 months ago');
  });

  it('should treat the boundary at 24 hours', () => {
    freeze();
    expect(formatTimestamp(at(23 * HOUR))).toBe('23h ago');
    expect(formatTimestamp(at(25 * HOUR))).toBe('yesterday');
  });
});

describe('formatLogTimestamp', () => {
  it('should pad every field so the column stays aligned', () => {
    expect(formatLogTimestamp(new Date(2026, 8, 1, 9, 2, 4, 7)))
      .toMatch(/^2026-09-01 09:02:04\.007 [+-]\d{2}:\d{2}$/);
  });

  it('should read the clock on 24 hours', () => {
    expect(formatLogTimestamp(new Date(2026, 8, 1, 14, 32, 7, 418)))
      .toMatch(/^2026-09-01 14:32:07\.418 [+-]\d{2}:\d{2}$/);
  });

  it('should name the offset the reader is being shown', () => {
    const moment = new Date(2026, 8, 1, 14, 32, 7, 418);
    const shown = formatLogTimestamp(moment).slice(-6);

    expect(new Date(`2026-09-01T14:32:07.418${shown}`).getTime()).toBe(moment.getTime());
  });

  it('should write a zone ahead of UTC, minutes included', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330);

    expect(formatLogTimestamp(new Date(2026, 8, 1, 14, 32, 7, 418))).toMatch(/\+05:30$/);
  });

  it('should write a zone behind UTC with its sign', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300);

    expect(formatLogTimestamp(new Date(2026, 8, 1, 14, 32, 7, 418))).toMatch(/-05:00$/);
  });
});

describe('formatRfc3339', () => {
  it('should hold the same instant as the log line, in a parseable form', () => {
    const moment = new Date(2026, 8, 1, 14, 32, 7, 418);
    const formatted = formatRfc3339(moment);

    expect(formatted).toMatch(/^2026-09-01T14:32:07\.418[+-]\d{2}:\d{2}$/);
    expect(new Date(formatted).getTime()).toBe(moment.getTime());
  });

  it('should carry the offset with no separator before it', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330);

    expect(formatRfc3339(new Date(2026, 8, 1, 14, 32, 7, 418))).toMatch(/T14:32:07\.418\+05:30$/);
  });
});

describe('parseCalendarDate', () => {
  it('should read a calendar date as that very day, locally', () => {
    const parsed = parseCalendarDate('2027-02-17');

    expect(parsed?.getFullYear()).toBe(2027);
    expect(parsed?.getMonth()).toBe(1);
    expect(parsed?.getDate()).toBe(17);
  });

  it('should decline anything that is not a calendar date', () => {
    expect(parseCalendarDate('2027-02-17T08:00:00Z')).toBeNull();
    expect(parseCalendarDate('')).toBeNull();
  });
});

describe('toCalendarDate', () => {
  it('should round-trip a calendar date through the picker', () => {
    expect(toCalendarDate(new Date(2026, 8, 17))).toBe('2026-09-17');
  });
});

describe('formatDate', () => {
  it('should print a calendar date as the day it names, never the one before', () => {
    expect(formatDate('2027-02-17')).toBe('Feb 17, 2027');
  });
});

describe('formatDateWith', () => {
  it('should print the parts the options ask for, in the application language', () => {
    const april = Date.UTC(2025, 3, 1);
    expect(formatDateWith(april, { month: 'long', year: 'numeric', timeZone: 'UTC' })).toBe('April 2025');
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatDateWith(april, { month: 'long', year: 'numeric', timeZone: 'UTC' })).toBe('avril 2025');
    i18n.activate('en');
  });
});

describe('formatDurationMs', () => {
  it('should read minutes and seconds, padded, between two instants', () => {
    expect(formatDurationMs(msBetween('2026-08-10T12:00:00.000Z', '2026-08-10T12:03:07.000Z'))).toBe('3m 07s');
  });

  it('should read null while the run has not started', () => {
    expect(formatDurationMs(msBetween(null, '2026-08-10T12:03:07.000Z'))).toBeNull();
  });

  it('should read null while the run has not finished', () => {
    expect(formatDurationMs(msBetween('2026-08-10T12:00:00.000Z', null))).toBeNull();
  });
  it('should read null for null', () => {
    expect(formatDurationMs(null)).toBeNull();
  });

  it('should read seconds alone under a minute', () => {
    expect(formatDurationMs(12_000)).toBe('12s');
  });

  it('should read minutes and padded seconds under an hour', () => {
    expect(formatDurationMs(187_000)).toBe('3m 07s');
  });

  it('should read hours and padded minutes past an hour', () => {
    expect(formatDurationMs(4_320_000)).toBe('1h 12m');
  });

  it('should floor a negative duration at zero, a clock drift never reading as negative', () => {
    expect(formatDurationMs(-500)).toBe('0s');
  });
});

describe('firstDayOfWeek', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should follow the locale data of the runtime, whatever the language', () => {
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('fr')).toBe(1);
    expect(firstDayOfWeek('de')).toBe(1);
    expect(firstDayOfWeek('ar')).toBe(6);
    expect(firstDayOfWeek('he')).toBe(0);
  });

  it('should read the region of the tag, as one language does not fix the week', () => {
    expect(firstDayOfWeek('en-GB')).toBe(1);
    expect(firstDayOfWeek('en-US')).toBe(0);
  });

  it('should read the accessor older engines ship in place of the method', () => {
    class LegacyLocale {
      weekInfo = { firstDay: 1 };
    }
    vi.stubGlobal('Intl', { ...Intl, Locale: LegacyLocale });
    expect(firstDayOfWeek('fr')).toBe(1);
  });

  it('should say nothing where the runtime cannot', () => {
    vi.stubGlobal('Intl', { ...Intl, Locale: class {} });
    expect(firstDayOfWeek('fr')).toBeUndefined();
  });
});
