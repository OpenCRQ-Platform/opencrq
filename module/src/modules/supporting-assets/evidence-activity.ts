/** A run of days a number of findings stayed applicable: from `fromDay` until the day before `toDay`, or still open. */
export interface ApplicableSpan {
  fromDay: string,
  toDay: string | null,
  findings: number,
}

export interface EvidenceActivityDay {
  day: string,
  count: number,
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day `at` falls on in `timeZone`, as `YYYY-MM-DD`. */
export const calendarDayIn = (timeZone: string, at: Date): string => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/** `days` calendar days after `day`, both `YYYY-MM-DD`: plain calendar arithmetic, no time zone involved. */
export const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The `length` days ending on `lastDay`, oldest first. */
export const daysEndingOn = (lastDay: string, length: number): Array<string> =>
  Array.from({ length }, (_, index) => shiftDay(lastDay, index - length + 1));

/**
 * The applicable count of each of `days`, which must be consecutive: a span adds its findings on the
 * day it opens and takes them back on the day it ends. A span opening before the first day is
 * expected to arrive clamped to it.
 */
export const countSpansByDay = (spans: ReadonlyArray<ApplicableSpan>, days: ReadonlyArray<string>): Array<EvidenceActivityDay> => {
  const moves = new Map<string, number>();
  for (const span of spans) {
    moves.set(span.fromDay, (moves.get(span.fromDay) ?? 0) + span.findings);
    if (span.toDay !== null) {
      moves.set(span.toDay, (moves.get(span.toDay) ?? 0) - span.findings);
    }
  }
  let count = 0;
  return days.map((day) => {
    count += moves.get(day) ?? 0;
    return { day, count };
  });
};
