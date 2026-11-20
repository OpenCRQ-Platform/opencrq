import { describe, expect, it } from 'vitest';
import type { AttackRunControlState, AttackRunEvaluation, ObstacleDiagnostic, PreparedWorld, TechniqueInterdiction } from './attack-run-evaluation';
import type { AttackRunFixture, FixtureControl, FixtureTechnique } from './attack-run-fixtures';
import { evaluateAttackRun, forgoneExploitLeavesDoor, prepareWorld, refreshWorld } from './attack-run-evaluation';
import { fixtureWorlds, lawInputsFromFixture } from './attack-run-bench-harness';
import { ATTACK_RUN_FIXTURES, catalogueCoverage } from './attack-run-fixtures';
import { compileAttackRunLaw } from './attack-run-law';
import { unknownFlawFloor } from './attack-run-door';
import { worldDrawAt } from './attack-run-worlds';

/**
 * A world that has already answered its baseline must answer every later evaluation exactly as a
 * world prepared from the same draw would. Whatever an evaluation keeps from the baseline of its
 * world, this is what says it kept nothing that moves a number.
 *
 * The warm side walks the cases in the order `evaluateWorld` does, on one `PreparedWorld` refreshed
 * from the draw before each case, and the cold side prepares a fresh world per case.
 */

const WORLDS = 64;
const SEED = 'door-reuse';
/** Raises the floor so that several families draw it within `WORLDS`. */
const UNKNOWN_FLAW_FLOOR_SCALE = 0.1;
const UPGRADED_EFFICACY = 0.85;

const base = ATTACK_RUN_FIXTURES.find((fixture) => fixture.name === 'uneven-estate')!;

const subTechnique = (externalId: string): FixtureTechnique => ({
  externalId,
  tacticExternalIds: ['TA0001'],
  families: ['host', 'identity'],
  populationScoped: true,
});

const catalogued = (capabilityExternalId: string, strength: number, coverage: number): FixtureControl => ({
  capabilityExternalId,
  coverage,
  prevent: { strength, techniqueExternalIds: catalogueCoverage(capabilityExternalId, 'prevent') },
  detect: { strength, techniqueExternalIds: catalogueCoverage(capabilityExternalId, 'detect') },
});

/**
 * The uneven estate with its phishing door split in two sub-techniques of one parent, which makes
 * the door two layers. `SEG` prevents both on the host and identity families, `NGFW` prevents
 * T1190 and is the one a sabotage technique takes down, and `IGA` covers no technique the
 * repertoire plays at the door. `CVE-2024-0001` opens two door techniques.
 */
const FIXTURE: AttackRunFixture = {
  ...base,
  name: 'door-reuse',
  actorClass: { ...base.actorClass, capability: 0.9 },
  repertoire: [
    subTechnique('T1566.001'),
    subTechnique('T1566.002'),
    ...base.repertoire.filter((technique) => technique.externalId !== 'T1566'),
  ],
  controls: [
    catalogued('SEG', 0.6, 0.6),
    base.controls.find((control) => control.capabilityExternalId === 'NGFW')!,
    catalogued('IGA', 0.7, 1),
  ],
  constants: { ...base.constants, unknownFlawFloorScale: UNKNOWN_FLAW_FLOOR_SCALE },
  door: {
    techniques: ['T1190', 'T1566'],
    families: ['host', 'web_application', 'identity'],
    cves: [
      { cveId: 'CVE-2024-0001', threat: 0.6, priced: true },
      { cveId: 'CVE-2024-0002', threat: 0.3, priced: true },
      { cveId: 'CVE-2024-0003', threat: 0.5, priced: true },
    ],
    assets: [
      { family: 1, openings: [{ cve: 0, technique: 0, opening: 0.5 }], target: false },
      { family: 0, openings: [{ cve: 0, technique: 0, opening: 0.4 }, { cve: 0, technique: 1, opening: 0.4 }], target: false },
      { family: 0, openings: [{ cve: 1, technique: 1, opening: 0.3 }], target: false },
      { family: 2, openings: [{ cve: 2, technique: 1, opening: 0.6 }], target: false },
      { family: 1, openings: [{ cve: 2, technique: 0, opening: 0.2 }, { cve: 1, technique: 0, opening: 0.2 }], target: false },
      { family: 0, openings: [{ cve: 1, technique: 0, opening: 0.3 }], target: false },
    ],
    applicable: [Float64Array.from([10, 6, 0]), Float64Array.from([124, 0, 40])],
    targetApplicable: [Float64Array.from([0, 0, 0]), Float64Array.from([0, 0, 0])],
    phishing: null,
  },
};

