import type { SeverityBand } from '../finding-score/bands';
import { SEVERITY_BANDS } from '../finding-score/bands';

/** A finding no recompute has scored yet has no band: it counts in the total and in no row. */
export type PaceBandKey = SeverityBand | 'unscored';

/** `day` is null for everything before the horizon, which only seeds the open count. */
export interface FindingCreationBucket {
  band: PaceBandKey,
  day: string | null,
  count: number,
  firstDay: string,
}

export interface FindingTransitionBucket {
  band: PaceBandKey,
  day: string | null,
  kind: 'closed' | 'reopened',
  count: number,
}

/** `band` null is the row over every band. */
export interface TimeOpenRow {
  band: PaceBandKey | null,
  medianDays: number | null,
  meanDays: number | null,
}

export interface RemediationPaceMonth {
  /** `YYYY-MM`, UTC. */
  month: string,
  newCount: number,
  closedCount: number,
  openAtEnd: number,
}

export interface RemediationPaceFigures {
  newInWindow: number,
  closedInWindow: number,
  newPerMonth: number,
  closedPerMonth: number,
  capacityPerMonth: number,
  /** Null when nothing was ever closed, so there is no capacity to divide by. */
  occupancy: number | null,
  openCount: number,
  openAtWindowStart: number,
  /** Over the findings closed in the window, from the day they (re)opened to the day they closed. */
  medianDaysOpen: number | null,
  meanDaysOpen: number | null,
  /** The last full months, oldest first, each month's new findings over today's capacity. */
  occupancyHistory: Array<number | null>,
  /** The last twelve full months, oldest first. */
  months: Array<RemediationPaceMonth>,
}

export interface RemediationPace {
  windowDays: number,
  /** `YYYY-MM-DD`, null while the scope holds no finding at all. */
  measurableFrom: string | null,
  measurable: boolean,
  total: RemediationPaceFigures,
  bands: Array<{ band: SeverityBand } & RemediationPaceFigures>,
}

export const DAYS_PER_MONTH = 365.25 / 12;
const HISTORY_MONTHS = 12;
const CAPACITY_SPAN_MONTHS = 3;
const MIN_HISTORY_MONTHS = 2;
const OCCUPANCY_HISTORY_MONTHS = 6;

const monthStart = (now: Date, offset: number): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));

/** First day of the oldest of the twelve full months the series covers. */
export const remediationPaceHorizon = (now: Date): Date => monthStart(now, -HISTORY_MONTHS);

const toDayKey = (date: Date): string => date.toISOString().slice(0, 10);

/** Clamped to the target month's last day, so 31 December plus two months is 28 or 29 February. */
const addMonths = (dayKey: string, months: number): string => {
  const [year, month, day] = dayKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return toDayKey(new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))));
};

interface DayFlow {
  created: number,
  closed: number,
  reopened: number,
}

interface Ledger {
  openBeforeHorizon: number,
  days: Map<string, DayFlow>,
}

const emptyLedger = (): Ledger => ({ openBeforeHorizon: 0, days: new Map() });

const record = (ledger: Ledger, day: string | null, field: keyof DayFlow, count: number): void => {
  const sign = field === 'closed' ? -1 : 1;
  if (day === null) {
    ledger.openBeforeHorizon += sign * count;
    return;
  }
  const flow = ledger.days.get(day) ?? { created: 0, closed: 0, reopened: 0 };
  flow[field] += count;
  ledger.days.set(day, flow);
};

interface PaceCalendar {
  windowDays: number,
  windowStartDay: string,
  months: Array<string>,
  /** `YYYY-MM`: the month of the first finding when it came on the 1st, else the month after. */
  firstFullMonth: string | null,
}

const sumDays = (ledger: Ledger, field: keyof DayFlow, from: string, until: string): number => {
  let sum = 0;
  for (const [day, flow] of ledger.days) {
    if (day >= from && day < until) {
      sum += flow[field];
    }
  }
  return sum;
};

const openBefore = (ledger: Ledger, until: string): number => {
  let open = ledger.openBeforeHorizon;
  for (const [day, flow] of ledger.days) {
    if (day < until) {
      open += flow.created + flow.reopened - flow.closed;
    }
  }
  return open;
};

/**
 * Never reads a month the scope did not hold findings for in full: an earlier month would pass for
 * one without closure, and the month of the first finding for a slow one.
 */
const closingCapacity = (months: Array<RemediationPaceMonth>, firstFullMonth: string | null): number => {
  const eligible = firstFullMonth === null ? [] : months.filter((month) => month.month >= firstFullMonth);
  const span = Math.min(CAPACITY_SPAN_MONTHS, eligible.length);
  let best = 0;
  for (let start = 0; span > 0 && start + span <= eligible.length; start += 1) {
    const closed = eligible.slice(start, start + span).reduce((sum, month) => sum + month.closedCount, 0);
    best = Math.max(best, closed / span);
  }
  return best;
};

