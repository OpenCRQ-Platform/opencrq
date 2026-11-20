import type { AttackRunFixture } from './attack-run-fixtures';
import type { AttackRunDeclaredKind, AttackRunLawInputs } from './attack-run-law';
import type { AttackRunAxisValues, AttackRunWorlds } from './attack-run-worlds';
import { buildAttackRunWorlds } from './attack-run-worlds';

/**
 * What a bench needs to run the closed forms on an attack run fixture.
 *
 * Test-only, like the fixtures themselves: no production path imports it. It lives outside the test
 * files because a test file importing another test file re-registers that file's suites, so the
 * same assertions would run twice under a different name.
 */

/** A fixture's declarations as the closed forms read them. The two shapes are the same law. */
export const lawInputsFromFixture = (fixture: AttackRunFixture): AttackRunLawInputs => ({
  terminalTacticExternalId: fixture.terminalTacticExternalId,
  actorClass: fixture.actorClass,
  repertoire: fixture.repertoire,
  groups: fixture.groups,
  controls: fixture.controls.map((control) => ({
    capabilityExternalId: control.capabilityExternalId,
    preventTechniqueExternalIds: control.prevent.techniqueExternalIds,
    detectTechniqueExternalIds: control.detect.techniqueExternalIds,
  })),
  constants: fixture.constants,
  door: fixture.door,
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
});

const pointAxis = (strength: number): AttackRunAxisValues => ({
  strength,
  upgradedStrength: strength,
});

/** The worlds a fixture is evaluated on, every control at the strength the fixture states. */
export const fixtureWorlds = (
  fixture: AttackRunFixture,
  obstacleCount: number,
  worlds: number,
  seed: string,
  declaredKinds?: ReadonlyArray<AttackRunDeclaredKind>,
): AttackRunWorlds =>
  buildAttackRunWorlds({
    controls: fixture.controls.map((control) => ({
      capabilityExternalId: control.capabilityExternalId,
      coverage: control.coverage,
      upgradedCoverage: control.coverage,
      prevent: pointAxis(control.prevent.strength),
      detect: pointAxis(control.detect.strength),
    })),
    obstacleCount,
    reactionTimeHours: fixture.reactionTimeHours,
    worlds,
    seed,
    cveIds: fixture.door.cves.map((cve) => cve.cveId),
    familyIds: fixture.door.families,
    declaredKinds,
  });