/**
 * The same estate with phishing read from its people: no T1566 on the assets, forty people whose
 * devices carry flaws, and the sub-techniques playing the same two layers. `IGA` acts on the
 * credential branch alone, since the repertoire plays no T1078.
 */
const PHISHING_FIXTURE: AttackRunFixture = {
  ...FIXTURE,
  name: 'door-reuse-phishing',
  door: {
    techniques: ['T1190', 'T1566'],
    families: ['host', 'web_application', 'identity'],
    cves: FIXTURE.door.cves,
    assets: [
      { family: 1, openings: [{ cve: 0, technique: 0, opening: 0.5 }], target: false },
      { family: 1, openings: [{ cve: 1, technique: 0, opening: 0.2 }], target: false },
    ],
    applicable: [Float64Array.from([10, 6, 0]), Float64Array.from([0, 0, 0])],
    targetApplicable: [Float64Array.from([0, 0, 0]), Float64Array.from([0, 0, 0])],
    phishing: {
      personFamily: 2,
      deviceFamily: 0,
      people: 40,
      targetPeople: 0,
      persons: [
        { target: false, devices: [{ family: 0, openings: [{ cve: 0, technique: 1, opening: 0.4 }, { cve: 1, technique: 1, opening: 0.3 }] }] },
        { target: false, devices: [{ family: 0, openings: [{ cve: 2, technique: 1, opening: 0.6 }] }] },
      ],
      cleanPersons: [],
    },
  },
};

interface Subject {
  readonly fixture: AttackRunFixture,
  readonly inputs: ReturnType<typeof lawInputsFromFixture>,
  readonly law: ReturnType<typeof compileAttackRunLaw>,
  readonly memorylessLaw: ReturnType<typeof compileAttackRunLaw>,
  readonly draws: ReadonlyArray<ReturnType<typeof worldDrawAt>>,
  readonly floor: number,
}

const subjectOf = (fixture: AttackRunFixture): Subject => {
  const inputs = lawInputsFromFixture(fixture);
  const law = compileAttackRunLaw(inputs);
  const memorylessLaw = compileAttackRunLaw({ ...inputs, constants: { ...inputs.constants, signalGain: 0 } });
  const columns = fixtureWorlds(fixture, law.obstacles.length, WORLDS, SEED);
  return {
    fixture,
    inputs,
    law,
    memorylessLaw,
    draws: Array.from({ length: WORLDS }, (_, world) => worldDrawAt(columns, world)),
    floor: unknownFlawFloor(inputs.actorClass.capability, inputs.constants.unknownFlawFloorScale),
  };
};

const SUBJECTS: ReadonlyArray<readonly [string, Subject]> = [
  ['a door read per asset', subjectOf(FIXTURE)],
  ['a door read per person for phishing', subjectOf(PHISHING_FIXTURE)],
];

const upgradedFrom = (held: AttackRunControlState): AttackRunControlState => ({
  deployed: true,
  preventEfficacy: Math.max(held.preventEfficacy, UPGRADED_EFFICACY),
  detectEfficacy: Math.max(held.detectEfficacy, UPGRADED_EFFICACY),
});

const absentFrom = (held: AttackRunControlState): AttackRunControlState => ({ ...held, deployed: false });

