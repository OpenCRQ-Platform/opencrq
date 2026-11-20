import { afterAll, describe, expect, it } from 'vitest';
import type { AttackRunControlState, AttackRunEvaluation, TechniqueInterdiction } from './attack-run-evaluation';
import type { AttackRunFixture } from './attack-run-fixtures';
import type { AttackRunLawInputs } from './attack-run-law';
import { evaluateAttackRun, evaluateBaseline, evaluateWhatIf, prepareWorld, refreshWorld, setControlState } from './attack-run-evaluation';
import { fixtureWorlds, lawInputsFromFixture } from './attack-run-bench-harness';
import { ATTACK_RUN_FIXTURES } from './attack-run-fixtures';
import { compileAttackRunLaw } from './attack-run-law';
import { worldDrawAt } from './attack-run-worlds';

/**
 * A what-if resumed after the obstacles it cannot change answers exactly as one evaluated whole:
 * every interdiction and every move of every control, on every fixture, compared bit for bit with
 * `evaluateAttackRun` on the same world.
 */

const WORLDS = 32;
const SEED = 'prefix-reuse';
const UPGRADED_EFFICACY = 0.85;
/** No evaluation produces it: a figure holding it was read back from the record. */
const MARK = -1;
/** Controls resumed after the door, over every subject: most fixtures hold none, one is there to hold some. */
let resumedControls = 0;

const fixtureNamed = (name: string): AttackRunFixture => ATTACK_RUN_FIXTURES.find((fixture) => fixture.name === name)!;

interface Subject {
  readonly fixture: AttackRunFixture,
  readonly inputs: AttackRunLawInputs,
}

const exfiltration = fixtureNamed('exfiltration-chain');
const uneven = fixtureNamed('uneven-estate');

const asIs = (name: string, fixture: AttackRunFixture): readonly [string, Subject] => [name, { fixture, inputs: lawInputsFromFixture(fixture) }];

const SUBJECTS: ReadonlyArray<readonly [string, Subject]> = [
  // Played on no family, so on no obstacle, yet its prevent interdiction closes the payload stage at the door.
  asIs('uneven-estate playing T1204 on no family', {
    ...uneven,
    repertoire: [...uneven.repertoire, { externalId: 'T1204', tacticExternalIds: ['TA0002'], families: [] }],
  }),
  // Detects a technique the chain plays after the door and prevents nothing.
  asIs('uneven-estate with a control detecting only discovery', {
    ...uneven,
    controls: [...uneven.controls, {
      capabilityExternalId: 'SIEM',
      coverage: 0.8,
      prevent: { strength: 0, techniqueExternalIds: [] },
      detect: { strength: 0.6, techniqueExternalIds: ['T1018'] },
    }],
  }),
  ...ATTACK_RUN_FIXTURES.map((fixture) => asIs(fixture.name, fixture)),
  ['exfiltration-chain with targets at the door, so a direct chain plays', {
    fixture: exfiltration,
    inputs: lawInputsFromFixture({
      ...exfiltration,
      door: { ...exfiltration.door, targetApplicable: [Float64Array.from([3]), Float64Array.from([0])] },
    }),
  }],
  // Each world draws its workstations and its people: the groups, the shares and the door move with the draw.
  ['uneven-estate with declared kinds drawn per world', {
    fixture: uneven,
    inputs: {
      ...lawInputsFromFixture(uneven),
      groups: [
        ...uneven.groups.filter((group) => group.id !== 'accounts'),
        { id: 'accounts', family: 'identity', assets: 40, exposure: 'unknown', criticality: 'medium', matchedByScenarioGroup: false, declaredKinds: ['people'] },
        { id: 'declared-workstations', family: 'host', assets: 0, exposure: 'internal', criticality: 'unknown', matchedByScenarioGroup: false, declaredKinds: ['workstations'] },
        { id: 'declared-web', family: 'web_application', assets: 2, exposure: 'internal', criticality: 'unknown', matchedByScenarioGroup: false, declaredKinds: ['web_applications'] },
      ],
      declaredKinds: [
        { kind: 'people', low: 41, high: 400, held: 1 },
        { kind: 'web_applications', low: 8, high: 60, held: 6 },
        { kind: 'workstations', low: 11, high: 250, held: 120 },
      ],
      door: {
        ...uneven.door,
        applicable: [Float64Array.from([0, 8, 0]), Float64Array.from([0, 0, 0])],
        declared: [
          { kind: 'people', family: 2, techniques: [], people: true },
          { kind: 'web_applications', family: 1, techniques: [0], people: false },
        ],
      },
    },
  }],
  ['uneven-estate with a share of the attacks around the door', {
    fixture: uneven,
    inputs: {
      ...lawInputsFromFixture(uneven),
      withoutInitialAccess: { key: 'access_held_or_outside_perimeter', share: 0.05, techniqueExternalIds: ['T1486'] },
    },
  }],
];

const movesOf = (held: AttackRunControlState): ReadonlyArray<AttackRunControlState> => [
  { ...held, deployed: false },
  {
    deployed: true,
    preventEfficacy: Math.max(held.preventEfficacy, UPGRADED_EFFICACY),
    detectEfficacy: Math.max(held.detectEfficacy, UPGRADED_EFFICACY),
  },
];

