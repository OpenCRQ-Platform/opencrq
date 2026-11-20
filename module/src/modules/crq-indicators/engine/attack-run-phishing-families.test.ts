import { describe, expect, it } from 'vitest';
import type { AttackRunControl, AttackRunGroup, AttackRunTechnique, CompiledAttackRunLaw } from './attack-run-law';
import type { DoorEstate } from './attack-run-door';
import type { PhishingDoor, PhishingWorld } from './attack-run-phishing';
import type { AttackRunWorldDraw, PreparedWorld } from './attack-run-evaluation';
import type { AssetCategory } from '../../supporting-assets/constants';
import type { EntryOpeningRow } from '../attack-run-door-estate';
import { buildDoorEstate } from '../attack-run-door-estate';
import { ATTACK_RUN_CONSTANTS, PHISHING_CONSTANTS } from './attack-run-constants';
import { COUPLE_SUCCESS_CAP } from './engine-constants';
import { compileAttackRunLaw } from './attack-run-law';
import { evaluateAttackRun, prepareWorld, setControlState } from './attack-run-evaluation';
import { phishingPass } from './attack-run-phishing';

/**
 * The payload stage of phishing is read per person on the family of their device. Three layers:
 * the pure pass, the unchanged bits of an estate with no mobile device, and the door that feeds the
 * pass the stages a world holds.
 */

const IDENTITY = 0;
const HOST = 1;
const MOBILE = 2;
const S = PHISHING_CONSTANTS.defaultSusceptibility;
const C = PHISHING_CONSTANTS.credentialShare;
const K = PHISHING_CONSTANTS.clientExploitShare;

const device = (family: number, ...openings: ReadonlyArray<number>): PhishingDoor['persons'][number]['devices'][number] =>
  ({ family, openings: openings.map((opening, cve) => ({ cve, technique: 0, opening })) });

const person = (...devices: Array<PhishingDoor['persons'][number]['devices'][number]>): PhishingDoor['persons'][number] =>
  ({ target: false, devices });

const phishingDoor = (people: number, persons: PhishingDoor['persons'], over: Partial<PhishingDoor> = {}): PhishingDoor =>
  ({ personFamily: IDENTITY, deviceFamily: HOST, people, targetPeople: 0, persons, cleanPersons: [], ...over });

interface WorldOver {
  readonly exploited?: ReadonlyArray<number>,
  readonly floorHeld?: ReadonlyArray<number>,
  readonly delivery?: number,
  readonly credential?: number,
  /** The payload let-through of each family, one for a family the map does not name. */
  readonly payload?: ReadonlyMap<number, number>,
  readonly susceptibility?: number,
  readonly campaignSize?: number,
}

const worldOf = (over: WorldOver = {}): PhishingWorld => {
  const exploited = new Set(over.exploited ?? []);
  const held = new Set(over.floorHeld ?? []);
  return {
    exploited: (cve) => exploited.has(cve),
    floorHeld: (family) => held.has(family),
    delivery: over.delivery ?? 1,
    credential: over.credential ?? 1,
    payload: (family) => over.payload?.get(family) ?? 1,
    susceptibility: over.susceptibility ?? S,
    campaignSize: over.campaignSize ?? 10,
    cap: COUPLE_SUCCESS_CAP,
  };
};

/** One person's chance of falling to one email, before the cap, as the doctrine writes it. */
const qOf = (stages: { delivery: number, credential: number, payload: number }, open: number): number =>
  stages.delivery * S * (C * stages.credential + (1 - C) * stages.payload * ((1 - K) + K * open));

const entryOf = (q: number, emails: number): number => 1 - (1 - q) ** emails;

const reversed = <T>(items: ReadonlyArray<T>): Array<T> => [...items].reverse();