describe.each(SUBJECTS)('%s', (_, { fixture, inputs, law, memorylessLaw, draws, floor }) => {
  describe('the fixture of the door reuse guard', () => {
    it('has a door of two layers, a door-protecting control and one protecting none', () => {
      expect(law.door.layers.length).toBeGreaterThanOrEqual(2);
      const playedAtDoor = new Set(law.door.layers.flatMap((layer) => [...layer.repertoire].filter((index) => index >= 0)));
      const [seg, firewall, iga] = law.controls;
      expect(seg.preventTechniques.some((technique) => playedAtDoor.has(technique))).toBe(true);
      expect(firewall.preventTechniques.some((technique) => playedAtDoor.has(technique))).toBe(true);
      expect(iga.preventTechniques.some((technique) => playedAtDoor.has(technique))).toBe(false);
      expect(iga.detectTechniques.some((technique) => playedAtDoor.has(technique))).toBe(false);
      expect(law.controls[1].impairedBy.length).toBeGreaterThan(0);
    });

    it('draws the floor of a family in some worlds and each flaw in some worlds but not all', () => {
      fixture.door.families.forEach((family, index) => {
        const drawn = draws.filter((draw) => draw.familyUniform[index] < floor).length;
        expect(drawn, `floor of ${family}`).toBeGreaterThan(0);
        expect(drawn, `floor of ${family}`).toBeLessThan(WORLDS);
      });
      fixture.door.cves.forEach((cve, index) => {
        const drawn = draws.filter((draw) => draw.cveUniform[index] < cve.threat).length;
        expect(drawn, cve.cveId).toBeGreaterThan(0);
        expect(drawn, cve.cveId).toBeLessThan(WORLDS);
      });
    });
  });

  describe('an evaluation on a world that answered its baseline', () => {
    it('answers as an evaluation on a freshly prepared world, case by case', () => {
      const warm = prepareWorld(law, draws[0]);
      const warmMemoryless = prepareWorld(memorylessLaw, draws[0]);
      const tables = warm.preventByFamily;
      const door = (evaluation: AttackRunEvaluation): number => evaluation.clearByObstacle[0];
      let compared = 0;
      const moved = { interdiction: false, control: false, memoryless: false, credentialStage: false };
      const forgone = fixture.door.cves.map(() => false);

      const same = (label: string, onWarm: AttackRunEvaluation, onCold: AttackRunEvaluation): void => {
        expect(onWarm, label).toEqual(onCold);
        compared += 1;
      };
      const cold = (world: number): PreparedWorld => prepareWorld(law, draws[world]);

      for (let world = 0; world < WORLDS; world += 1) {
        const draw = draws[world];
        refreshWorld(warm, draw);
        const baseline = evaluateAttackRun(warm);
        expect(warm.draw, `world ${world}`).toBe(draw);
        expect(warm.preventByFamily, `world ${world}`).toBe(tables);
        same(`world ${world}, baseline`, baseline, evaluateAttackRun(cold(world)));

        refreshWorld(warmMemoryless, draw);
        const memoryless = evaluateAttackRun(warmMemoryless);
        same(`world ${world}, memoryless`, memoryless, evaluateAttackRun(prepareWorld(memorylessLaw, draw)));
        moved.memoryless = moved.memoryless || memoryless.detectPosture !== baseline.detectPosture || memoryless.unseen !== baseline.unseen;

        for (let technique = 0; technique < law.techniqueCount; technique += 1) {
          for (const lever of ['prevent', 'detect'] as const) {
            const interdiction: TechniqueInterdiction = { lever, technique };
            const label = `world ${world}, ${lever} of ${inputs.repertoire[technique].externalId}`;
            refreshWorld(warm, draw);
            const onWarm = evaluateAttackRun(warm, interdiction);
            same(label, onWarm, evaluateAttackRun(cold(world), interdiction));
            moved.interdiction = moved.interdiction || door(onWarm) !== door(baseline);
          }
        }

        law.controls.forEach((control, controlIndex) => {
          const label = `world ${world}, ${control.capabilityExternalId}`;
          const held = cold(world).controlStates[controlIndex];
          const movedTo = (state: AttackRunControlState): PreparedWorld => {
            refreshWorld(warm, draw, { controlIndex, state });
            const fresh = cold(world);
            refreshWorld(fresh, draw, { controlIndex, state });
            return fresh;
          };

          const absentFresh = movedTo(absentFrom(held));
          const absent = evaluateAttackRun(warm);
          same(`${label} absent`, absent, evaluateAttackRun(absentFresh));

          const upgradedFresh = movedTo(upgradedFrom(held));
          same(`${label} upgraded`, evaluateAttackRun(warm), evaluateAttackRun(upgradedFresh));
          moved.control = moved.control || (controlIndex === 0 && door(absent) !== door(baseline));
          moved.credentialStage = moved.credentialStage
            || (control.capabilityExternalId === 'IGA' && door(absent) !== door(baseline));
        });

        fixture.door.cves.forEach((cve, index) => {
          refreshWorld(warm, draw);
          const onWarm = evaluateAttackRun(warm, undefined, undefined, index);
          same(`world ${world}, forgone ${cve.cveId}`, onWarm, evaluateAttackRun(cold(world), undefined, undefined, index));
          forgone[index] = forgone[index] || door(onWarm) !== door(baseline);
        });
      }

      expect(compared).toBe(WORLDS * (2 + 2 * law.techniqueCount + 2 * law.controls.length + fixture.door.cves.length));
      expect(moved).toEqual({ interdiction: true, control: true, memoryless: true, credentialStage: fixture.door.phishing !== null });
      expect(forgone).toEqual(fixture.door.cves.map(() => true));
    });
  });

  describe('a drawn exploit the door memo says forgoing leaves the door', () => {
    it('answers the baseline exactly when forgone, and only the memo of its own draw says so', () => {
      const warm = prepareWorld(law, draws[0]);
      const said = { leaves: 0, moves: 0 };
      for (let world = 0; world < WORLDS; world += 1) {
        const draw = draws[world];
        refreshWorld(warm, draw);
        const baseline = evaluateAttackRun(warm);
        fixture.door.cves.forEach((cve, index) => {
          if (!(draw.cveUniform[index] < cve.threat)) {
            return;
          }
          const leaves = forgoneExploitLeavesDoor(warm, index);
          refreshWorld(warm, draw);
          const onWarm = evaluateAttackRun(warm, undefined, undefined, index);
          if (leaves) {
            said.leaves += 1;
            expect(onWarm, `world ${world}, forgone ${cve.cveId}`).toEqual(baseline);
          } else {
            said.moves += 1;
          }
        });
        refreshWorld(warm, draws[(world + 1) % WORLDS]);
        expect([...fixture.door.cves.keys()].some((index) => forgoneExploitLeavesDoor(warm, index)), `world ${world}, next draw`).toBe(false);
      }
      expect(said.leaves).toBeGreaterThan(0);
      expect(said.moves).toBeGreaterThan(0);
    });
  });
});