const figuresOf = (ledger: Ledger, timeOpen: TimeOpenRow | undefined, calendar: PaceCalendar): RemediationPaceFigures => {
  const months = calendar.months.map((month, index) => {
    const from = `${month}-01`;
    const until = index + 1 < calendar.months.length ? `${calendar.months[index + 1]}-01` : addMonths(from, 1);
    return {
      month,
      newCount: sumDays(ledger, 'created', from, until),
      closedCount: sumDays(ledger, 'closed', from, until),
      openAtEnd: openBefore(ledger, until),
    };
  });
  const capacityPerMonth = closingCapacity(months, calendar.firstFullMonth);
  const windowMonths = calendar.windowDays / DAYS_PER_MONTH;
  const newInWindow = sumDays(ledger, 'created', calendar.windowStartDay, '9999-12-31');
  const closedInWindow = sumDays(ledger, 'closed', calendar.windowStartDay, '9999-12-31');
  const newPerMonth = newInWindow / windowMonths;
  return {
    newInWindow,
    closedInWindow,
    newPerMonth,
    closedPerMonth: closedInWindow / windowMonths,
    capacityPerMonth,
    occupancy: capacityPerMonth > 0 ? newPerMonth / capacityPerMonth : null,
    openCount: openBefore(ledger, '9999-12-31'),
    openAtWindowStart: openBefore(ledger, calendar.windowStartDay),
    medianDaysOpen: timeOpen?.medianDays ?? null,
    meanDaysOpen: timeOpen?.meanDays ?? null,
    occupancyHistory: months
      .slice(-OCCUPANCY_HISTORY_MONTHS)
      .map((month) => (capacityPerMonth > 0 ? month.newCount / capacityPerMonth : null)),
    months,
  };
};

/**
 * Capacity is the best closing rate held over three consecutive full months, not the current one:
 * in a steady state closures equal arrivals, so arrivals over closures would always read 100 %.
 * Below three full months of history it spans the full months there are, two once measurable.
 * A reopened finding counts as open again, never as new.
 */
export const buildRemediationPace = (
  { creations, transitions, timeOpen, now, windowStart, windowDays }: {
    creations: Array<FindingCreationBucket>,
    transitions: Array<FindingTransitionBucket>,
    timeOpen: Array<TimeOpenRow>,
    now: Date,
    windowStart: Date,
    windowDays: number,
  },
): RemediationPace => {
  const ledgers = new Map<PaceBandKey, Ledger>();
  const total = emptyLedger();
  const ledgerOf = (band: PaceBandKey): Ledger => {
    const ledger = ledgers.get(band) ?? emptyLedger();
    ledgers.set(band, ledger);
    return ledger;
  };
  for (const bucket of creations) {
    record(ledgerOf(bucket.band), bucket.day, 'created', bucket.count);
    record(total, bucket.day, 'created', bucket.count);
  }
  for (const bucket of transitions) {
    record(ledgerOf(bucket.band), bucket.day, bucket.kind, bucket.count);
    record(total, bucket.day, bucket.kind, bucket.count);
  }

  const firstDay = creations.reduce<string | null>(
    (first, bucket) => (first === null || bucket.firstDay < first ? bucket.firstDay : first),
    null,
  );
  const firstFullMonthDay = firstDay === null ? null : firstDay.endsWith('-01') ? firstDay : addMonths(`${firstDay.slice(0, 7)}-01`, 1);
  const measurableFrom = firstFullMonthDay === null ? null : addMonths(firstFullMonthDay, MIN_HISTORY_MONTHS);
  const calendar: PaceCalendar = {
    windowDays,
    windowStartDay: toDayKey(windowStart),
    months: Array.from({ length: HISTORY_MONTHS }, (_, index) => toDayKey(monthStart(now, index - HISTORY_MONTHS)).slice(0, 7)),
    firstFullMonth: firstFullMonthDay?.slice(0, 7) ?? null,
  };
  const timeOpenOf = (band: PaceBandKey | null) => timeOpen.find((row) => row.band === band);

  return {
    windowDays,
    measurableFrom,
    measurable: measurableFrom !== null && toDayKey(now) >= measurableFrom,
    total: figuresOf(total, timeOpenOf(null), calendar),
    bands: SEVERITY_BANDS.map((band) => ({
      band,
      ...figuresOf(ledgers.get(band) ?? emptyLedger(), timeOpenOf(band), calendar),
    })),
  };
};
