import type {
  CapabilityFunction,
  CoveredTechniqueControlTestReading,
  TechniqueControlTestReading,
  TechniqueCoverageReading,
  TechniqueFunctionCoverage,
  TechniqueTestOutcome,
  UncoveredTechniqueTestReading,
} from '@app/module/client';
import type { EfficacySegment } from '../../controls/capability/utils/control-technique-readings-utils';
import { efficacyVerdict } from '../../controls/capability/utils/engine-efficacy-utils';

/** One function of the threat's techniques, by technique id. */
export const coverageOnFunction = (
  coverages: ReadonlyArray<TechniqueFunctionCoverage> | undefined,
  capabilityFunction: CapabilityFunction,
): Map<string, TechniqueFunctionCoverage> =>
  new Map((coverages ?? []).filter((coverage) => coverage.function === capabilityFunction).map((coverage) => [coverage.mitreTechniqueId, coverage]));

export type TestedUncoveredControlReading = TechniqueCoverageReading & UncoveredTechniqueTestReading & { tested: TechniqueTestOutcome };

/** A control linked to the technique that the engine reads as absent there, declared at no coverage or never assessed, and OpenAEV tested. */
export type TestedAbsentControlReading = TechniqueCoverageReading & CoveredTechniqueControlTestReading & { tested: TechniqueTestOutcome };

const testedOthersOf = (coverage: TechniqueFunctionCoverage | undefined): Array<TechniqueCoverageReading> =>
  (coverage === undefined || coverage.best !== null ? [] : coverage.others.filter((other) => other.tested !== null));

/**
 * What a technique no present control covers shows: the first other control OpenAEV tested there
 * that the engine does not read for it; none without one.
 */
export const testedUncoveredReadingOf = (coverage: TechniqueFunctionCoverage | undefined): TestedUncoveredControlReading | null => {
  for (const reading of testedOthersOf(coverage)) {
    if (!reading.covered && reading.tested !== null) {
      return { ...reading, tested: reading.tested };
    }
  }
  return null;
};

/** Where no tested control is unlinked, the first tested one the technique is linked to and the engine reads as absent. */
export const testedAbsentReadingOf = (coverage: TechniqueFunctionCoverage | undefined): TestedAbsentControlReading | null => {
  if (testedUncoveredReadingOf(coverage) !== null) {
    return null;
  }
  for (const reading of testedOthersOf(coverage)) {
    if (reading.covered && reading.tested !== null) {
      return { ...reading, tested: reading.tested };
    }
  }
  return null;
};

/** The reading a technique's cell, row and dialog show, none for a technique nothing covers or tested. */
export const shownReadingOf = (
  coverage: TechniqueFunctionCoverage | undefined,
): (TechniqueCoverageReading & CoveredTechniqueControlTestReading) | TestedUncoveredControlReading | null =>
  coverage?.best ?? testedUncoveredReadingOf(coverage) ?? testedAbsentReadingOf(coverage);

/** The segment a technique falls in: its best control's verdict, `uncovered` where only a control the engine does not count was tested, none otherwise. */
export const segmentOfCoverage = (coverage: TechniqueFunctionCoverage | undefined): Exclude<EfficacySegment, 'all'> | null => {
  if (coverage?.best != null) {
    return efficacyVerdict(coverage.best);
  }
  return shownReadingOf(coverage) === null ? null : 'uncovered';
};

/** The techniques each filter keeps; a technique nothing covers or tested stays under `all` alone. */
export const threatTechniquesBySegment = (
  techniqueIds: ReadonlyArray<string>,
  coverageOf: ReadonlyMap<string, TechniqueFunctionCoverage>,
): Record<Exclude<EfficacySegment, 'all'>, Set<string>> => {
  const bySegment: Record<Exclude<EfficacySegment, 'all'>, Set<string>> = {
    confirmed: new Set(),
    lowered: new Set(),
    untested: new Set(),
    uncovered: new Set(),
  };
  for (const techniqueId of techniqueIds) {
    const segment = segmentOfCoverage(coverageOf.get(techniqueId));
    if (segment !== null) {
      bySegment[segment].add(techniqueId);
    }
  }
  return bySegment;
};

/**
 * How another covering control reads in a technique's tooltip: a present one by its efficacy and
 * verdict, an assessed one at no coverage as absent, one never assessed as such, and one the engine
 * does not read there by whether OpenAEV tested it.
 */
export type OtherControlStatus = 'confirmed' | 'lowered' | 'untested' | 'absent' | 'unassessed' | 'testedNotCovered' | 'notCovered';

export interface OtherControlLine {
  capabilityId: string,
  capabilityExternalId: string,
  capabilityName: string,
  status: OtherControlStatus,
  /** The engine efficacy of a present control, none otherwise. */
  efficacy: number | null,
}

export const otherControlLine = (reading: TechniqueControlTestReading): OtherControlLine => {
  const { capabilityId, capabilityExternalId, capabilityName } = reading;
  if (!reading.covered) {
    return { capabilityId, capabilityExternalId, capabilityName, status: reading.tested === null ? 'notCovered' : 'testedNotCovered', efficacy: null };
  }
  if (reading.declaration === null) {
    return { capabilityId, capabilityExternalId, capabilityName, status: 'unassessed', efficacy: null };
  }
  if (reading.declaration.coverage === 0) {
    return { capabilityId, capabilityExternalId, capabilityName, status: 'absent', efficacy: null };
  }
  return { capabilityId, capabilityExternalId, capabilityName, status: efficacyVerdict(reading), efficacy: reading.efficacy };
};

/** The controls the engine counts as present on the technique, the best one included. */
export const presentControlCount = (coverage: TechniqueFunctionCoverage): number =>
  (coverage.best === null ? 0 : 1) + coverage.others.filter((reading) => {
    const status = otherControlLine(reading).status;
    return status === 'confirmed' || status === 'lowered' || status === 'untested';
  }).length;