describe('a forgone CVE on groups that floor routes', () => {
  const FLOOR_SHARE = 0.5;

  it.each(SUBJECTS)('answers on a warm world as on a freshly prepared one, %s', (_, { fixture, inputs, draws }) => {
    const floored = compileAttackRunLaw({
      ...inputs,
      groups: inputs.groups.map((group) => ({
        ...group,
        cveFloors: inputs.repertoire.map((technique) => ({ techniqueExternalId: technique.externalId, share: FLOOR_SHARE })),
      })),
    });
    const warm = prepareWorld(floored, draws[0]);
    let undrawn = 0;
    for (let world = 0; world < WORLDS; world += 1) {
      const draw = draws[world];
      refreshWorld(warm, draw);
      const baseline = evaluateAttackRun(warm);
      fixture.door.cves.forEach((cve, index) => {
        refreshWorld(warm, draw);
        const onWarm = evaluateAttackRun(warm, undefined, undefined, index);
        expect(onWarm, `world ${world}, forgone ${cve.cveId}`).toEqual(evaluateAttackRun(prepareWorld(floored, draw), undefined, undefined, index));
        if (!(draw.cveUniform[index] < cve.threat)) {
          undrawn += 1;
          expect(onWarm, `world ${world}, undrawn ${cve.cveId}`).toEqual(baseline);
        }
      });
    }
    expect(undrawn).toBeGreaterThan(0);
  });
});

