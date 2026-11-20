import type { RiskTolerance } from '@app/module/client';
import { MIN_TOLERANCE_EXCEEDANCE_PROBABILITY } from '@app/module/client';
import { formatFractionAsPercentAtMost } from '../../utils/format-number';

export interface RiskToleranceFormValues {
  annualLoss: number,
  maxExceedancePercent: number,
}

export const MIN_TOLERANCE_PERCENT = MIN_TOLERANCE_EXCEEDANCE_PROBABILITY * 100;

/** Both tolerance fields as the form holds them: a cleared number input reads `NaN`, an untouched one `undefined`. */
export interface OptionalToleranceValues {
  annualLoss?: number,
  maxExceedancePercent?: number,
}

const isBlankNumber = (value: number | undefined): boolean => value === undefined || Number.isNaN(value);

/** A scope tolerance can be set but never cleared, so two blank fields must write nothing at all. */
export const isToleranceBlank = (values: OptionalToleranceValues): boolean =>
  isBlankNumber(values.annualLoss) && isBlankNumber(values.maxExceedancePercent);

/** Exactly one field filled: the half of a tolerance that is never written, since the pair is saved together or not at all. */
export const isToleranceIncomplete = (values: OptionalToleranceValues): boolean =>
  isBlankNumber(values.annualLoss) !== isBlankNumber(values.maxExceedancePercent);

/** `0.07 * 100` is `7.000000000000001`: rounded so a stored value reads back as typed. */
const roundPercent = (value: number): number => Math.round(value * 1e6) / 1e6;

export const toFormValues = (tolerance: RiskTolerance): RiskToleranceFormValues => ({
  annualLoss: tolerance.annualLoss,
  maxExceedancePercent: roundPercent(tolerance.maxExceedanceProbability * 100),
});

export const fromFormValues = (values: RiskToleranceFormValues): RiskTolerance => ({
  annualLoss: values.annualLoss,
  maxExceedanceProbability: roundPercent(values.maxExceedancePercent) / 100,
});

export const completeTolerance = ({ annualLoss, maxExceedancePercent }: OptionalToleranceValues): RiskTolerance | null => (
  annualLoss === undefined || maxExceedancePercent === undefined || Number.isNaN(annualLoss) || Number.isNaN(maxExceedancePercent)
    ? null
    : fromFormValues({ annualLoss, maxExceedancePercent })
);

/** A probability as a percentage at no more than one decimal, in the application language: "2.3%", "2,3 %" in French. */
export const formatProbability = (probability: number): string => formatFractionAsPercentAtMost(probability, 1);

/**
 * A configured maximum probability, at the precision it was typed, so it never reads rounded onto the other side of a reading:
 * six decimals of a percentage, the precision `roundPercent` stores, in the application language ("0.15%", "0,15 %" in French).
 */
export const formatToleranceProbability = (probability: number): string => formatFractionAsPercentAtMost(probability, 6);

export const TOLERANCE_GAP_GROUP_ANCHOR = 'gap-to-tolerance';

interface ToleranceStatusLike {
  outside: boolean,
  source: 'scenario' | 'scope',
}

export interface ToleranceStatusCounts {
  simulatedCount: number,
  outsideCount: number,
  withinCount: number,
  ownThresholdCount: number,
}

export const countToleranceStatuses = (rows: ReadonlyArray<ToleranceStatusLike>): ToleranceStatusCounts => {
  const outsideCount = rows.filter((row) => row.outside).length;
  return {
    simulatedCount: rows.length,
    outsideCount,
    withinCount: rows.length - outsideCount,
    ownThresholdCount: rows.filter((row) => row.source === 'scenario').length,
  };
};
