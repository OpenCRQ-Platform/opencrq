import type { ScenarioBuildHistory } from './review-build-history';

const DAY_MS = 86_400_000;

/** What the run history is read over at most. */
export const MAX_REVIEW_WINDOW_DAYS = 731;

export interface ScenarioAleSeries {
  scenarioId: string,
  series: ReadonlyArray<{ date: string, aleMean: number | null }>,
}

export interface RiskPoint {
  date: string,
  ale: number,
  /** The scope without the period's build work. Null when no scenario carries a build history. */
  without: number | null,
}

const dayTimestamp = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

/**
 * Days back from `today` in UTC, today included, that reach the start of the review's period. A
 * period that started more than two years ago is cut at the limit, so its curve begins where the
 * history it reads does.
 */
export const reviewWindowDays = (periodStart: string, today: Date): number => {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.floor((end - dayTimestamp(periodStart)) / DAY_MS) + 1;
  return Math.max(1, Math.min(MAX_REVIEW_WINDOW_DAYS, days));
};

const lastOnOrBefore = <T extends { date: string }>(points: ReadonlyArray<T>, date: string): T | undefined => {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].date <= date) {
      return points[index];
    }
  }
  return undefined;
};

/**
 * The scope's ALE day by day: each scenario holds its last reading until its next run, and a day
 * sums what every scenario holds. A scenario no run has priced yet adds nothing rather than a zero
 * it was never measured at. Days outside `[from, to]` are dropped, and the readings before `from`
 * open the series on `from` itself. Each scenario's series is ascending by date.
 */
export const scopeAleSeries = (
  scenarios: ReadonlyArray<Pick<ScenarioAleSeries, 'series'>>,
  from: string,
  to: string,
): Array<{ date: string, ale: number }> => {
  const dates = [...new Set(scenarios.flatMap((scenario) => scenario.series.map((point) => point.date)))]
    .filter((date) => date <= to)
    .sort();
  const held = new Map<number, number>();
  const cursors = scenarios.map(() => 0);
  const points: Array<{ date: string, ale: number }> = [];
  const sumHeld = (): number => [...held.values()].reduce((total, value) => total + value, 0);
  const pushHeld = (date: string): void => {
    if (held.size > 0) {
      points.push({ date, ale: sumHeld() });
    }
  };
  for (const date of dates) {
    if (date > from && points.length === 0) {
      pushHeld(from);
    }
    scenarios.forEach((scenario, index) => {
      while (cursors[index] < scenario.series.length && scenario.series[cursors[index]].date <= date) {
        const value = scenario.series[cursors[index]].aleMean;
        if (value !== null) {
          held.set(index, value);
        }
        cursors[index] += 1;
      }
    });
    if (date >= from) {
      pushHeld(date);
    }
  }
  if (points.length === 0) {
    pushHeld(from);
  }
  return points;
};

/**
 * The scope's ALE day by day, as `scopeAleSeries` reads it, and the scope without the period's build
 * work: a scenario adds its ALE raised by the last step on or before that day, and a scenario without
 * steps adds its ALE alone.
 */
export const scopeRiskSeries = (
  scenarios: ReadonlyArray<ScenarioAleSeries>,
  history: ReadonlyArray<Pick<ScenarioBuildHistory, 'riskScenarioId' | 'steps'>>,
  from: string,
  to: string,
): Array<RiskPoint> => {
  const stepsById = new Map(history.map((entry) => [entry.riskScenarioId, entry.steps]));
  const readings = scenarios.map((scenario) => ({
    readings: scenario.series.flatMap((point) => (point.aleMean === null ? [] : [{ date: point.date, ale: point.aleMean }])),
    steps: stepsById.get(scenario.scenarioId) ?? [],
  }));
  const priced = readings.some((scenario) => scenario.steps.length > 0);
  return scopeAleSeries(scenarios, from, to).map((point) => {
    let without = 0;
    for (const scenario of readings) {
      const ale = lastOnOrBefore(scenario.readings, point.date)?.ale;
      if (ale !== undefined) {
        without += ale * (1 + (lastOnOrBefore(scenario.steps, point.date)?.relativeReduction ?? 0));
      }
    }
    return { ...point, without: priced ? without : null };
  });
};

/** The run the steps are priced on, the latest when scenarios differ: null without any step. */
export const approximationPricedAt = (history: ReadonlyArray<Pick<ScenarioBuildHistory, 'pricedAt' | 'steps'>>): Date | null =>
  history.reduce<Date | null>((latest, { pricedAt, steps }) => {
    const at = steps.length === 0 ? null : pricedAt;
    return at === null || (latest !== null && latest >= at) ? latest : at;
  }, null);