describe('a world of another set of groups sharing the door memo of the baseline world', () => {
  const flooredLawOf = (inputs: Subject['inputs']) => compileAttackRunLaw({
    ...inputs,
    groups: inputs.groups.map((group) => ({
      ...group,
      cveFloors: inputs.repertoire.map((technique) => ({ techniqueExternalId: technique.externalId, share: 0.5 })),
    })),
  });

  it.each(SUBJECTS)('answers as a freshly prepared world, %s', (_, { fixture, inputs, law, draws }) => {
    const floored = flooredLawOf(inputs);
    const baseline = prepareWorld(law, draws[0]);
    const shared = prepareWorld(floored, draws[0], baseline);
    expect(shared.doorState).toBe(baseline.doorState);
    for (let world = 0; world < WORLDS; world += 1) {
      const draw = draws[world];
      refreshWorld(baseline, draw);
      const answered = evaluateAttackRun(baseline);
      for (const forgone of [-1, ...fixture.door.cves.keys()]) {
        refreshWorld(shared, draw);
        expect(evaluateAttackRun(shared, undefined, undefined, forgone), `world ${world}, forgone ${forgone}`)
          .toEqual(evaluateAttackRun(prepareWorld(floored, draw), undefined, undefined, forgone));
      }
      refreshWorld(baseline, draw);
      expect(evaluateAttackRun(baseline), `world ${world}, baseline after`).toEqual(answered);
    }
  });

  it('keeps its own memo when its door is read through other family indexes', () => {
    const { inputs, law, draws } = SUBJECTS[0][1];
    const [kept] = inputs.groups;
    const narrowed = compileAttackRunLaw({ ...inputs, groups: [kept] });
    expect([...narrowed.door.familyIndexes]).not.toEqual([...law.door.familyIndexes]);
    const baseline = prepareWorld(law, draws[0]);
    expect(prepareWorld(narrowed, draws[0], baseline).doorState).not.toBe(baseline.doorState);
  });
});

describe('a world rebuilt with one control at its drawn state', () => {
  /** Nine controls on overlapping techniques, so a cell's product holds several factors and a move in place leaves it off in the last ulp. */
  const STACKED: AttackRunFixture = {
    ...FIXTURE,
    controls: ['SEG', 'EDR', 'OSH', 'SIEM', 'NDR', 'NGFW', 'IDP', 'PAM', 'ZTNA']
      .map((capabilityExternalId, index) => catalogued(capabilityExternalId, 0.3 + 0.07 * index, 0.5 + 0.05 * index)),
  };
  const stackedLaw = compileAttackRunLaw(lawInputsFromFixture(STACKED));
  const stackedColumns = fixtureWorlds(STACKED, stackedLaw.obstacles.length, WORLDS, SEED);

  it('holds the products of the plain refresh bit for bit, after any evaluation', () => {
    const warm = prepareWorld(stackedLaw, worldDrawAt(stackedColumns, 0));
    for (let world = 0; world < WORLDS; world += 1) {
      const draw = worldDrawAt(stackedColumns, world);
      const plain = prepareWorld(stackedLaw, draw);
      const prevent = Float64Array.from(plain.preventByFamily);
      const detect = Float64Array.from(plain.detectByFamily);
      const baseline = evaluateAttackRun(plain);
      stackedLaw.controls.forEach((control, controlIndex) => {
        const label = `world ${world}, ${control.capabilityExternalId}`;
        refreshWorld(warm, draw, { controlIndex, state: upgradedFrom(plain.controlStates[controlIndex]) });
        evaluateAttackRun(warm);
        refreshWorld(warm, draw, { controlIndex, state: plain.controlStates[controlIndex] });
        expect(warm.preventByFamily, label).toEqual(prevent);
        expect(warm.detectByFamily, label).toEqual(detect);
        expect(evaluateAttackRun(warm), label).toEqual(baseline);
      });
    }
  });

  it('leaves the products at the bits it found, whatever its knockouts', () => {
    const warm = prepareWorld(stackedLaw, worldDrawAt(stackedColumns, 0));
    let knocked = 0;
    for (let world = 0; world < WORLDS; world += 1) {
      refreshWorld(warm, worldDrawAt(stackedColumns, world));
      const tables = [warm.preventByFamily, warm.detectByFamily, warm.phishingLetThrough].map((table) => Float64Array.from(table));
      const interdictions: ReadonlyArray<TechniqueInterdiction | undefined> = [
        undefined,
        ...Array.from({ length: stackedLaw.techniqueCount }, (_, technique) => ({ lever: 'prevent' as const, technique })),
        ...Array.from({ length: stackedLaw.techniqueCount }, (_, technique) => ({ lever: 'detect' as const, technique })),
      ];
      for (const interdiction of interdictions) {
        const diagnostics: Array<ObstacleDiagnostic> = [];
        evaluateAttackRun(warm, interdiction, diagnostics);
        knocked += diagnostics.filter((obstacle) => obstacle.knockedCapabilityExternalIds.length > 0).length;
        expect([warm.preventByFamily, warm.detectByFamily, warm.phishingLetThrough], `world ${world}, ${JSON.stringify(interdiction)}`).toEqual(tables);
      }
    }
    expect(knocked).toBeGreaterThan(0);
  });
});
