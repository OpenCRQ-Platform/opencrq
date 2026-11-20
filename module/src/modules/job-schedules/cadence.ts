/**
 * A closed list rather than cron: the UI can explain and validate each of these, which it could not
 * do for an arbitrary expression.
 */
export const SCHEDULE_CADENCES = ['manual', 'hourly', 'every_6_hours', 'every_12_hours', 'daily', 'weekly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];
export type RecurringCadence = Exclude<ScheduleCadence, 'manual'>;

export const CADENCE_INTERVAL_HOURS: Readonly<Record<RecurringCadence, number>> = {
  hourly: 1,
  every_6_hours: 6,
  every_12_hours: 12,
  daily: 24,
  weekly: 7 * 24,
};

export interface Schedule {
  cadence: ScheduleCadence,
  /** Minute of the day on the wall clock of `timeZone`, set for `daily` and `weekly` only. */
  atMinute: number | null,
  /** Day of the week in `timeZone`, 0 for Sunday as `Date.getDay` counts, set for `weekly` only. */
  weekday: number | null,
  /** IANA zone the time is read in, set for `daily` and `weekly` only. */
  timeZone: string | null,
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTES_PER_DAY = 24 * 60;

export const cadenceTakesTime = (cadence: ScheduleCadence): boolean => cadence === 'daily' || cadence === 'weekly';

export const cadenceTakesWeekday = (cadence: ScheduleCadence): boolean => cadence === 'weekly';

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

export const isWellFormedSchedule = ({ cadence, atMinute, weekday, timeZone }: Schedule): boolean => {
  const timeOk = cadenceTakesTime(cadence)
    ? atMinute !== null && Number.isInteger(atMinute) && atMinute >= 0 && atMinute < MINUTES_PER_DAY
      && timeZone !== null && isValidTimeZone(timeZone)
    : atMinute === null && timeZone === null;
  const weekdayOk = cadenceTakesWeekday(cadence)
    ? weekday !== null && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6
    : weekday === null;
  return timeOk && weekdayOk;
};

export const offeredCadences = (minIntervalHours: number): Array<ScheduleCadence> =>
  SCHEDULE_CADENCES.filter((cadence) => cadence === 'manual' || CADENCE_INTERVAL_HOURS[cadence] >= minIntervalHours);

const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

const wallClockFormat = (timeZone: string): Intl.DateTimeFormat => {
  let format = wallClockFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    wallClockFormats.set(timeZone, format);
  }
  return format;
};

/** The wall clock of `timeZone` at `ms`, written as if it were a UTC instant. */
const wallClockMs = (ms: number, timeZone: string): number => {
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(wallClockFormat(timeZone).formatToParts(ms).find((candidate) => candidate.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
};

/**
 * The instant the wall clock of `timeZone` reads `wallMs`. A time skipped by a daylight-saving
 * switch lands an hour later, and a time read twice lands on its second reading. The offsets a day
 * either side bracket the switch, which assumes a zone never changes offset twice within two days.
 */
const wallClockToInstant = (wallMs: number, timeZone: string): number => {
  const offsetAt = (ms: number): number => wallClockMs(ms, timeZone) - Math.floor(ms / 1000) * 1000;
  const before = wallMs - offsetAt(wallMs - DAY_MS);
  const after = wallMs - offsetAt(wallMs + DAY_MS);
  const read = [before, after].filter((candidate) => wallClockMs(candidate, timeZone) === wallMs);
  return read.length > 0 ? Math.max(...read) : before;
};

/**
 * The first slot strictly after `afterMs`, or null for a manual schedule. Slots sit on the clock,
 * never on the last run: the sub-daily cadences divide the UTC day from midnight, which the Unix
 * epoch also starts on, and a daily or weekly slot keeps its wall-clock time across a
 * daylight-saving switch.
 */
export const nextOccurrence = (schedule: Schedule, afterMs: number): Date | null => {
  const { cadence } = schedule;
  if (cadence === 'manual') {
    return null;
  }
  if (cadence === 'hourly' || cadence === 'every_6_hours' || cadence === 'every_12_hours') {
    const stepMs = CADENCE_INTERVAL_HOURS[cadence] * HOUR_MS;
    return new Date((Math.floor(afterMs / stepMs) + 1) * stepMs);
  }
  const timeZone = schedule.timeZone ?? 'UTC';
  const localDayStartMs = Math.floor(wallClockMs(afterMs, timeZone) / DAY_MS) * DAY_MS;
  // Up to seven days ahead: a weekly slot whose day is today but whose time has passed comes back in seven.
  for (let days = 0; days <= 7; days++) {
    const dayMs = localDayStartMs + days * DAY_MS;
    if (cadence === 'weekly' && new Date(dayMs).getUTCDay() !== schedule.weekday) {
      continue;
    }
    const slotMs = wallClockToInstant(dayMs + (schedule.atMinute ?? 0) * 60_000, timeZone);
    if (slotMs > afterMs) {
      return new Date(slotMs);
    }
  }
  return null;
};
