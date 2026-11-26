/**
 * The exposure series over a caller-chosen window: on each sampled day, the sum over scenarios of
 * the latest mean up to that day.
 *
 * The carry-forward is deliberately identical to `buildDailyTrendSeries`: a newer run whose column
 * is null does NOT reset the carry, so this chart stays in step with the counters above it. The
 * total is a sum of means and carries no band: adding per-scenario p10s and p90s would treat the
 * scenarios as if they moved together, which overstates the spread of the total.
 */

const DAY_MS = 86_400_000;
const DAY_GRANULARITY_MAX_DAYS = 120;
const WEEK_GRANULARITY_MAX_DAYS = 400;
/** What the axis can hold, whatever the history: the response never grows past it. */
export const MAX_AXIS_POINTS = 420;

export interface ExposureBandDay {
  /** UTC day key, `YYYY-MM-DD`. One of the sampled days of the axis, not every day. */
  date: string,
  aleMean: number | null,
  lefMean: number | null,
}

const toDayKey = (time: number): string => new Date(time).toISOString().slice(0, 10);

const startOfUtcDay = (time: number): number => Math.floor(time / DAY_MS) * DAY_MS;

/**
 * Coarser steps lose nothing: the carry-forward is a step function, so a wider step samples the
 * same staircase less often rather than averaging anything away.
 */
const stepFor = (spanDays: number): 'day' | 'week' | 'month' => {
  if (spanDays <= DAY_GRANULARITY_MAX_DAYS) {
    return 'day';
  }
  return spanDays <= WEEK_GRANULARITY_MAX_DAYS ? 'week' : 'month';
};

/**
 * The sampled days, oldest first, the last one today.
 *
 * The start is clamped to the first run on file: asking for 12 months on a platform that began
 * simulating four months ago would otherwise open a wide empty region on the left. Walked backwards
 * from today so the newest sample is always ON the axis, whatever the step divides into.
 */
export const buildBandAxis = ({ windowDays, now, earliestRunTime }: {
  windowDays: number | null,
  now: number,
  earliestRunTime: number | null,
}): Array<string> => {
  if (earliestRunTime === null) {
    return [];
  }
  const today = startOfUtcDay(now);
  const requested = windowDays === null ? earliestRunTime : now - (windowDays - 1) * DAY_MS;
  const start = startOfUtcDay(Math.max(requested, earliestRunTime));
  const step = stepFor(Math.max(0, Math.round((today - start) / DAY_MS)));

  const keys: Array<string> = [];
  const cursor = new Date(today);
  while (cursor.getTime() >= start && keys.length < MAX_AXIS_POINTS) {
    keys.push(toDayKey(cursor.getTime()));
    if (step === 'month') {
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() - (step === 'week' ? 7 : 1));
    }
  }
  const startKey = toDayKey(start);
  if (keys.at(-1) !== startKey && keys.length < MAX_AXIS_POINTS) {
    keys.push(startKey);
  }
  return keys.reverse();
};

export interface ExposureBandSeed {
  riskScenarioId: string,
  aleMean: number | null,
  lefMean: number | null,
}

/** A scenario's last non-null means over the runs that fall between two sampled days. */
export interface ExposureBandBucket extends ExposureBandSeed {
  /** The first sampled day on or after the runs it holds: the position in `dayKeys`. */
  axisIndex: number,
}

/**
 * The seed is each scenario's last run before the window, which a scenario with no run inside it
 * still contributes: it has not gone to zero, it has simply not been re-run.
 */
export const buildExposureBandSeries = (
  dayKeys: ReadonlyArray<string>,
  seeds: ReadonlyArray<ExposureBandSeed>,
  buckets: ReadonlyArray<ExposureBandBucket>,
): Array<ExposureBandDay> => {
  const byScenario = new Map<string, Array<ExposureBandBucket>>();
  for (const row of [...seeds.map((seed) => ({ ...seed, axisIndex: 0 })), ...buckets.toSorted((a, b) => a.axisIndex - b.axisIndex)]) {
    const rows = byScenario.get(row.riskScenarioId) ?? [];
    rows.push(row);
    byScenario.set(row.riskScenarioId, rows);
  }

  const points: Array<ExposureBandDay> =dayKeys.map((date) => ({ date, aleMean: null, lefMean: null }));
  // Scenario ids in order: a float sum depends on the order it adds in.
  for (const [, rows] of [...byScenario].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    let next = 0;
    let ale: number | null = null;
    let lef: number | null = null;
    for (const [index, point] of points.entries()) {
      while (next < rows.length && rows[next].axisIndex <= index) {
        ale = rows[next].aleMean ?? ale;
        lef = rows[next].lefMean ?? lef;
        next += 1;
      }
      point.aleMean = ale === null ? point.aleMean : (point.aleMean ?? 0) + ale;
      point.lefMean = lef === null ? point.lefMean : (point.lefMean ?? 0) + lef;
    }
  }
  return points;
};
