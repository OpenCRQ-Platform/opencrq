import { describe, expect, it } from 'vitest';
import { CONTROL_FAMILY_PROTECTION } from '../../controls/capability/data/control-family-protection';
import { ATTACK_RUN_FIXTURES, catalogueCoverage } from './attack-run-fixtures';

/**
 * The fixtures are hand-written data that other tests arbitrate the law against, so a fixture that
 * is quietly impossible, a posture no tenant could declare, turns those tests into assertions about
 * nothing. These hold the set to what the shipped catalogue can actually express, and to the shapes
 * the mechanisms under test need in order to be exercised at all.
 */

describe('the fixture set', () => {
  it('holds a group of fewer than ten assets, so the without-replacement term is exercised', () => {
    expect(ATTACK_RUN_FIXTURES.some((fixture) => fixture.groups.some((group) => group.assets < 10))).toBe(true);
  });

  it('holds a control at partial coverage, so the deployment common mode is exercised', () => {
    expect(ATTACK_RUN_FIXTURES.some((fixture) => fixture.controls.some((control) => control.coverage > 0 && control.coverage < 1))).toBe(true);
  });

  it('declares no control coverage the shipped catalogue does not carry', () => {
    for (const fixture of ATTACK_RUN_FIXTURES) {
      for (const control of fixture.controls) {
        for (const capabilityFunction of ['prevent', 'detect'] as const) {
          const catalogued = new Set(catalogueCoverage(control.capabilityExternalId, capabilityFunction));
          const invented = control[capabilityFunction].techniqueExternalIds.filter((externalId) => !catalogued.has(externalId));
          expect(invented, `${fixture.name} ${control.capabilityExternalId} ${capabilityFunction}`).toEqual([]);
        }
      }
    }
  });

  it('names only capabilities the catalogue gives at least one family to protect', () => {
    for (const fixture of ATTACK_RUN_FIXTURES) {
      for (const control of fixture.controls) {
        const protection: Readonly<Record<string, ReadonlyArray<string>>> = CONTROL_FAMILY_PROTECTION;
        const families = protection[control.capabilityExternalId];
        expect(families, `${fixture.name} ${control.capabilityExternalId}`).toBeDefined();
        expect(families.length).toBeGreaterThan(0);
      }
    }
  });

  it('says what each case is there to break', () => {
    for (const fixture of ATTACK_RUN_FIXTURES) {
      expect(fixture.exercises.length, fixture.name).toBeGreaterThan(20);
    }
  });
});
