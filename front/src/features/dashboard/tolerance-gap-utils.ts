import { formatSignificant } from '../../utils/format-number';
import { niceTicks } from './loss-exceedance-utils';

export const TOLERANCE_GAP_ROW_LIMIT = 8;

interface GapRowLike {
  gap: number,
  outside: boolean,
}

export interface ToleranceGapSummary<T> {
  shown: Array<T>,
  otherCount: number,
  otherOutsideCount: number,
}

/** Expects `rows` ranked, largest gap first. */
export const summarizeToleranceGaps = <T extends GapRowLike>(rows: ReadonlyArray<T>, limit: number = TOLERANCE_GAP_ROW_LIMIT): ToleranceGapSummary<T> => {
  const other = rows.slice(limit);
  return {
    shown: rows.slice(0, limit),
    otherCount: other.length,
    otherOutsideCount: other.filter((row) => row.outside).length,
  };
};

export interface GapScale {
  ticks: Array<number>,
  /** From 0 at the leftmost tick to 1 at the rightmost. */
  position: (gap: number) => number,
}

/** Always spans zero, the threshold, whatever side the gaps fall on. */
export const buildGapScale = (gaps: ReadonlyArray<number>): GapScale => {
  const low = Math.min(0, ...gaps);
  const high = Math.max(0, ...gaps);
  const [, step] = niceTicks(high - low, 4);
  const first = Math.floor(low / step + 1e-9);
  const last = Math.max(Math.ceil(high / step - 1e-9), first + 1);
  const ticks = Array.from({ length: last - first + 1 }, (_, index) => Number(((first + index) * step).toPrecision(12)));
  const min = ticks[0];
  const span = ticks[ticks.length - 1] - min;
  return { ticks, position: (gap) => (gap - min) / span };
};

/** Two significant digits, a third when two would read a ratio off the threshold as exactly on it, in the application language: "1.5×", "1,5×" in French. */
export const formatGapRatio = (ratio: number): string => {
  const digits = Number(ratio.toPrecision(2)) === 1 && ratio !== 1 ? 3 : 2;
  return `${formatSignificant(ratio, digits)}×`;
};
