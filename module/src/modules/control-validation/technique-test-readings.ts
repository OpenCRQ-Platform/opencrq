import { compareCodePoints } from '@app/utils';
import type { CapabilityFunction, CoverageBucket, StrengthRung } from '../controls/capability/constants';
import type { TestedResult } from '../controls/capability/tested-efficacy';
import type { TechniqueTestGrain } from './technique-test-results';
import type { PhishingStageName } from '../crq-indicators/engine/attack-run-constants';
import { testedCoverage, testedEfficacy } from '../controls/capability/tested-efficacy';
import { techniqueTestKey } from './technique-test-results';

/** The two factors of a control's declaration, as the rungs a user declares and the figures the engine reads them at. */
export interface TechniqueDeclaration {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  /** The shared rung scale's, or the stage anchor of `phishingStage`'s rung where the engine reads one. */
  strength: number,
  coverage: number,
  /** The phishing stage whose `PHISHING_STAGE_ANCHORS` entry the strength reads, none on the shared scale. */
  phishingStage: PhishingStageName | null,
}

/** A control on a technique and function, at one level. */
export interface TechniqueReadingCell {
  capabilityId: string,
  function: CapabilityFunction,
  mitreTechniqueId: string,
  /** A sub-technique's parent, none for a technique. */
  parentTechniqueId: string | null,
}

/** A cell the engine reads: its family's row audits the declaration. */
export interface TechniqueControlCell extends TechniqueReadingCell {
  /** None for a control the level resolves no posture for, which the engine reads as declared absent. */
  declaration: TechniqueDeclaration | null,
}

export interface TechniqueTestOutcome extends TestedResult {
  tests: number,
  heldTests: number,
  /** `alpha`, the share of the level's hosts the tests ran on. */
  share: number,
}

interface ReadingKey {
  capabilityId: string,
  function: CapabilityFunction,
  mitreTechniqueId: string,
  /** The technique heading the family the evidence is listed under: a sub-technique's parent, the technique itself otherwise. */
  familyTechniqueId: string,
}

/** A control's reading on a technique it covers, which the engine prices. */
export interface CoveredTechniqueTestReading extends ReadingKey {
  covered: true,
  declaration: TechniqueDeclaration | null,
  /** `D`, strength x coverage on the engine's scale (L2 / L2 reads about 50 %, more on an anchored phishing stage). */
  declared: number,
  /**
   * `D` audited by `tested`, `D` alone without it. A technique's is what the engine reads; a
   * sub-technique's, on its own tests, is for the screens, the engine pricing its parent.
   */
  efficacy: number,
  /** The tests on the technique and its sub-techniques for a technique, on the sub-technique alone for one. */
  tested: TechniqueTestOutcome | null,
  /** A sub-technique's parent as the engine prices it here; none for a technique. */
  parentEfficacy: number | null,
}

/**
 * A control on a technique whose family row the engine does not read, a removed edge or one on a
 * sub-technique alone included: its result shown, if any, and no declaration audited.
 */
export interface UncoveredTechniqueTestReading extends ReadingKey {
  covered: false,
  tested: TechniqueTestOutcome | null,
}

export type TechniqueTestReading = CoveredTechniqueTestReading | UncoveredTechniqueTestReading;

/** A reading on a technique page, naming its control and the rungs it is declared at on the level, none where it is not assessed. */
export type TechniqueControlTestReading = TechniqueTestReading & {
  capabilityExternalId: string,
  capabilityName: string,
  capabilityRungs: Pick<TechniqueDeclaration, 'strengthRung' | 'coverageBucket'> | null,
};

/** A technique page's reading of a control the engine reads there. */
export type CoveredTechniqueControlTestReading = TechniqueControlTestReading & CoveredTechniqueTestReading;

/** Where the tenant unlinked a control from a technique: on the technique itself, or on the parent a sub-technique inherits the link from. */
export type TechniqueRemovedOn = 'technique' | 'parent';

/**
 * A reading on a threat's technique, `linked` where an active edge ties the control to the technique or
 * its parent, whether or not the engine reads that edge (one on a sub-technique alone it does not);
 * `removedOn` where the control is unlinked by a removal, none where no edge ever tied it.
 */
export type TechniqueCoverageReading = TechniqueControlTestReading & { linked: boolean, removedOn: TechniqueRemovedOn | null };

/**
 * One function of a technique as the controls covering it read it: `best`, the strongest one the
 * engine counts as present, none where no present control covers the technique, then every other
 * reading of the technique's page, the present ones in the same order.
 */
export interface TechniqueFunctionCoverage<Reading extends TechniqueControlTestReading = TechniqueCoverageReading> {
  mitreTechniqueId: string,
  function: CapabilityFunction,
  best: (Reading & CoveredTechniqueControlTestReading) | null,
  others: Array<Reading>,
}

