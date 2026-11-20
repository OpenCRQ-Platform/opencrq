import type { SeverityBand } from '@app/module/client';
import type { PeriodWindowId } from '../../components/shared/period-window';
import { buildWindowedLifeline } from '../../components/shared/lifeline-utils';
import { periodWindowDays } from '../../components/shared/period-window';

/** A line of the finding's score journal, its score truncated as printed, null where the finding lost its vector. */
export interface ScoreHistoryLine {
  at: string | Date,
  score: number | null,
  band: SeverityBand | null,
}

/** A journal line the lifeline draws: a null score is the line on which the score was lost. */
export interface ScoreLifelineLine {
  at: string | Date,
  score: number | null,
  band: SeverityBand | null,
}

export interface BandMove {
  from: SeverityBand,
  to: SeverityBand,
}

/** A journal line of the window, which the plot can point at. */
export interface ScoreMark<Line extends ScoreLifelineLine = ScoreHistoryLine> {
  at: Date,
  /** Null on a line losing the score, pointing at the end of the stretch it breaks. */
  score: Line['score'],
  /** As journaled, which a later change of the band cut-offs does not rewrite. */
  band: Line['band'],
  /** From 0 to 1 across the plot. */
  x: number,
  /** Its point in `values`. */
  pointIndex: number,
  /** Null on the journal's first line, and on the first after a lost one. */
  previous: number | null,
  bandMove: BandMove | null,
  line: Line,
}

export interface ScoreLifeline<Line extends ScoreLifelineLine = ScoreHistoryLine> {
  values: Array<number | null>,
  xs: Array<number>,
  marks: Array<ScoreMark<Line>>,
  oldest: { at: Date, score: number },
  latest: number | null,
  latestBand: SeverityBand | null,
  change: number | null,
  /** The span the plot covers: the first point drawn and the last line. */
  start: Date,
  end: Date,
  /** One point only, drawn flat across the whole width. */
  single: boolean,
}

/** `held` is a line only its band wrote, the score staying put. */
export type ScoreEventKind = 'first' | 'rise' | 'fall' | 'held';

export interface ScoreEvent {
  id: string,
  at: Date,
  kind: ScoreEventKind,
  score: number,
  band: SeverityBand,
  /** The journal line before this one, null on the first. */
  previous: { score: number, band: SeverityBand } | null,
}

const DAY_MS = 86_400_000;

const oldestFirst = (lines: ReadonlyArray<ScoreHistoryLine>) => lines
  .map((line) => ({ at: new Date(line.at), score: line.score, band: line.band }))
  .filter((line) => !Number.isNaN(line.at.getTime()))
  .toSorted((a, b) => a.at.getTime() - b.at.getTime());

export const bandMoveOf = (from: SeverityBand | null, to: SeverityBand | null): BandMove | null =>
  (from === null || to === null || from === to ? null : { from, to });

/**
 * The window's journal lines across a plot spanning the data rather than the period, ending at the
 * last line, as the asset's posture card draws them. Null when the window holds no score.
 */
export const buildScoreLifeline = <Line extends ScoreLifelineLine>(
  lines: ReadonlyArray<Line>,
  windowId: PeriodWindowId,
  now: Date,
): ScoreLifeline<Line> | null => {
  const ordered = lines
    .map((line) => ({ line, at: new Date(line.at).getTime() }))
    .filter(({ at }) => !Number.isNaN(at))
    .toSorted((a, b) => a.at - b.at);
  const windowed = buildWindowedLifeline(
    ordered.map(({ line, at }, index) => ({
      at,
      value: line.score,
      payload: { line, bandMove: bandMoveOf(index === 0 ? null : ordered[index - 1].line.band, line.band) },
    })),
    windowId,
    now,
  );
  if (windowed === null) {
    return null;
  }
  const { payloads, ...rest } = windowed;
  return {
    ...rest,
    marks: windowed.marks.map(({ value: _drawn, payload: { line, bandMove }, ...mark }) => ({
      ...mark,
      score: line.score,
      band: line.band,
      bandMove,
      line,
    })),
    oldest: { at: windowed.oldest.at, score: windowed.oldest.value },
    latestBand: windowed.latest === null ? null : payloads.at(-1)?.line.band ?? null,
  };
};

/** Shorter than a day, the dates under the plot read the hours. */
export const spansLessThanADay = (lifeline: Pick<ScoreLifeline, 'start' | 'end'>): boolean =>
  lifeline.end.getTime() - lifeline.start.getTime() < DAY_MS;

const eventKindOf = (score: number, previous: { score: number } | null): ScoreEventKind => {
  if (previous === null) {
    return 'first';
  }
  if (score === previous.score) {
    return 'held';
  }
  return score < previous.score ? 'fall' : 'rise';
};

/**
 * One event per scored journal line of the last twelve months, newest first. The line in force when
 * that span opens is no event of its own, only the `previous` of the first one, and a score coming
 * back after a null line is a first again.
 */
export const buildScoreEvents = (lines: ReadonlyArray<ScoreHistoryLine>, now: Date): Array<ScoreEvent> => {
  const ordered = oldestFirst(lines);
  const since = now.getTime() - periodWindowDays('12m') * DAY_MS;

  return ordered
    .flatMap((line, index): Array<ScoreEvent> => {
      const { score, band } = line;
      if (line.at.getTime() < since || score === null || band === null) {
        return [];
      }
      const before = index === 0 ? undefined : ordered[index - 1];
      const previous = before === undefined || before.score === null || before.band === null
        ? null
        : { score: before.score, band: before.band };
      return [{ id: `score-${line.at.toISOString()}`, at: line.at, kind: eventKindOf(score, previous), score, band, previous }];
    })
    .toReversed();
};

/** Null on the first line, which moved from nothing, and on a held one, which did not move. */
export const scoreEventPoints = (event: ScoreEvent): number | null =>
  (event.previous === null || event.kind === 'held' ? null : event.score - event.previous.score);

export const scoreEventBandMove = (event: ScoreEvent): BandMove | null =>
  bandMoveOf(event.previous?.band ?? null, event.band);
