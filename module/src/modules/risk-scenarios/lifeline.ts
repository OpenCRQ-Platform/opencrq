/**
 * How far back a lifeline reaches, and how many instants it is read at: from the scenario's first
 * quantified run of the past `LIFELINE_WINDOW_DAYS` days to now.
 */
export const LIFELINE_WINDOW_DAYS = 90;
export const LIFELINE_SAMPLES = 24;

export interface ScenarioLifelinePoint {
  at: Date,
  aleMean: number,
  aleP10: number | null,
  aleP90: number | null,
}

export interface ScenarioAleChange {
  delta: number,
  /** Null when the oldest point priced the scenario at zero and a ratio would divide by it. */
  deltaPct: number | null,
  /** Days the points actually cover, which is never the window: the series starts at its first run in it. */
  spanDays: number,
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** One reading of a series against another, ordered oldest first. */
export interface AleChangeEndpoint {
  at: Date | string | number,
  aleMean: number,
}

/**
 * The movement between two readings of a series, and how long it took.
 *
 * The span is measured rather than declared. Two surfaces reading the same scenario over "the
 * history" cover different periods — one capped at a point count, another at a number of days —
 * and a figure whose period is assumed is a figure two screens will quietly disagree about.
 */
export const computeAleChange = (oldest: AleChangeEndpoint, latest: AleChangeEndpoint): ScenarioAleChange => {
  const delta = latest.aleMean - oldest.aleMean;
  const elapsedMs = new Date(latest.at).getTime() - new Date(oldest.at).getTime();
  return {
    delta,
    deltaPct: oldest.aleMean === 0 ? null : delta / oldest.aleMean,
    spanDays: Math.max(0, Math.round(elapsedMs / DAY_MS)),
  };
};

/**
 * Change in exposure across a scenario's whole lifeline: its oldest point to its newest.
 *
 * Derived from the lifeline rather than from the runs behind it, so the figure and the line span
 * one history by construction. They are both tinted by the direction they carry, and two spans
 * feeding two tints render as one contradictory verdict — a green line beside a red figure.
 */
export const computeLifelineChange = (points: ReadonlyArray<ScenarioLifelinePoint>): ScenarioAleChange | null =>
  points.length < 2 ? null : computeAleChange(points[0], points[points.length - 1]);
