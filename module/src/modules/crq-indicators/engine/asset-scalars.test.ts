import { describe, expect, it } from 'vitest';
import { DECLARED_CRITICALITY_VALUES } from '../../supporting-assets/constants';
import { CRITICALITY_SCALARS, EXPOSURE_SCALARS, resourceStepWeight, stepWeight } from './asset-scalars';
import {
  ACTOR_EXPLOITED_CVE_FLOOR,
  COUPLE_SUCCESS_CAP,
  MISCONFIGURED_RESIDUAL_DELTA,
  SCENARIO_GROUP_BOOST_G,
  TEST_FRESHNESS_ENABLED,
  TEST_FRESHNESS_TAU_DAYS,
} from './engine-constants';

describe('the asset scalars', () => {
  it('map every enum value onto a positive scalar', () => {
    expect(Object.keys(EXPOSURE_SCALARS).sort()).toEqual(['internal', 'internet_facing']);
    expect(Object.keys(CRITICALITY_SCALARS).sort()).toEqual([...DECLARED_CRITICALITY_VALUES].sort());
    for (const value of [...Object.values(EXPOSURE_SCALARS), ...Object.values(CRITICALITY_SCALARS)]) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('reserve the normalised ceiling for the top band alone', () => {
    expect(CRITICALITY_SCALARS.very_high).toBe(1.0);
    expect(CRITICALITY_SCALARS.high).toBe(0.9);
    expect(CRITICALITY_SCALARS.medium).toBe(0.7);
    expect(CRITICALITY_SCALARS.low).toBe(0.4);
  });

  it('weighs purely by exposure at the door and purely by criticality at depth one', () => {
    expect(stepWeight('internet_facing', 'low', 0)).toBe(EXPOSURE_SCALARS.internet_facing);
    expect(stepWeight('internet_facing', 'low', 1)).toBe(CRITICALITY_SCALARS.low);
    expect(stepWeight('internal', 'high', 0.5))
      .toBeCloseTo(EXPOSURE_SCALARS.internal ** 0.5 * CRITICALITY_SCALARS.high ** 0.5, 10);
  });

  it('boosts matched assets at resource-touching steps and floors the rest at one, never zero', () => {
    expect(resourceStepWeight(true)).toBe(SCENARIO_GROUP_BOOST_G);
    expect(resourceStepWeight(false)).toBe(1);
  });
});

describe('the engine constants', () => {
  it('export the platform defaults', () => {
    expect(MISCONFIGURED_RESIDUAL_DELTA).toBe(0.3);
    expect(SCENARIO_GROUP_BOOST_G).toBe(10);
    expect(COUPLE_SUCCESS_CAP).toBe(0.98);
    expect(ACTOR_EXPLOITED_CVE_FLOOR).toBe(0.9);
  });

  it('ship freshness present but off', () => {
    expect(TEST_FRESHNESS_TAU_DAYS).toBe(180);
    expect(TEST_FRESHNESS_ENABLED).toBe(false);
  });

});