describe('the payload stage on the family of a person\'s device', () => {
  const payload = new Map([[MOBILE, 0.5]]);

  it('reads the controls of the family of the device, so a person on a phone reads the mobile controls and no host one', () => {
    const door = phishingDoor(1, [person(device(MOBILE, 0.4))]);
    const mobileControlled = phishingPass(door, worldOf({ exploited: [0], payload: new Map([[MOBILE, 0.5]]) }), PHISHING_CONSTANTS).other;
    const hostControlled = phishingPass(door, worldOf({ exploited: [0], payload: new Map([[HOST, 0.5]]) }), PHISHING_CONSTANTS).other;
    const stages = { delivery: 1, credential: 1 };
    expect(mobileControlled).toBeCloseTo(entryOf(qOf({ ...stages, payload: 0.5 }, 0.4), 10), 12);
    expect(hostControlled).toBeCloseTo(entryOf(qOf({ ...stages, payload: 1 }, 0.4), 10), 12);
    expect(mobileControlled).toBeLessThan(hostControlled);
  });

  it('reads a person on a workstation as before: the host controls move it and the mobile ones do not', () => {
    const door = phishingDoor(1, [person(device(HOST, 0.4))]);
    const base = phishingPass(door, worldOf({ exploited: [0] }), PHISHING_CONSTANTS).other;
    expect(phishingPass(door, worldOf({ exploited: [0], payload }), PHISHING_CONSTANTS).other).toBe(base);
    expect(phishingPass(door, worldOf({ exploited: [0], payload: new Map([[HOST, 0.5]]) }), PHISHING_CONSTANTS).other).toBeLessThan(base);
  });

  it('counts a person with a workstation and a phone for the device that favours the attacker', () => {
    const stages = { delivery: 1, credential: 1 };
    const both = phishingDoor(1, [person(device(HOST, 0.3), device(MOBILE, 0.3))]);
    const open = (host: number, mobile: number): number => phishingPass(
      both,
      worldOf({ exploited: [0], payload: new Map([[HOST, host], [MOBILE, mobile]]) }),
      PHISHING_CONSTANTS,
    ).other;

    expect(open(0.2, 1)).toBeCloseTo(entryOf(qOf({ ...stages, payload: 1 }, 0.3), 10), 12);
    expect(open(1, 0.2)).toBeCloseTo(entryOf(qOf({ ...stages, payload: 1 }, 0.3), 10), 12);
    expect(open(0.2, 0.4)).toBeCloseTo(entryOf(qOf({ ...stages, payload: 0.4 }, 0.3), 10), 12);
    expect(open(0.2, 0.4)).toBe(open(0.4, 0.2));
  });

  it('weighs a more open device on its own controls, not the controls of the most open device', () => {
    const stages = { delivery: 1, credential: 1 };
    const door = phishingDoor(1, [person(device(HOST, 0.1), device(MOBILE, 0.9))]);
    const pass = phishingPass(door, worldOf({ exploited: [0, 1], payload: new Map([[HOST, 1], [MOBILE, 0.1]]) }), PHISHING_CONSTANTS).other;
    expect(pass).toBeCloseTo(entryOf(qOf({ ...stages, payload: 1 }, 0.1), 10), 12);
  });

  it('reads the host for a person the door does not list, and the floor of the host only', () => {
    const stages = { delivery: 1, credential: 1 };
    const door = phishingDoor(10, []);
    expect(phishingPass(door, worldOf({ payload: new Map([[HOST, 0.5], [MOBILE, 0.1]]) }), PHISHING_CONSTANTS).other)
      .toBeCloseTo(entryOf(qOf({ ...stages, payload: 0.5 }, 0), 10), 12);
    expect(phishingPass(door, worldOf({ floorHeld: [HOST], payload: new Map([[HOST, 0.5]]) }), PHISHING_CONSTANTS).other)
      .toBeCloseTo(entryOf(qOf({ ...stages, payload: 0.5 }, 1), 10), 12);
    expect(phishingPass(door, worldOf({ floorHeld: [MOBILE] }), PHISHING_CONSTANTS).other)
      .toBeCloseTo(entryOf(qOf({ ...stages, payload: 1 }, 0), 10), 12);
  });

  it('opens a listed person on the floor of the family of its device, and on no other', () => {
    const stages = { delivery: 1, credential: 1 };
    const door = phishingDoor(1, [person(device(MOBILE, 0.1))]);
    expect(phishingPass(door, worldOf({ floorHeld: [HOST] }), PHISHING_CONSTANTS).other)
      .toBeCloseTo(entryOf(qOf({ ...stages, payload: 1 }, 0), 10), 12);
    expect(phishingPass(door, worldOf({ floorHeld: [MOBILE] }), PHISHING_CONSTANTS).other)
      .toBeCloseTo(entryOf(qOf({ ...stages, payload: 1 }, 1), 10), 12);
  });

  it('reads the unlisted people on no family when the estate holds no host', () => {
    const door = phishingDoor(10, [], { deviceFamily: -1 });
    const seen: Array<number> = [];
    const reading = (family: number): number => {
      seen.push(family);
      return 1;
    };
    phishingPass(door, { ...worldOf(), payload: reading }, PHISHING_CONSTANTS);
    expect(seen).toEqual([-1]);
  });
});

