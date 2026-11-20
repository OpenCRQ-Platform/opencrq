import type { BudgetReviewStoredBasket } from './constants';

/** One `build`, `step` or `step-level` figure a run stored for a review at its current version. */
export interface BuildHistoryRow {
  runId: string,
  riskScenarioId: string,
  runCreatedAt: Date,
  basket: BudgetReviewStoredBasket,
  stepOn: string | null,
  aleReductionMean: number | null,
}

export interface ReferenceMeanRow {
  runId: string,
  mean: number,
}

/** A control's posture logged as changing. */
export interface PostureMove {
  capabilityId: string,
  movedAt: Date,
}

/** What one build line did on one day: the controls of it that moved, and whether no later day moved any. */
export interface BuildLineMove {
  lineId: string,
  capabilityIds: Array<string>,
  finished: boolean,
}

/** The build work of one UTC day. */
export interface BuildMoveDay {
  date: string,
  lines: Array<BuildLineMove>,
}

/** From `date` on, what the build work done by then removes, as a share of the scenario's ALE. */
export interface BuildGapStep {
  date: string,
  relativeReduction: number,
}

export interface ScenarioBuildHistory {
  riskScenarioId: string,
  /** The run every step is priced on, the latest at the review's version, as its figures are. */
  pricedAt: Date,
  steps: Array<BuildGapStep>,
}

const DAY_MS = 86_400_000;

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

/** The midnight closing a `YYYY-MM-DD` day in UTC, the cutoff its end-of-day posture is read before. */
export const endOfDay = (date: string): Date => new Date(Date.parse(date) + DAY_MS);

/**
 * The days a control of a build line moved on, oldest first, each with the build lines it moved in
 * their order of `lines`. A control in two build lines moves both.
 */
export const buildMoveDays = (
  lines: ReadonlyArray<{ id: string, nature: string }>,
  controls: ReadonlyArray<{ lineId: string, capabilityId: string }>,
  moves: ReadonlyArray<PostureMove>,
): Array<BuildMoveDay> => {
  const buildLineIds = lines.filter((line) => line.nature === 'build').map((line) => line.id);
  const lineIdsByControl = Map.groupBy(
    controls.filter((control) => buildLineIds.includes(control.lineId)),
    (control: { lineId: string, capabilityId: string }) => control.capabilityId,
  );
  const byDay = new Map<string, Map<string, Set<string>>>();
  for (const { capabilityId, movedAt } of moves) {
    for (const { lineId } of lineIdsByControl.get(capabilityId) ?? []) {
      const date = dayOf(movedAt);
      const day = byDay.get(date) ?? new Map<string, Set<string>>();
      byDay.set(date, day.set(lineId, (day.get(lineId) ?? new Set<string>()).add(capabilityId)));
    }
  }
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b));
  const lastDayByLine = new Map(days.flatMap(([date, day]) => [...day.keys()].map((lineId) => [lineId, date] as const)));
  return days.map(([date, day]) => ({
    date,
    lines: buildLineIds.flatMap((lineId) => {
      const capabilityIds = day.get(lineId);
      return capabilityIds === undefined ? [] : [{ lineId, capabilityIds: [...capabilityIds].sort(), finished: lastDayByLine.get(lineId) === date }];
    }),
  }));
};

interface PricedRun {
  runId: string,
  createdAt: Date,
  build: number | null,
  figures: Map<string, number>,
}

const runsOf = (rows: ReadonlyArray<BuildHistoryRow>): Map<string, Array<PricedRun>> => {
  const byScenario = new Map<string, Array<PricedRun>>();
  const byRun = new Map<string, PricedRun>();
  for (const row of rows) {
    let run = byRun.get(row.runId);
    if (run === undefined) {
      run = { runId: row.runId, createdAt: row.runCreatedAt, build: null, figures: new Map() };
      byRun.set(row.runId, run);
      byScenario.set(row.riskScenarioId, [...byScenario.get(row.riskScenarioId) ?? [], run]);
    }
    if (row.aleReductionMean === null) {
      continue;
    }
    if (row.basket === 'build') {
      run.build = row.aleReductionMean;
    } else if (row.stepOn !== null) {
      run.figures.set(`${row.basket}:${row.stepOn}`, row.aleReductionMean);
    }
  }
  return byScenario;
};

/** The step a day before the last one was priced as, null when the run did not price it. */
const stepRatioOf = (run: PricedRun, reference: number, date: string): number | null => {
  const gap = run.figures.get(`step:${date}`);
  const level = run.figures.get(`step-level:${date}`);
  return gap === undefined || level === undefined || reference + level <= 0 ? null : gap / (reference + level);
};

/**
 * Each scenario's build gap over the period, on its latest run: from each move day but the last, the
 * gap that run priced on that day's posture over the ALE there, and from the last one on, the build
 * figure over the reference ALE. Rows must come oldest run first. A day the run did not price, a move
 * logged since, keeps the step before it until the next run.
 */
export const buildHistoryOf = (
  rows: ReadonlyArray<BuildHistoryRow>,
  references: ReadonlyArray<ReferenceMeanRow>,
  days: ReadonlyArray<{ date: string }>,
): Array<ScenarioBuildHistory> => {
  const referenceByRun = new Map(references.map((row) => [row.runId, row.mean]));
  return [...runsOf(rows)].flatMap(([riskScenarioId, runs]) => {
    const run = runs.findLast((candidate) => candidate.build !== null);
    const reference = run === undefined ? undefined : referenceByRun.get(run.runId);
    if (run === undefined || run.build === null || reference === undefined || reference <= 0) {
      return [];
    }
    const { build } = run;
    const steps = days.flatMap(({ date }, index): Array<BuildGapStep> => {
      const relativeReduction = index === days.length - 1 ? build / reference : stepRatioOf(run, reference, date);
      return relativeReduction === null ? [] : [{ date, relativeReduction }];
    });
    return [{ riskScenarioId, pricedAt: run.createdAt, steps }];
  });
};
