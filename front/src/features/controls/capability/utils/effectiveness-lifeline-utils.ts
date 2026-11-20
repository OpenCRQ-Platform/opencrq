import type { CoverageBucket, PostureSource, StrengthRung } from '@app/module/client';
import type { WindowedLifeline, WindowedMark } from '../../../../components/shared/lifeline-utils';
import type { PeriodWindowId } from '../../../../components/shared/period-window';
import type { CapabilityEvent } from '../types/capability';
import { buildWindowedLifeline } from '../../../../components/shared/lifeline-utils';
import { computeSoloEffectiveness, effectivenessPoints, isSameEffectiveness } from './capability-effectiveness';

/** A line of the effectiveness history: the posture in force from `at`, null while not assessed. */
export interface EffectivenessHistoryLine {
  at: string | Date,
  posture: {
    strengthRung: StrengthRung,
    coverageBucket: CoverageBucket,
    strengthSource: PostureSource,
    coverageSource: PostureSource,
  } | null,
  /** Null on the line bringing the history to the live value, which draws no mark. */
  event: CapabilityEvent | null,
}

export type EffectivenessMark = WindowedMark<CapabilityEvent | null> & { event: CapabilityEvent };

export interface EffectivenessLifeline extends Omit<WindowedLifeline<CapabilityEvent | null>, 'marks'> {
  marks: Array<EffectivenessMark>,
  /** The lowest and highest effectiveness drawn, in percentage points. */
  min: number,
  max: number,
}

/**
 * The effectiveness, in percentage points, across a plot spanning its first value in the window to
 * `now`, the last value held up to today. A line scoring as the one before it draws nothing, so each
 * point is a change of the figure the page prints. Null when the window holds no value.
 */
export const buildEffectivenessLifeline = (
  lines: ReadonlyArray<EffectivenessHistoryLine>,
  windowId: PeriodWindowId,
  now: Date,
): EffectivenessLifeline | null => {
  const ordered = lines
    .map((line) => ({ ...line, at: new Date(line.at).getTime() }))
    .toSorted((a, b) => a.at - b.at);

  const kept: Array<{ at: number, value: number | null, payload: CapabilityEvent | null }> = [];
  let previous: ReturnType<typeof computeSoloEffectiveness> | null | undefined;
  ordered.forEach((line) => {
    const effectiveness = line.posture === null ? null : computeSoloEffectiveness(line.posture);
    const unchanged = previous !== undefined && (effectiveness === null || previous === null
      ? effectiveness === previous
      : isSameEffectiveness(effectiveness, previous));
    if (unchanged) {
      return;
    }
    previous = effectiveness;
    kept.push({ at: line.at, value: effectiveness === null ? null : effectivenessPoints(effectiveness.score), payload: line.event });
  });

  const windowed = buildWindowedLifeline(kept, windowId, now, { holdToNow: true, isMarked: (event) => event !== null });
  if (windowed === null) {
    return null;
  }
  const drawn = windowed.values.filter((value) => value !== null);
  return {
    ...windowed,
    marks: windowed.marks.flatMap((mark) => (mark.payload === null ? [] : [{ ...mark, event: mark.payload }])),
    min: Math.min(...drawn),
    max: Math.max(...drawn),
  };
};
