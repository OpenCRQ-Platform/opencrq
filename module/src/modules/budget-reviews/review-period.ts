import { newError } from '@app/utils';

/** Some floor is needed, since `Date.UTC` reads a year below 100 as 19xx: this one is arbitrary. */
const FIRST_REVIEW_YEAR = 2000;

const PERIOD_START_PATTERN = /^(\d{4})-(\d{2})-01$/;

const DAY_MS = 86_400_000;

const yearAndMonthOf = (periodStart: string): { year: number, month: number } | undefined => {
  const match = PERIOD_START_PATTERN.exec(periodStart);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : undefined;
};

/**
 * Whether a review can cover twelve months from this `YYYY-MM-DD`: the first day of a month, no later
 * than the current month in UTC and no earlier than January of `FIRST_REVIEW_YEAR`.
 */
export const isReviewPeriodStart = (periodStart: string, now: Date = new Date()): boolean => {
  const parsed = yearAndMonthOf(periodStart);
  if (parsed === undefined || parsed.year < FIRST_REVIEW_YEAR) {
    return false;
  }
  return parsed.year * 12 + parsed.month - 1 <= now.getUTCFullYear() * 12 + now.getUTCMonth();
};

/**
 * Both bounds of a review's twelve months, in UTC, the end exclusive: the same day twelve months
 * after the start. The posture at a bound is the one standing just before it.
 */
export const reviewPeriodBounds = (periodStart: string): { start: Date, end: Date } => {
  const parsed = yearAndMonthOf(periodStart);
  if (parsed === undefined) {
    throw newError('A review period starts on the first day of a month', { periodStart });
  }
  return {
    start: new Date(Date.UTC(parsed.year, parsed.month - 1, 1)),
    end: new Date(Date.UTC(parsed.year + 1, parsed.month - 1, 1)),
  };
};

/** The last day the period covers, as `YYYY-MM-DD`: the day before its exclusive end. */
export const reviewPeriodEnd = (periodStart: string): string =>
  new Date(reviewPeriodBounds(periodStart).end.getTime() - DAY_MS).toISOString().slice(0, 10);
