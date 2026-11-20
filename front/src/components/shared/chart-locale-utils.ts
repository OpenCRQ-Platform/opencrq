import type { ApexOptions } from 'apexcharts';
import { DAYS_PER_WEEK } from './activity-chart-utils';

type ChartLocaleOptions = Pick<NonNullable<ApexOptions['chart']>, 'defaultLocale' | 'locales'>;

const MONTHS_PER_YEAR = 12;
// 2021-01-03 is a Sunday: ApexCharts indexes its day names from Sunday.
const FIRST_SUNDAY = Date.UTC(2021, 0, 3);
const DAY_MS = 86_400_000;
// The 15th falls in the same month in every time zone.
const MID_MONTH = 15;

const monthNames = (locale: string, width: 'long' | 'short'): Array<string> => {
  const format = new Intl.DateTimeFormat(locale, { month: width });
  return Array.from({ length: MONTHS_PER_YEAR }, (_, month) => format.format(Date.UTC(2021, month, MID_MONTH)));
};

const dayNames = (locale: string, width: 'long' | 'short'): Array<string> => {
  // UTC, because the reference Sunday is a UTC midnight: another zone would name the day before.
  const format = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' });
  return Array.from({ length: DAYS_PER_WEEK }, (_, day) => format.format(FIRST_SUNDAY + day * DAY_MS));
};

/**
 * The `chart` options that make ApexCharts write the names its date formats ask for (`MMM`, `MMMM`,
 * `ddd`, `dddd`) in `locale`. Without them it falls back to its built-in English names, whatever
 * the application language is.
 */
export const chartLocaleOptions = (locale: string): ChartLocaleOptions => ({
  defaultLocale: locale,
  locales: [{
    name: locale,
    options: {
      months: monthNames(locale, 'long'),
      shortMonths: monthNames(locale, 'short'),
      days: dayNames(locale, 'long'),
      shortDays: dayNames(locale, 'short'),
    },
  }],
});