describe('the people paired with devices that carry no flaw', () => {
  const stages = { delivery: 1, credential: 1 };
  const group = (families: ReadonlyArray<number>, count: number, target = false): PhishingDoor['cleanPersons'][number] =>
    ({ families, target, count });
  const q = (payload: number, open = 0): number => qOf({ ...stages, payload }, open);
  const mobileControlled = new Map([[MOBILE, 0.5]]);

  it('reads a clean phone on the mobile controls, as a flawed one, and no host control', () => {
    const door = phishingDoor(10, [], { cleanPersons: [group([MOBILE], 10)] });
    expect(phishingPass(door, worldOf({ payload: mobileControlled }), PHISHING_CONSTANTS).other).toBeCloseTo(entryOf(q(0.5), 10), 12);
    expect(phishingPass(door, worldOf({ payload: new Map([[HOST, 0.5]]) }), PHISHING_CONSTANTS).other).toBeCloseTo(entryOf(q(1), 10), 12);
  });

  it('leaves the people paired with nothing on the host, whatever the groups hold', () => {
    const door = phishingDoor(10, [], { cleanPersons: [group([MOBILE], 4)] });
    const payload = new Map([[HOST, 0.8], [MOBILE, 0.5]]);
    expect(phishingPass(door, worldOf({ payload }), PHISHING_CONSTANTS).other)
      .toBeCloseTo(entryOf((4 * q(0.5) + 6 * q(0.8)) / 10, 10), 12);
  });

  it('opens a group on the floor of the family of its devices, and on no other', () => {
    const door = phishingDoor(10, [], { cleanPersons: [group([MOBILE], 10)] });
    expect(phishingPass(door, worldOf({ floorHeld: [MOBILE] }), PHISHING_CONSTANTS).other).toBeCloseTo(entryOf(q(1, 1), 10), 12);
    expect(phishingPass(door, worldOf({ floorHeld: [HOST] }), PHISHING_CONSTANTS).other).toBeCloseTo(entryOf(q(1, 0), 10), 12);
  });

  it('counts a group with a workstation and a phone for the family that favours the attacker', () => {
    const door = phishingDoor(10, [], { cleanPersons: [group([HOST, MOBILE], 10)] });
    const entry = (host: number, mobile: number): number =>
      phishingPass(door, worldOf({ payload: new Map([[HOST, host], [MOBILE, mobile]]) }), PHISHING_CONSTANTS).other;
    expect(entry(0.3, 0.9)).toBeCloseTo(entryOf(q(0.9), 10), 12);
    expect(entry(0.9, 0.3)).toBeCloseTo(entryOf(q(0.9), 10), 12);
  });

  it('weighs a group by its people, targets and others each on their own', () => {
    const door = phishingDoor(20, [], {
      targetPeople: 5,
      cleanPersons: [group([MOBILE], 3, true), group([MOBILE], 4), group([HOST, MOBILE], 2)],
    });
    const pass = phishingPass(door, worldOf({ payload: mobileControlled, campaignSize: 8 }), PHISHING_CONSTANTS);
    expect(pass.target).toBeCloseTo(entryOf((3 * q(0.5) + 2 * q(1)) / 5, 8 * 5 / 20), 12);
    expect(pass.other).toBeCloseTo(entryOf((4 * q(0.5) + 2 * q(1) + 9 * q(1)) / 15, 8 * 15 / 20), 12);
  });

  it('adds to a listed person\'s own reading without replacing it', () => {
    const door = phishingDoor(5, [person(device(HOST, 0.6))], { cleanPersons: [group([MOBILE], 4)] });
    const world = worldOf({ exploited: [0], payload: mobileControlled });
    expect(phishingPass(door, world, PHISHING_CONSTANTS).other).toBeCloseTo(entryOf((q(1, 0.6) + 4 * q(0.5)) / 5, 10), 12);
  });

  it('reads the clean phone of a person whose workstation is flawed', () => {
    const door = phishingDoor(5, [person(device(HOST, 0.6), device(MOBILE))]);
    const open = (host: number, mobile: number): number => phishingPass(
      door,
      worldOf({ exploited: [0], payload: new Map([[HOST, host], [MOBILE, mobile]]) }),
      PHISHING_CONSTANTS,
    ).other;
    // The person counts for the better of the flawed workstation and the clean phone.
    expect(open(0.2, 1)).toBeCloseTo(entryOf((q(1, 0) + 4 * q(0.2)) / 5, 10), 12);
    expect(open(1, 0.2)).toBeCloseTo(entryOf((q(1, 0.6) + 4 * q(1)) / 5, 10), 12);
    expect(open(0.2, 0.2)).toBeCloseTo(entryOf((q(0.2, 0.6) + 4 * q(0.2)) / 5, 10), 12);
  });

  it('never takes more people than the counts leave, however many a group holds', () => {
    const door = phishingDoor(10, [person(device(HOST, 0.6))], { cleanPersons: [group([MOBILE], 50)] });
    const world = worldOf({ exploited: [0], payload: mobileControlled });
    expect(phishingPass(door, world, PHISHING_CONSTANTS).other).toBeCloseTo(entryOf((q(1, 0.6) + 9 * q(0.5)) / 10, 10), 12);
  });

  it('gives the same bits whatever the order of the groups', () => {
    const groups = [group([MOBILE], 3), group([HOST, MOBILE], 2), group([MOBILE], 1, true), group([HOST], 4), group([MOBILE], 2)];
    const world = worldOf({ payload: new Map([[HOST, 0.9], [MOBILE, 0.4]]), floorHeld: [MOBILE], campaignSize: 9 });
    const door = (cleanPersons: PhishingDoor['cleanPersons']): PhishingDoor => phishingDoor(30, [], { targetPeople: 6, cleanPersons });
    const reference = phishingPass(door(groups), world, PHISHING_CONSTANTS);
    expect(reference.other).toBeGreaterThan(0);
    expect(phishingPass(door(reversed(groups)), world, PHISHING_CONSTANTS)).toEqual(reference);
  });
});

