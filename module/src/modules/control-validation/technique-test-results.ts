import type { CapabilityFunction } from '../controls/capability/constants';
import type { ExpectationType } from '../supporting-assets/constants';
import { compareCodePoints } from '@app/utils';
import { EXPECTATION_TYPE_TO_FUNCTION } from './constants';

/** What `countTechniqueTests` counts of one control's fresh tests on one technique, expectation type and grain. */
export interface TechniqueTestCount {
  capabilityId: string,
  expectationType: ExpectationType,
  mitreTechniqueId: string,
  grain: TechniqueTestGrain,
  tests: number,
  heldTests: number,
  /** The distinct hosts among the tests. */
  hostsTested: number,
}

/**
 * `technique`: a parent technique, with every test on it or its sub-techniques, the only grain the
 * engine and the levers read. `sub_technique`: the tests on that sub-technique alone, for the screens.
 */
export const TECHNIQUE_TEST_GRAINS = ['technique', 'sub_technique'] as const;
export type TechniqueTestGrain = typeof TECHNIQUE_TEST_GRAINS[number];

/** What OpenAEV observed of one control on one technique and function. */
export interface TechniqueTestResult {
  capabilityId: string,
  function: CapabilityFunction,
  mitreTechniqueId: string,
  grain: TechniqueTestGrain,
  /** `heldTests / tests`. */
  rate: number,
  tests: number,
  heldTests: number,
  /** The distinct hosts among the tests. */
  hostsTested: number,
  scopeHosts: number,
}

type TestKey = Pick<TechniqueTestResult, 'capabilityId' | 'function' | 'mitreTechniqueId' | 'grain'>;

export const techniqueTestKey = (key: TestKey): string => `${key.capabilityId}|${key.function}|${key.mitreTechniqueId}`;

/**
 * Each control's counted tests as the results the levels store, at the level's `scopeHosts`. Every
 * fresh test counts, so a host tested on two sub-techniques, or by two scenarios, weighs two tests in
 * the rate and one host in the tested share. The engine and the lever rebooking read a row only where
 * the control covers its technique (`testedCellReader`): elsewhere it is shown, the control declaring
 * nothing there to audit.
 *
 * A technique with no fresh test yields no row, and neither does a level with no host.
 */
export const techniqueTestResultsOf = (
  counts: ReadonlyArray<TechniqueTestCount>,
  scopeHosts: number,
): Array<TechniqueTestResult> => {
  if (!(scopeHosts > 0)) {
    return [];
  }
  return counts
    .map(({ expectationType, ...count }): TechniqueTestResult => ({
      capabilityId: count.capabilityId,
      function: EXPECTATION_TYPE_TO_FUNCTION[expectationType],
      mitreTechniqueId: count.mitreTechniqueId,
      grain: count.grain,
      rate: count.heldTests / count.tests,
      tests: count.tests,
      heldTests: count.heldTests,
      hostsTested: count.hostsTested,
      // The population is counted apart from the results, so a host added between the two reads is still within it.
      scopeHosts: Math.max(scopeHosts, count.hostsTested),
    }))
    .sort((first, second) => compareCodePoints(techniqueTestKey(first), techniqueTestKey(second)));
};
