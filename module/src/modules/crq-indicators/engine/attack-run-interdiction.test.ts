import { describe, expect, it } from 'vitest';
import type { AssetCategory } from '../../supporting-assets/constants';
import type { AttackRunEvaluation, TechniqueInterdiction } from './attack-run-evaluation';
import type { AttackRunControl, AttackRunLawInputs } from './attack-run-law';
import { CONTROL_FAMILY_PROTECTION } from '../../controls/capability/data/control-family-protection';
import { compileAttackRunLaw } from './attack-run-law';
import { evaluateAttackRun, prepareWorld } from './attack-run-evaluation';
import { fixtureWorlds, lawInputsFromFixture } from './attack-run-bench-harness';
import { ATTACK_RUN_FIXTURES } from './attack-run-fixtures';
import { worldDrawAt } from './attack-run-worlds';

/**
 * An interdiction has no recompilation to check against. The one definition that cannot drift is
 * that it is the **limit of a posture a defender can buy**: controls covering the technique on
 * every family at an efficacy approaching one. The engine refuses an efficacy of exactly one, a
 * knockout having to be divisible back out, so the limit is approached rather than reached.
 */

const WORLDS = 8;
/** Near enough that the residue vanishes, far enough from one to stay divisible. */
const ALMOST_CERTAIN = 1 - 1e-9;
const TOLERANCE = 1e-6;

/** Every number an evaluation answers, flattened, so nothing is compared by omission. */
const flatten = (evaluation: AttackRunEvaluation): Array<number> => [
  evaluation.outcomes.blocked,
  evaluation.outcomes.evicted,
  evaluation.outcomes.impactDetected,
  evaluation.outcomes.impactUndetected,
  evaluation.reach,
  evaluation.reachedUnseen,
  evaluation.unseen,
  evaluation.anchoring,
  evaluation.eviction,
  evaluation.detectPosture,
  evaluation.firstDetectionAtAnchoring,
  ...evaluation.clearByObstacle,
  ...evaluation.firstDetectionAtObstacle,
];

/**
 * Capabilities covering the estate's families between them, none already declared by the fixture:
 * it takes several, no capability of the catalogue protecting every family.
 */
const coveringCapabilities = (families: ReadonlySet<AssetCategory>, taken: ReadonlySet<string>): Array<string> => {
  const protection = CONTROL_FAMILY_PROTECTION as Readonly<Record<string, ReadonlyArray<AssetCategory>>>;
  const uncovered = new Set(families);
  const chosen: Array<string> = [];
  while (uncovered.size > 0) {
    const [best] = Object.keys(protection)
      .filter((capability) => !taken.has(capability) && !chosen.includes(capability))
      .map((capability) => ({ capability, gain: protection[capability].filter((family) => uncovered.has(family)).length }))
      .sort((one, other) => other.gain - one.gain);
    expect(best?.gain ?? 0, `no capability left protects ${[...uncovered].join(', ')}`).toBeGreaterThan(0);
    protection[best.capability].forEach((family) => uncovered.delete(family));
    chosen.push(best.capability);
  }
  return chosen;
};

describe('an interdiction against the posture it is the limit of', () => {
  it.each(ATTACK_RUN_FIXTURES.map((fixture) => fixture.name))('closes on every technique of %s', (name) => {
    const fixture = ATTACK_RUN_FIXTURES.find((candidate) => candidate.name === name)!;
    const inputs = lawInputsFromFixture(fixture);
    const declared = compileAttackRunLaw(inputs);
    const columns = fixtureWorlds(fixture, declared.obstacles.length, WORLDS, 'interdiction');
    const capabilities = coveringCapabilities(
      new Set(inputs.groups.map((group) => group.family)),
      new Set(inputs.controls.map((control) => control.capabilityExternalId)),
    );

    inputs.repertoire.forEach((target, index) => {
      const covering: Array<AttackRunControl> = capabilities.map((capabilityExternalId) => ({
        capabilityExternalId,
        preventTechniqueExternalIds: [target.externalId],
        detectTechniqueExternalIds: [target.externalId],
      }));
      const covered: AttackRunLawInputs = { ...inputs, controls: [...inputs.controls, ...covering] };
      const compiled = compileAttackRunLaw(covered);

      (['prevent', 'detect'] as const).forEach((lever) => {
        const interdiction: TechniqueInterdiction = { lever, technique: index };
        for (let world = 0; world < WORLDS; world += 1) {
          const draw = worldDrawAt(columns, world);
          const byInterdiction = flatten(evaluateAttackRun(prepareWorld(declared, draw), interdiction));
          const byPosture = flatten(evaluateAttackRun(prepareWorld(compiled, {
            ...draw,
            deployed: [...draw.deployed, ...covering.map(() => true)],
            preventEfficacy: [...draw.preventEfficacy, ...covering.map(() => (lever === 'prevent' ? ALMOST_CERTAIN : 0))],
            detectEfficacy: [...draw.detectEfficacy, ...covering.map(() => (lever === 'detect' ? ALMOST_CERTAIN : 0))],
            // A uniform of one never fires, so the added controls are never knocked out and never
            // divided back out at an efficacy that leaves nothing to divide.
            knockoutUniform: [...draw.knockoutUniform, ...covering.map(() => declared.obstacles.map(() => 1))],
          })));
          byInterdiction.forEach((value, position) => {
            expect(Math.abs(value - byPosture[position]), `${name}, ${lever} of ${target.externalId}, world ${world}, output ${position}`)
              .toBeLessThan(TOLERANCE);
          });
        }
      });
    });
  });
});
