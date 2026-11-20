import { plural } from '@lingui/core/macro';
import { isExpectationMet, MISSED_SHARE_THRESHOLD } from '@app/module/client';
import type { ValidationCell } from '../types/validation';
import { daysSince, formatDate, formatFractionAsPercent } from '../../../../utils';

export { MISSED_SHARE_THRESHOLD };

export type PostureTone = 'positive' | 'warning' | 'destructive';

export const resolvePostureTone = (missedShare: number): PostureTone => {
  if (missedShare <= 0) {
    return 'positive';
  }
  return missedShare >= MISSED_SHARE_THRESHOLD ? 'destructive' : 'warning';
};

export interface ProvenPosture {
  /** Expectations a simulation has run at least once, at the technique and function grain. */
  tested: number,
  met: number,
  missed: number,
  /** `met / tested`, and zero when nothing was tested: read it against `tested`, never alone. */
  successRate: number,
  missedShare: number,
  tone: PostureTone,
  /** Expectations the catalogue credits the control with, tenant removals excluded. */
  credited: number,
  coverageRate: number,
  /** Latest measurement across the counted expectations; null when none carried a date. */
  latestProofAt: Date | null,
}

const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

const latestOf = (cells: ReadonlyArray<ValidationCell>): Date | null =>
  cells.reduce<Date | null>((latest, cell) => {
    if (cell.latestProofAt === null) {
      return latest;
    }
    const at = new Date(cell.latestProofAt);
    return latest === null || at.getTime() > latest.getTime() ? at : latest;
  }, null);

/** Share of the scenarios that held on one expectation. Scenarios vote, not assets. */
export const cellSuccessRate = (cell: Pick<ValidationCell, 'validatedVotes' | 'totalVotes'>): number =>
  share(cell.validatedVotes, cell.totalVotes);

/**
 * What the simulations proved, as a rate over what they tested and a coverage over what the
 * catalogue credits.
 *
 * Both figures are needed and neither survives alone: a rate says whether the control held where
 * anyone looked, the coverage says how little of it was looked at. Counting runs at the expectation
 * grain, one entry per technique and function, which is the grain the credited count uses too.
 *
 * An expectation counts as met on the same threshold a single expectation is read on, never on the
 * stored binary state. One scenario in four hundred getting through is the defect the threshold
 * exists to absorb, and a surface counting it as missed would disagree with the very cell it sums.
 *
 * A result with `tested` at zero carries no measurement: its rates are zero by convention and no
 * surface may render them as a verdict.
 */
export const summariseProvenPosture = (
  cells: ReadonlyArray<ValidationCell>,
  credited: number,
): ProvenPosture => {
  const met = cells.filter(isExpectationMet).length;
  const tested = cells.length;
  const missedShare = share(tested - met, tested);

  return {
    tested,
    met,
    missed: tested - met,
    successRate: share(met, tested),
    missedShare,
    tone: resolvePostureTone(missedShare),
    credited,
    coverageRate: share(tested, credited),
    latestProofAt: latestOf(cells),
  };
};

/** Age of the most recent proof, dated; null when no counted result carried a date. */
export const describeProofFreshness = (latestProofAt: string | Date | null): string | null => {
  const days = daysSince(latestProofAt);
  if (days === null || latestProofAt === null) {
    return null;
  }
  const on = formatDate(latestProofAt);
  return plural(days, {
    // ICU exact match, not the `zero` category: English has no zero plural form, so `zero` never
    // fires and a same-day proof would read "0 days ago".
    0: `Last proof today, ${on}`,
    one: `Last proof # day ago, ${on}`,
    other: `Last proof # days ago, ${on}`,
  });
};

/**
 * A rate as a whole percent in the application language, which never rounds to a figure that
 * contradicts what it measures.
 *
 * Proof coverage runs at a fraction of a percent by construction, so `0%` would sit beside a tested
 * count that proves it wrong; a success rate over five hundred expectations rounds the other way, so
 * `100%` would sit under an amber meter. Both boundaries read as an inequality instead.
 */
export const formatBoundedRate = (rate: number): string => {
  if (rate > 0 && rate < 0.01) {
    return `<${formatFractionAsPercent(0.01, 0)}`;
  }
  if (rate > 0.99 && rate < 1) {
    return `>${formatFractionAsPercent(0.99, 0)}`;
  }
  return formatFractionAsPercent(rate, 0);
};

/** Symbols only, so it carries no translatable text and no ordering to get wrong. */
export const formatRateReadout = (rate: number, part: number, whole: number): string =>
  `${formatBoundedRate(rate)} (${part} / ${whole})`;
