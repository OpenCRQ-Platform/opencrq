import type { CapabilityFunction } from '@app/module/client';
import type { WindowedLifeline, WindowedMark } from '../../../../components/shared/lifeline-utils';
import type { PeriodWindowId } from '../../../../components/shared/period-window';
import { buildWindowedLifeline } from '../../../../components/shared/lifeline-utils';

/** A line of the proven posture history: the counts in force from `at`, for one function. */
export interface ProvenPostureHistoryLine {
  function: CapabilityFunction,
  at: string | Date,
  credited: number,
  tested: number,
  held: number,
}

export interface ProvenPostureCounts {
  credited: number,
  tested: number,
  held: number,
  /** The last success rate defined before this line, null on the first. */
  previousRate: number | null,
  marked: boolean,
}

/** Only a line with a rate is marked, so a mark always holds one. */
export type ProvenPostureMark = WindowedMark<ProvenPostureCounts> & { value: number };

export interface ProvenPostureLifeline extends Omit<WindowedLifeline<ProvenPostureCounts>, 'marks'> {
  marks: Array<ProvenPostureMark>,
  /** The proof coverage at each point of `values`, zero once nothing is credited. */
  coverage: Array<number>,
  /** The scale both series share: the lowest and highest values either holds. */
  domain: { min: number, max: number },
}

const rateOf = ({ held, tested }: { held: number, tested: number }): number | null => (tested === 0 ? null : held / tested);

const coverageOf = ({ tested, credited }: { tested: number, credited: number }): number =>
  (credited === 0 ? 0 : tested / credited);

/** Exact, so two rates that round to the same percent still read as a change. */
const sameRate = (a: { held: number, tested: number }, b: { held: number, tested: number }): boolean =>
  a.held * b.tested === b.held * a.tested;

/**
 * The success rate of one function, with the proof coverage behind it, across a plot spanning its
 * first rate in the window to `now`, the last counts held up to today, a rate lost by then as a gap. A point is marked on each
 * change of the rate, never on a change of the coverage alone. Null when the window holds no rate.
 */
export const buildProvenPostureLifeline = (
  lines: ReadonlyArray<ProvenPostureHistoryLine>,
  capabilityFunction: CapabilityFunction,
  windowId: PeriodWindowId,
  now: Date,
): ProvenPostureLifeline | null => {
  const ordered = lines
    .filter((line) => line.function === capabilityFunction)
    .map((line) => ({ ...line, at: new Date(line.at).getTime() }))
    .toSorted((a, b) => a.at - b.at);

  let lastDefined: { held: number, tested: number } | null = null;
  let previousLineRated = false;
  const journal = ordered.map((line) => {
    const rate = rateOf(line);
    const marked = rate !== null && (!previousLineRated || lastDefined === null || !sameRate(line, lastDefined));
    const payload: ProvenPostureCounts = {
      credited: line.credited,
      tested: line.tested,
      held: line.held,
      previousRate: lastDefined === null ? null : rateOf(lastDefined),
      marked,
    };
    if (rate !== null) {
      lastDefined = line;
    }
    previousLineRated = rate !== null;
    return { at: line.at, value: rate, payload };
  });

  const windowed = buildWindowedLifeline(journal, windowId, now, {
    holdToNow: true,
    holdGapToNow: true,
    isMarked: (payload) => payload.marked,
  });
  if (windowed === null) {
    return null;
  }
  const coverage = windowed.payloads.map(coverageOf);
  const drawn = [...windowed.values, ...coverage].filter((value) => value !== null);
  return {
    ...windowed,
    marks: windowed.marks.flatMap((mark) => (mark.value === null ? [] : [{ ...mark, value: mark.value, previous: mark.payload.previousRate }])),
    coverage,
    domain: { min: Math.min(...drawn), max: Math.max(...drawn) },
  };
};