/** The pass as it read the payload stage on the host alone, which an estate with no mobile device must still give to the bit. */
const hostOnlyPass = (
  door: PhishingDoor,
  world: Omit<PhishingWorld, 'payload'> & { readonly payload: number },
): { target: number, other: number } => {
  const people = door.people;
  const chance = (open: number): number => {
    const payload = world.payload * ((1 - K) + K * open);
    const branches = C * world.credential + (1 - C) * payload;
    return Math.min(world.cap, Math.max(0, world.delivery * world.susceptibility * branches));
  };
  const floorOpen = door.deviceFamily >= 0 && world.floorHeld(door.deviceFamily) ? 1 : 0;
  const targetChances: Array<number> = [];
  const otherChances: Array<number> = [];
  for (const listed of door.persons) {
    let open = floorOpen;
    for (const entry of listed.devices) {
      if (open >= 1) {
        break;
      }
      if (world.floorHeld(entry.family)) {
        open = 1;
        break;
      }
      let missLog = 0;
      for (const one of entry.openings) {
        if (one.opening > 0 && world.exploited(one.cve)) {
          missLog += Math.log1p(-Math.min(1, one.opening));
        }
      }
      open = Math.max(open, Math.min(1, Math.max(0, -Math.expm1(missLog))));
    }
    (listed.target ? targetChances : otherChances).push(chance(open));
  }
  const targetPeople = Math.min(people, Math.max(0, door.targetPeople));
  const passOf = (chances: Array<number>, count: number): number => {
    if (count <= 0) {
      return 0;
    }
    chances.sort((left, right) => left - right);
    let total = 0;
    for (const value of chances) {
      total += value;
    }
    total += Math.max(0, count - chances.length) * chance(floorOpen);
    const mean = Math.min(1, total / count);
    return Math.min(1, Math.max(0, -Math.expm1(world.campaignSize * (count / people) * Math.log1p(-mean))));
  };
  return { target: passOf(targetChances, targetPeople), other: passOf(otherChances, people - targetPeople) };
};

