import type { CapabilityFunction } from '@app/module/client';
import type { CapabilityDetail, CapabilityEdge } from '../types/capability';
import type { ValidationCell } from '../types/validation';
import type { ProvenPosture } from './validation-summary-utils';
import { coveredTechniquesForFunction } from './technique-matrix-utils';
import { summariseProvenPosture } from './validation-summary-utils';

/**
 * Expectations the control carries on one function: the techniques it still covers, tenant
 * additions included and tenant removals excluded. This is the denominator of the proof coverage,
 * and it is counted from the edges the page already holds rather than asked of the backend.
 */
export const creditedExpectations = (
  edges: Array<CapabilityEdge>,
  capabilityFunction: CapabilityFunction,
): number => coveredTechniquesForFunction(edges, capabilityFunction).length;

/**
 * Whether a simulation can ever say anything about this control.
 *
 * The derivation attributes a result through the security-platform-family junction, so a control no
 * family implements can never receive one. It is not untested, it is untestable, and a proof
 * coverage of zero on it would read as a gap someone could go and close. The controls list counts
 * the same controls as out of simulation reach, so the rule is named once here rather than restated
 * at each surface that has to tell the two apart.
 */
export const isSimulationReachable = (
  capability: Pick<CapabilityDetail, 'securityPlatformFamilies'>,
): boolean => capability.securityPlatformFamilies.length > 0;

/**
 * Proven posture is stated per function or not at all: the two questions a control answers, whether
 * it blocked the attack and whether it saw it, do not average into one figure.
 */
export const posturePerFunction = (
  cells: ReadonlyArray<ValidationCell>,
  edges: Array<CapabilityEdge>,
  capabilityFunction: CapabilityFunction,
): ProvenPosture => summariseProvenPosture(
  cells.filter((cell) => cell.function === capabilityFunction),
  creditedExpectations(edges, capabilityFunction),
);

/**
 * The posture a function's figures measure against, or null when its credited perimeter alone is
 * stated: nothing measured, a control not deployed on the scope (it contests no technique there, so
 * a measurement would credit what it does not defend), or no perimeter at all, where `0% (0 / 0)`
 * would be a ratio of nothing to nothing dressed as a coverage.
 */
export const measuredPosture = (posture: ProvenPosture | undefined, notDeployedOnScope: boolean): ProvenPosture | null =>
  (!notDeployedOnScope && posture !== undefined && posture.credited > 0 ? posture : null);
