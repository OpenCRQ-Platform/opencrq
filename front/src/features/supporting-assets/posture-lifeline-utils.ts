import type { PeriodWindowId } from '../../components/shared/period-window';
import { buildWindowedLifeline } from '../../components/shared/lifeline-utils';

export type PostureChange =
  | { kind: 'first' }
  | { kind: 'regained' }
  | { kind: 'worst' }
  | { kind: 'exploitability', from: number }
  | { kind: 'tail', fromApplicable: number, toApplicable: number }
  | { kind: 'newWorst' }
  | { kind: 'resolved', resolvedName: string };

export interface PostureCause {
  worstFinding: { evidenceId: string, name: string } | null,
  worstExploitability: number,
  countsByBand: { critical: number, high: number, medium: number, low: number },
  change: PostureChange | null,
}

/** A line of the asset's posture journal. A null score is the asset losing its posture at `at`. */
export interface PostureHistoryLine {
  at: string,
  score: number | null,
  cause: PostureCause | null,
}

/** A journal line of the window with a posture, which the plot can point at. */
export interface PostureMark {
  at: Date,
  score: number,
  /** From 0 to 1 across the plot. */
  x: number,
  /** Its point in `values`. */
  pointIndex: number,
  /** Null when the line before it had no posture, or there was none. */
  previous: number | null,
  cause: PostureCause | null,
}

export interface PostureLifeline {
  /** A score per point, null where the posture is lost, each at its `xs` from 0 to 1. */
  values: Array<number | null>,
  xs: Array<number>,
  marks: Array<PostureMark>,
  oldest: { at: Date, score: number },
  /** Null when the asset has no posture now. */
  latest: number | null,
  change: number | null,
  /** The span the plot covers: the first point drawn and the last line. */
  start: Date,
  end: Date,
  /** One point only, drawn flat across the whole width. */
  single: boolean,
}

const DAY_MS = 86_400_000;

/**
 * The window's journal lines across a plot spanning the data rather than the period, ending at the
 * last line. Null when the window holds no posture.
 */
export const buildPostureLifeline = (
  lines: ReadonlyArray<PostureHistoryLine>,
  windowId: PeriodWindowId,
  now: Date,
): PostureLifeline | null => {
  const windowed = buildWindowedLifeline(
    lines.map((line) => ({ at: new Date(line.at).getTime(), value: line.score, payload: line.cause })),
    windowId,
    now,
  );
  if (windowed === null) {
    return null;
  }
  return {
    ...windowed,
    // A lost posture journals no cause, so its line has nothing for a tooltip to say.
    marks: windowed.marks.flatMap(({ value, payload, ...mark }) => (value === null ? [] : [{ ...mark, score: value, cause: payload }])),
    oldest: { at: windowed.oldest.at, score: windowed.oldest.value },
  };
};

/** Shorter than a day, the dates under the plot read the hours. */
export const spansLessThanADay = (lifeline: Pick<PostureLifeline, 'start' | 'end'>): boolean =>
  lifeline.end.getTime() - lifeline.start.getTime() < DAY_MS;