describe('an estate whose people have no mobile device', () => {
  /** A small deterministic generator, so a failing draw can be replayed. */
  const generator = (seed: number): (() => number) => {
    let state = seed;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  };

  const compare = (door: PhishingDoor, cveCount: number, draws: number, seed: number, familyCount = 2): void => {
    const next = generator(seed);
    const families = Array.from({ length: familyCount }, (_, family) => family);
    for (let draw = 0; draw < draws; draw += 1) {
      const exploited = Array.from({ length: cveCount }, (_, cve) => cve).filter(() => next() < 0.5);
      const floorHeld = families.filter(() => next() < 0.3);
      const stage = (): number => [1, 0, next()][Math.floor(next() * 3)];
      const over = {
        exploited,
        floorHeld,
        delivery: stage(),
        credential: stage(),
        susceptibility: next(),
        campaignSize: 1 + Math.floor(next() * 40),
      };
      const payload = stage();
      const now = phishingPass(door, worldOf({ ...over, payload: new Map([[door.deviceFamily, payload]]) }), PHISHING_CONSTANTS);
      const before = hostOnlyPass(door, { ...worldOf(over), payload });
      expect(now.target).toBe(before.target);
      expect(now.other).toBe(before.other);
    }
  };

  const PEOPLE_COUNT = 24;
  const FAMILIES_BY_TECHNIQUE: ReadonlyMap<string, ReadonlyArray<AssetCategory>> = new Map([
    ['T1190', ['web_application']],
    ['T1189', ['host']],
    ['T1566', ['identity', 'host']],
  ]);

  const workstation = (index: number): Pick<EntryOpeningRow, 'categoryId' | 'subcategoryId' | 'exposure'> & { supportingAssetId: string } =>
    ({ supportingAssetId: `workstation-${index}`, categoryId: 'host', subcategoryId: 'workstation', exposure: 'internal' });

  const flaw = (index: number, cveId: string, opening: number, threat: number): ReadonlyArray<EntryOpeningRow> =>
    ['T1566', 'T1189'].map((techniqueExternalId) =>
      ({ ...workstation(index), target: false, cveId, techniqueExternalId, opening, threat }));

  const clientFlaws = (): ReadonlyArray<EntryOpeningRow> => [
    ...Array.from({ length: 10 }, (_, index) => flaw(index, 'CVE-CLIENT-A', 0.7, 0.05)).flat(),
    ...Array.from({ length: 6 }, (_, index) => flaw(index * 3, 'CVE-CLIENT-B', 0.4, 0.35)).flat(),
  ];

  const edgeFlaws = (): ReadonlyArray<EntryOpeningRow> => Array.from({ length: 3 }, (_, index) => ({
    supportingAssetId: `web-${index}`,
    categoryId: 'web_application' as const,
    subcategoryId: null,
    exposure: 'internet_facing' as const,
    target: false,
    cveId: 'CVE-EDGE-A',
    techniqueExternalId: 'T1190',
    opening: 0.8,
    threat: 0.9,
  }));

  /** Built by the production door builder, one account the primary user of each workstation, so the families are the ones an estate gives. */
  const doorOf = (openings: ReadonlyArray<EntryOpeningRow>): DoorEstate => buildDoorEstate({
    techniqueExternalIds: ['T1190', 'T1566', 'T1189'],
    applicableFamiliesByTechnique: FAMILIES_BY_TECHNIQUE,
    counts: [
      { categoryId: 'host', subcategoryId: 'workstation', exposure: 'internal', identityEnabled: true, target: false, count: PEOPLE_COUNT },
      { categoryId: 'identity', subcategoryId: 'user_account', exposure: 'unknown', identityEnabled: true, target: false, count: PEOPLE_COUNT },
      { categoryId: 'web_application', subcategoryId: null, exposure: 'internet_facing', identityEnabled: true, target: false, count: 3 },
    ],
    openings,
    primaryUsers: Array.from({ length: PEOPLE_COUNT }, (_, index) => ({
      identityId: `person-${index}`,
      deviceId: `workstation-${index}`,
      deviceCategoryId: 'host' as const,
      identityTarget: false,
    })),
    unknownExposureCountsAs: 'internal',
  });

  it('gives, to the bit, what the host-only payload read gave, on doors built from an estate', () => {
    const doors = [
      { door: doorOf(clientFlaws()), targetPeople: 0 },
      { door: doorOf([...clientFlaws(), ...edgeFlaws()]), targetPeople: 0 },
      { door: doorOf([...clientFlaws(), ...edgeFlaws()]), targetPeople: 9 },
    ];
    for (const { door, targetPeople } of doors) {
      expect(door.families).not.toContain('mobile_device');
      expect(door.phishing!.persons.length).toBeGreaterThan(0);
      compare({ ...door.phishing!, targetPeople }, door.cves.length, 150, 7, door.families.length);
    }
  });

  it('gives the same bits when the people paired with a clean workstation are grouped, as when they are left to the host', () => {
    const unflawed = doorOf([]);
    expect(unflawed.phishing!.cleanPersons).toEqual([{ families: [unflawed.families.indexOf('host')], target: false, count: PEOPLE_COUNT }]);
    compare(unflawed.phishing!, 1, 100, 5, unflawed.families.length);
    const persons: PhishingDoor['persons'] = [
      { target: true, devices: [device(HOST, 0.4)] },
      { target: false, devices: [device(HOST, 0.2, 0.5)] },
    ];
    const cleanPersons: PhishingDoor['cleanPersons'] = [
      { families: [HOST], target: true, count: 3 },
      { families: [HOST], target: false, count: 14 },
    ];
    compare(phishingDoor(25, persons, { targetPeople: 6, cleanPersons }), 2, 400, 17);
  });

  it('gives the same bits with several workstations per person, targets, and the people left unlisted', () => {
    const persons: PhishingDoor['persons'] = [
      { target: true, devices: [device(HOST, 0.4, 0.3), device(HOST, 0.9)] },
      { target: false, devices: [device(HOST, 0.2), device(HOST, 0.6, 0.6, 0.1), device(HOST, 1)] },
      { target: true, devices: [device(HOST, 0.05)] },
      { target: false, devices: [device(HOST, 0.7, 0.2)] },
    ];
    compare(phishingDoor(25, persons, { targetPeople: 8 }), 3, 400, 11);
    compare(phishingDoor(4, persons, { targetPeople: 2 }), 3, 400, 13);
  });
});

