import type { DeclaredCriticality } from '../../supporting-assets/constants';
import type { DeclaredExposure } from '../../supporting-assets/schema';
import { SCENARIO_GROUP_BOOST_G } from './engine-constants';

/**
 * Exposure scalar for the step weighting, aligned on the exposure weights the flat indicator
 * already uses. An unknown exposure has no scalar of its own: the law reads it as the tenant setting.
 */
export const EXPOSURE_SCALARS: Readonly<Record<DeclaredExposure, number>> = {
  internet_facing: 1.0,
  internal: 0.4,
};

/**
 * Criticality scalar for the step weighting: blast radius, never business value. An unknown
 * criticality has no scalar of its own: the law reads it as the tenant setting. The scalar is
 * normalised, so the top band takes the 1.0 ceiling and the rest read as each band's upper bound
 * over 100.
 */
export const CRITICALITY_SCALARS: Readonly<Record<DeclaredCriticality, number>> = {
  low: 0.4,
  medium: 0.7,
  high: 0.9,
  very_high: 1.0,
};

/**
 * Weight of an asset at an entry or progression step of depth `d` in [0, 1]: purely exposure at
 * the door, a continuous exposure/criticality mix in depth. Not for resource-touching steps,
 * which weigh by {@link resourceStepWeight} instead.
 */
export const stepWeight = (exposure: DeclaredExposure, criticality: DeclaredCriticality, depth: number): number =>
  EXPOSURE_SCALARS[exposure] ** (1 - depth) * CRITICALITY_SCALARS[criticality] ** depth;

/**
 * Weight of an asset at a resource-touching step: the scenario-group boost when matched, a floor
 * of one otherwise, never zero, because the forgotten copy outside the perimeter always exists
 * for the attacker.
 */
export const resourceStepWeight = (matchedByScenarioGroup: boolean): number =>
  (matchedByScenarioGroup ? SCENARIO_GROUP_BOOST_G : 1);

/**
 * How many attackable assets a group counts for on the path around the door: one when the scenario
 * depends on it, the inverse of the boost otherwise. Fixed whether or not the scenario has a
 * matched group, so that exposing an asset can only raise the vulnerability.
 */
export const attackedAssetWeight = (matchedByScenarioGroup: boolean): number =>
  (matchedByScenarioGroup ? 1 : 1 / SCENARIO_GROUP_BOOST_G);