/** A control the engine prices: assessed at the level, and at a coverage above 0, which the engine reads as absent. */
const isPresentReading = <Reading extends TechniqueControlTestReading>(reading: Reading): reading is Reading & CoveredTechniqueControlTestReading =>
  reading.covered && reading.declaration !== null && reading.declaration.coverage > 0;

const byCatalogueId = (first: TechniqueControlTestReading, second: TechniqueControlTestReading): number =>
  compareCodePoints(first.capabilityExternalId, second.capabilityExternalId);

/** Highest efficacy, then highest declaration, then catalogue id. */
const byStrength = (first: CoveredTechniqueControlTestReading, second: CoveredTechniqueControlTestReading): number =>
  second.efficacy - first.efficacy || second.declared - first.declared || byCatalogueId(first, second);

/** One technique's readings on one function, ranked into the best present control and the others. */
export const coverageOfReadings = <Reading extends TechniqueControlTestReading>(
  mitreTechniqueId: string,
  capabilityFunction: CapabilityFunction,
  readings: ReadonlyArray<Reading>,
): TechniqueFunctionCoverage<Reading> => {
  const ofFunction = readings.filter((reading) => reading.function === capabilityFunction);
  const [best = null, ...present] = ofFunction.filter(isPresentReading).toSorted(byStrength);
  const rest = ofFunction.filter((reading) => !isPresentReading(reading)).toSorted(byCatalogueId);
  return { mitreTechniqueId, function: capabilityFunction, best, others: [...present, ...rest] };
};

/** A reading on a control's tab, naming its technique. */
export type ControlTechniqueTestReading = TechniqueTestReading & {
  techniqueExternalId: string,
  techniqueName: string,
};

type StoredResult = TestedResult & Pick<TechniqueControlCell, 'capabilityId' | 'function' | 'mitreTechniqueId'> & {
  grain: TechniqueTestGrain,
  tests: number,
  heldTests: number,
};

const keyOf = (key: Pick<StoredResult, 'capabilityId' | 'function' | 'mitreTechniqueId' | 'grain'>): string => `${techniqueTestKey(key)}|${key.grain}`;

const outcomeOf = (result: StoredResult): TechniqueTestOutcome => ({
  tests: result.tests,
  heldTests: result.heldTests,
  rate: result.rate,
  hostsTested: result.hostsTested,
  scopeHosts: result.scopeHosts,
  share: testedCoverage(result),
});

const resultsByKey = (results: ReadonlyArray<StoredResult>): Map<string, StoredResult> =>
  new Map(results.map((result) => [keyOf(result), result]));

/** The row a cell reads its own result from: its family's for a technique, its own for a sub-technique. */
const ownResultOf = (resultOf: ReadonlyMap<string, StoredResult>, cell: TechniqueReadingCell): StoredResult | undefined =>
  resultOf.get(keyOf({ ...cell, grain: cell.parentTechniqueId === null ? 'technique' : 'sub_technique' }));

/**
 * Each cell the engine reads beside what OpenAEV observed there and its efficacy: a technique on its
 * family's row, a sub-technique on its own row, with its parent's efficacy on the parent's.
 */
export const readTechniqueTests = (
  cells: ReadonlyArray<TechniqueControlCell>,
  results: ReadonlyArray<StoredResult>,
): Array<CoveredTechniqueTestReading> => {
  const resultOf = resultsByKey(results);
  return cells.map((cell) => {
    const { capabilityId, function: fn, mitreTechniqueId, parentTechniqueId } = cell;
    const result = ownResultOf(resultOf, cell);
    const declared = cell.declaration === null ? 0 : cell.declaration.strength * cell.declaration.coverage;
    return {
      covered: true,
      capabilityId,
      function: fn,
      mitreTechniqueId,
      familyTechniqueId: parentTechniqueId ?? mitreTechniqueId,
      declaration: cell.declaration,
      declared,
      efficacy: testedEfficacy(declared, result),
      tested: result === undefined ? null : outcomeOf(result),
      parentEfficacy: parentTechniqueId === null
        ? null
        : testedEfficacy(declared, resultOf.get(keyOf({ capabilityId, function: fn, mitreTechniqueId: parentTechniqueId, grain: 'technique' }))),
    };
  });
};

/** Each cell the engine does not read, with its own result alone. */
export const readUncoveredTests = (
  cells: ReadonlyArray<TechniqueReadingCell>,
  results: ReadonlyArray<StoredResult>,
): Array<UncoveredTechniqueTestReading> => {
  const resultOf = resultsByKey(results);
  return cells.map((cell) => {
    const result = ownResultOf(resultOf, cell);
    return {
      covered: false,
      capabilityId: cell.capabilityId,
      function: cell.function,
      mitreTechniqueId: cell.mitreTechniqueId,
      familyTechniqueId: cell.parentTechniqueId ?? cell.mitreTechniqueId,
      tested: result === undefined ? null : outcomeOf(result),
    };
  });
};