describe.each(SUBJECTS)('%s', (_, { fixture, inputs }) => {
  const law = compileAttackRunLaw(inputs);
  const columns = fixtureWorlds(fixture, law.obstacles.length, WORLDS, SEED, inputs.declaredKinds);
  const { resume } = prepareWorld(law, worldDrawAt(columns, 0));

  it('answers every interdiction and every moved control resumed as evaluated whole', () => {
    const world = prepareWorld(law, worldDrawAt(columns, 0));
    let resumed = 0;
    let directPlayed = false;
    for (let index = 0; index < WORLDS; index += 1) {
      const draw = worldDrawAt(columns, index);
      refreshWorld(world, draw);
      const baseline = evaluateBaseline(world);
      expect(baseline, `world ${index}, baseline`).toEqual(evaluateAttackRun(world));
      directPlayed = directPlayed || baseline.direct !== null;

      for (let technique = 0; technique < law.techniqueCount; technique += 1) {
        for (const lever of ['prevent', 'detect'] as const) {
          const interdiction: TechniqueInterdiction = { lever, technique };
          const from = resume[lever][technique];
          resumed += from >= 1 ? 1 : 0;
          expect(evaluateWhatIf(world, interdiction), `world ${index}, ${lever} of ${inputs.repertoire[technique].externalId} from ${from}`)
            .toEqual(evaluateAttackRun(world, interdiction));
        }
      }

      law.controls.forEach((control, controlIndex) => {
        for (const state of movesOf(world.controlStates[controlIndex])) {
          refreshWorld(world, draw, { controlIndex, state });
          const from = resume.control[controlIndex];
          resumed += from >= 1 ? 1 : 0;
          expect(evaluateWhatIf(world), `world ${index}, ${control.capabilityExternalId} moved, from ${from}`)
            .toEqual(evaluateAttackRun(world));
        }
        refreshWorld(world, draw);
      });
    }
    expect(resumed).toBeGreaterThan(0);
    expect(directPlayed).toBe(law.chains.direct !== null && inputs.door.targetApplicable.some((row) => row.some((count) => count > 0)));
  });

  it('reads back from the baseline only the prefix the world as it stands leaves unchanged', () => {
    const world = prepareWorld(law, worldDrawAt(columns, 0));
    const replayedAt = (indexes: ReadonlyArray<number>, from: number): Array<boolean> => indexes.slice(1).map((index) => index < from);
    const markedAt = (clears: ReadonlyArray<number>, indexes: ReadonlyArray<number>): Array<boolean> =>
      clears.slice(1, indexes.length).map((clear) => clear === MARK);
    const expectReplayed = (evaluation: AttackRunEvaluation, from: number, label: string): void => {
      expect(evaluation.anchoring === MARK, label).toBe(from >= 1);
      expect(markedAt(evaluation.clearByObstacle, world.longChain), label).toEqual(replayedAt(world.longChain, from));
      if (evaluation.direct !== null) {
        expect(markedAt(evaluation.direct.clearByObstacle, law.chains.direct!), label).toEqual(replayedAt(law.chains.direct!, from));
      }
    };
    const resumedTechniques = [...resume.detect.keys()].filter((technique) => resume.detect[technique] >= 1);
    let directChecked = false;
    for (let index = 0; index < WORLDS; index += 1) {
      const draw = worldDrawAt(columns, index);
      refreshWorld(world, draw);
      evaluateBaseline(world);
      const recorded = world.baseline;
      recorded.head = { ...recorded.head!, anchoring: MARK };
      for (const outcomes of [recorded.long, recorded.direct]) {
        outcomes.forEach((outcome, position) => {
          outcomes[position] = { ...outcome, clear: MARK };
        });
      }
      for (const technique of resumedTechniques) {
        const resumed = evaluateWhatIf(world, { lever: 'detect', technique });
        directChecked = directChecked || resumed.direct !== null;
        expectReplayed(resumed, resume.detect[technique], `world ${index}, detect of ${inputs.repertoire[technique].externalId}`);
      }

      law.controls.forEach((control, controlIndex) => {
        const [state] = movesOf(world.controlStates[controlIndex]);
        refreshWorld(world, draw, { controlIndex, state });
        expect(() => evaluateBaseline(world)).toThrow();
        expectReplayed(evaluateWhatIf(world), resume.control[controlIndex], `world ${index}, ${control.capabilityExternalId} moved`);
        for (const technique of resumedTechniques) {
          expectReplayed(evaluateWhatIf(world, { lever: 'detect', technique }), 0, `world ${index}, ${control.capabilityExternalId} moved, detect of ${inputs.repertoire[technique].externalId}`);
        }
        refreshWorld(world, draw);
        setControlState(world, controlIndex, state);
        expectReplayed(evaluateWhatIf(world), 0, `world ${index}, ${control.capabilityExternalId} moved in place`);
        for (const technique of resumedTechniques) {
          expectReplayed(evaluateWhatIf(world, { lever: 'detect', technique }), 0, `world ${index}, ${control.capabilityExternalId} moved in place, detect of ${inputs.repertoire[technique].externalId}`);
        }
        refreshWorld(world, draw);
        resumedControls += resume.control[controlIndex] >= 1 ? 1 : 0;
      });
    }
    expect(resumedTechniques.length).toBeGreaterThan(0);
    expect(directChecked).toBe(law.chains.direct !== null && inputs.door.targetApplicable.some((row) => row.some((count) => count > 0)));
  });

  it('evaluates the whole chain when no baseline was recorded on the draw', () => {
    const world = prepareWorld(law, worldDrawAt(columns, 0));
    evaluateBaseline(world);
    refreshWorld(world, worldDrawAt(columns, 1));
    for (let technique = 0; technique < law.techniqueCount; technique += 1) {
      const interdiction: TechniqueInterdiction = { lever: 'detect', technique };
      expect(evaluateWhatIf(world, interdiction)).toEqual(evaluateAttackRun(world, interdiction));
    }
  });
});

afterAll(() => {
  expect(resumedControls).toBeGreaterThan(0);
});
