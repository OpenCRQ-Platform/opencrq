import { COVERAGE_COEFFICIENTS, STRENGTH_BY_RUNG } from '@app/module/client';
import type { CoveredTechniqueTestReading, TechniqueDeclaration, TechniqueTestOutcome, TechniqueTestReading } from '../types/validation';
import { roundPercentPoints } from '@app/utils/decimals';
import { formatPointsAsPercent } from '../../../../utils/format-number';

/**
 * The decimals every engine figure is written at, on a technique's page, a control's function tabs
 * and the efficacy's explanation, and the precision the verdict is read at: moving it moves both.
 */
export const ENGINE_FIGURE_DECIMALS = 0;

const UNITS_PER_POINT = 10 ** ENGINE_FIGURE_DECIMALS;

/** A share in shown units, whole points at no decimal, tenths at one. */
const shownUnits = (share: number): number => Math.round(roundPercentPoints(share, ENGINE_FIGURE_DECIMALS) * UNITS_PER_POINT);

/** A share on the engine's scale as the percentage points the screens write. */
export const shownPercentPoints = (share: number): number => shownUnits(share) / UNITS_PER_POINT;

/** Percentage points already at the shown precision, written at it. */
export const formatEnginePoints = (percentPoints: number): string => formatPointsAsPercent(percentPoints, ENGINE_FIGURE_DECIMALS);

/** A share on the engine's scale as the screens write it. */
export const formatEnginePercent = (share: number): string => formatEnginePoints(shownPercentPoints(share));

/**
 * What OpenAEV's result did to the declaration as the screens write both: pulled it down, left it
 * standing, or there is no result. Every surface that colours or counts reads it, so a filter's count
 * and the cells it keeps never disagree with the figures they show.
 */
export type EfficacyVerdict = 'lowered' | 'confirmed' | 'untested';

type EngineFigures = Pick<CoveredTechniqueTestReading, 'tested' | 'declared' | 'efficacy'>;

/** Whether the efficacy reads below the declaration at the precision both are written at. */
export const isLoweredAsShown = ({ declared, efficacy }: Pick<EngineFigures, 'declared' | 'efficacy'>): boolean =>
  shownUnits(efficacy) < shownUnits(declared);

export const efficacyVerdict = (reading: EngineFigures): EfficacyVerdict => {
  if (reading.tested === null) {
    return 'untested';
  }
  return isLoweredAsShown(reading) ? 'lowered' : 'confirmed';
};

/**
 * Which sentence the explanation opens on: `lowered`, `confirmed` where the tested rate reaches the
 * declaration, `unmoved` where it falls short on too small a share to move the figure shown.
 */
export type EfficacyReading = 'lowered' | 'confirmed' | 'unmoved' | 'untested';

export const efficacyReadingOf = (reading: EngineFigures): EfficacyReading => {
  const verdict = efficacyVerdict(reading);
  if (verdict !== 'confirmed' || reading.tested === null) {
    return verdict;
  }
  return reading.tested.rate >= reading.declared ? 'confirmed' : 'unmoved';
};

/** The most a single control can be declared at: the top strength rung on full coverage. */
export const DECLARATION_CEILING = STRENGTH_BY_RUNG.L3 * COVERAGE_COEFFICIENTS.L3;

/**
 * The calculation as the dialog writes it, in percentage points at the shown precision: `gap`, the
 * written declaration less the written rate, and `removal`, the written declaration less the written
 * efficacy, so both lines hold as written and the last ends on the cells' figure. `removalRounded`
 * says where `gap × share`, as written, only approximates the removal.
 */
export interface DisplayedCalculation {
  declared: number,
  /** The tested rate and share, absent without a result. */
  rate: number | null,
  share: number | null,
  gap: number,
  removal: number,
  removalRounded: boolean,
  efficacy: number,
}

export const displayedCalculation = ({ tested, declared, efficacy }: EngineFigures): DisplayedCalculation => {
  const declaredUnits = shownUnits(declared);
  const rateUnits = tested === null ? null : shownUnits(tested.rate);
  const shareUnits = tested === null ? null : shownUnits(tested.share);
  const gapUnits = rateUnits === null ? 0 : Math.max(0, declaredUnits - rateUnits);
  const efficacyUnits = shownUnits(efficacy);
  const removalUnits = declaredUnits - efficacyUnits;
  const unitsOfWhole = 100 * UNITS_PER_POINT;
  return {
    declared: declaredUnits / UNITS_PER_POINT,
    rate: rateUnits === null ? null : rateUnits / UNITS_PER_POINT,
    share: shareUnits === null ? null : shareUnits / UNITS_PER_POINT,
    gap: gapUnits / UNITS_PER_POINT,
    removal: removalUnits / UNITS_PER_POINT,
    removalRounded: gapUnits * (shareUnits ?? 0) !== removalUnits * unitsOfWhole,
    efficacy: efficacyUnits / UNITS_PER_POINT,
  };
};

/**
 * The declaration's product at the shown precision, as its terms show them, and whether it holds as
 * written: 97 % × 70 % is 67.9 %, which the declaration's 68 % only approximates.
 */
export interface DisplayedDeclaration {
  strength: number,
  coverage: number,
  declared: number,
  exact: boolean,
}

export const displayedDeclaration = (
  { strength, coverage }: Pick<TechniqueDeclaration, 'strength' | 'coverage'>,
  declared: number,
): DisplayedDeclaration => {
  const strengthUnits = shownUnits(strength);
  const coverageUnits = shownUnits(coverage);
  const declaredUnits = shownUnits(declared);
  return {
    strength: strengthUnits / UNITS_PER_POINT,
    coverage: coverageUnits / UNITS_PER_POINT,
    declared: declaredUnits / UNITS_PER_POINT,
    exact: strengthUnits * coverageUnits === declaredUnits * 100 * UNITS_PER_POINT,
  };
};

/** The tests in which the control let the technique through. */
export const failedTests = ({ tests, heldTests }: Pick<TechniqueTestOutcome, 'tests' | 'heldTests'>): number => tests - heldTests;

/** Whether a count of tests is every test, which a sentence names without repeating the count. */
export const isEveryTest = (count: number, { tests }: Pick<TechniqueTestOutcome, 'tests'>): boolean => count === tests;

/** A sub-technique's parent in ATT&CK's numbering, `T1055` for `T1055.012`, whose result it reads; none for a technique. */
export const parentExternalIdOf = (externalId: string): string | null => {
  const dot = externalId.indexOf('.');
  return dot === -1 ? null : externalId.slice(0, dot);
};

/** Where a reading's evidence is listed: the control's lines on the technique its result is stored under, and that technique's sub-techniques. */
export interface EvidenceLink {
  externalId: string,
}

/**
 * The evidence behind a reading's result, none without one or where the control's validation is not
 * available to list it. A covered sub-technique's result is its parent's, so it leads to the parent's;
 * an uncovered one is filed on its own technique.
 */
export const evidenceLinkOf = (
  reading: Pick<TechniqueTestReading, 'covered' | 'tested'>,
  externalId: string,
  isValidationAvailable: boolean,
): EvidenceLink | null => {
  if (!isValidationAvailable || reading.tested === null) {
    return null;
  }
  return { externalId: reading.covered ? parentExternalIdOf(externalId) ?? externalId : externalId };
};