describe('the door of an estate with people on workstations and on phones', () => {
  const PEOPLE = 4;
  const technique = (externalId: string, tacticExternalIds: ReadonlyArray<string>, families: AttackRunTechnique['families']): AttackRunTechnique =>
    ({ externalId, tacticExternalIds, families, populationScoped: externalId === 'T1566' });

  const REPERTOIRE: ReadonlyArray<AttackRunTechnique> = [
    technique('T1566', ['TA0001'], ['identity', 'host', 'mobile_device']),
    technique('T1486', ['TA0040'], ['host']),
    technique('T1204', ['TA0002'], ['host', 'mobile_device']),
    technique('T1203', ['TA0002'], ['host', 'mobile_device']),
  ];

  const GROUPS: ReadonlyArray<AttackRunGroup> = (['identity', 'host', 'mobile_device'] as const).map((family) => ({
    id: family, family, assets: PEOPLE, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false,
  }));

  const control = (capabilityExternalId: string, prevent: ReadonlyArray<string>): AttackRunControl =>
    ({ capabilityExternalId, preventTechniqueExternalIds: prevent, detectTechniqueExternalIds: [] });

  const UEM = 0;
  const CONTROLS = [control('UEM', ['T1203']), control('OSH', ['T1204'])];

  const doorOf = (persons: PhishingDoor['persons'], people = persons.length): DoorEstate => ({
    techniques: ['T1566'],
    families: ['identity', 'host', 'mobile_device'],
    cves: [{ cveId: 'CVE-2024-0001', threat: 0.5, priced: true }],
    assets: [],
    applicable: [Float64Array.from([0, 0, 0])],
    targetApplicable: [Float64Array.from([0, 0, 0])],
    phishing: phishingDoor(people, persons),
  });

  const lawOf = (door: DoorEstate): CompiledAttackRunLaw => compileAttackRunLaw({
    terminalTacticExternalId: 'TA0040',
    actorClass: { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 },
    repertoire: REPERTOIRE,
    groups: GROUPS,
    controls: CONTROLS,
    constants: ATTACK_RUN_CONSTANTS,
    door,
    phishing: { actorClass: 'default', declaredSusceptibility: null },
    unknownExposureCountsAs: 'internal',
    unknownCriticalityCountsAs: 'low',
  });

  const drawnWorld = (law: CompiledAttackRunLaw, prevent: ReadonlyArray<number> = [], exploited = true): PreparedWorld => {
    const draw: AttackRunWorldDraw = {
      deployed: law.controls.map(() => true),
      preventEfficacy: law.controls.map((_, index) => prevent[index] ?? 0),
      detectEfficacy: law.controls.map(() => 0),
      knockoutUniform: law.controls.map(() => law.obstacles.map(() => 1)),
      reactionTimeHours: { min: 8, likely: 8, max: 8 },
      cveUniform: Float64Array.of(exploited ? 0 : 1),
      familyUniform: Float64Array.from({ length: 3 }, () => 1),
    };
    return prepareWorld(law, draw);
  };

  /** The phishing pass of a door on one payload let-through, every exploit circulating and no floor drawn, as `worldOf` draws. */
  const passOf = (law: CompiledAttackRunLaw, door: DoorEstate, payload: (family: number) => number, exploited = true): number =>
    phishingPass(door.phishing!, {
      exploited: () => exploited,
      floorHeld: () => false,
      delivery: 1,
      credential: 1,
      payload,
      susceptibility: law.phishing!.susceptibility,
      campaignSize: law.phishing!.campaignSize,
      cap: COUPLE_SUCCESS_CAP,
    }, PHISHING_CONSTANTS).other;

  const clearOf = (world: PreparedWorld, interdiction?: Parameters<typeof evaluateAttackRun>[1]): number =>
    evaluateAttackRun(world, interdiction).clearByObstacle[0];

  const onPhones = doorOf([person(device(MOBILE, 0.8)), person(device(MOBILE, 0.8)), person(device(MOBILE, 0.8)), person(device(MOBILE, 0.8))]);
  const onWorkstations = doorOf([person(device(HOST, 0.8)), person(device(HOST, 0.8)), person(device(HOST, 0.8)), person(device(HOST, 0.8))]);

  it('moves with the mobile device management when people are on phones, and with no host-only control', () => {
    const law = lawOf(onPhones);
    const held = clearOf(drawnWorld(law));
    expect(clearOf(drawnWorld(law, [0.5, 0]))).toBeLessThan(held);
    expect(clearOf(drawnWorld(law, [0, 0.5]))).toBe(held);
  });

  it('moves alike with every host control when people are on workstations, whether it protects phones too or not', () => {
    const law = lawOf(onWorkstations);
    const held = clearOf(drawnWorld(law));
    expect(clearOf(drawnWorld(law, [0, 0.5]))).toBeLessThan(held);
    expect(clearOf(drawnWorld(law, [0.5, 0]))).toBe(clearOf(drawnWorld(law, [0, 0.5])));
  });

  it('prices the people on phones at the payload let-through of the mobile family', () => {
    const law = lawOf(onPhones);
    expect(clearOf(drawnWorld(law, [0.5, 0]))).toBeCloseTo(passOf(law, onPhones, () => 0.5), 12);
  });

  it('moves with the mobile device management for people whose phone carries no flaw', () => {
    const clean: PhishingDoor['cleanPersons'] = [{ families: [MOBILE], target: false, count: PEOPLE }];
    const door: DoorEstate = { ...onWorkstations, phishing: { ...onPhones.phishing!, persons: [], cleanPersons: clean } };
    const law = lawOf(door);
    const held = clearOf(drawnWorld(law, [], false));
    expect(clearOf(drawnWorld(law, [0.5, 0], false))).toBeLessThan(held);
    expect(clearOf(drawnWorld(law, [0, 0.5], false))).toBe(held);
    expect(clearOf(drawnWorld(law, [0.5, 0], false))).toBeCloseTo(passOf(law, door, (family) => (family === MOBILE ? 0.5 : 1), false), 12);
  });

  it('declaring a host-only control moves nothing when every person is on a phone, to the bit', () => {
    const law = lawOf(onPhones);
    expect(clearOf(drawnWorld(law, [0, 0.9]))).toBe(clearOf(drawnWorld(law)));
    expect(clearOf(drawnWorld(law, [0, 0.9], false))).toBe(clearOf(drawnWorld(law, [], false)));
  });

  it('reads the people the door does not list on the host controls', () => {
    const law = lawOf(doorOf([], PEOPLE));
    const held = clearOf(drawnWorld(law));
    expect(clearOf(drawnWorld(law, [0, 0.5]))).toBeLessThan(held);
    expect(clearOf(drawnWorld(law, [0.5, 0]))).toBe(clearOf(drawnWorld(law, [0, 0.5])));
  });

  it('closes the payload stage on every family when T1204 or T1203 is interdicted', () => {
    const interdicted = (door: DoorEstate, externalId: string): number => {
      const law = lawOf(door);
      return clearOf(drawnWorld(law, [0.3, 0.3]), { lever: 'prevent', technique: REPERTOIRE.findIndex((entry) => entry.externalId === externalId) });
    };
    for (const door of [onPhones, onWorkstations, doorOf([], PEOPLE)]) {
      const closed = passOf(lawOf(door), door, () => 0);
      expect(interdicted(door, 'T1204')).toBeCloseTo(closed, 12);
      expect(interdicted(door, 'T1203')).toBeCloseTo(closed, 12);
    }
  });

  describe('the door memo', () => {
    it('answers a lever on a control that moves the mobile payload alone, which no cell of a technique and no other stage shows', () => {
      const law = lawOf(onPhones);
      const world = drawnWorld(law, [0.5, 0]);
      const first = evaluateAttackRun(world);
      expect(evaluateAttackRun(world)).toEqual(first);

      setControlState(world, UEM, { deployed: true, preventEfficacy: 0.8, detectEfficacy: 0 });
      const moved = evaluateAttackRun(world);
      expect(moved.clearByObstacle[0]).toBeLessThan(first.clearByObstacle[0]);
      expect(moved).toEqual(evaluateAttackRun(drawnWorld(law, [0.8, 0])));

      setControlState(world, UEM, { deployed: true, preventEfficacy: 0.5, detectEfficacy: 0 });
      expect(evaluateAttackRun(world)).toEqual(first);
    });

    it('is not stale after an interdiction of the payload on the same draw', () => {
      const law = lawOf(onPhones);
      const world = drawnWorld(law, [0.5, 0]);
      const first = evaluateAttackRun(world);
      const closed = evaluateAttackRun(world, { lever: 'prevent', technique: 2 });
      expect(closed.clearByObstacle[0]).toBeLessThan(first.clearByObstacle[0]);
      expect(evaluateAttackRun(world)).toEqual(first);
    });
  });

  it('acts once along a phishing branch: a control with edges on T1566 and T1204 counts at delivery only', () => {
    const inputs = lawOf(onPhones).inputs;
    const atDelivery = (prevent: ReadonlyArray<string>): number =>
      clearOf(drawnWorld(compileAttackRunLaw({ ...inputs, controls: [control('SEG', prevent)] }), [0.5]));
    expect(atDelivery(['T1566', 'T1204'])).toBe(atDelivery(['T1566']));
    expect(atDelivery(['T1566', 'T1204'])).toBeLessThan(atDelivery(['T1204']));
  });
});
