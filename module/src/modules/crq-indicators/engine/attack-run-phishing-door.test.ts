import { describe, expect, it } from 'vitest';
import type { AttackRunControl, AttackRunGroup, AttackRunLawInputs, AttackRunTechnique, CompiledAttackRunLaw } from './attack-run-law';
import type { DoorEstate } from './attack-run-door';
import type { PhishingDoor } from './attack-run-phishing';
import type { AttackRunWorldDraw, PreparedWorld } from './attack-run-evaluation';
import { ATTACK_RUN_CONSTANTS, PHISHING_CONSTANTS, phishingCampaignSize } from './attack-run-constants';
import { COUPLE_SUCCESS_CAP } from './engine-constants';
import { compileAttackRunLaw } from './attack-run-law';
import { evaluateAttackRun, prepareWorld } from './attack-run-evaluation';
import { phishingPass } from './attack-run-phishing';

/**
 * What the door reads of a phishing estate: the clear of T1566 is the pure phishing pass on the
 * stages the world holds, not the per-asset law, and nothing about it depends on the assets.
 */

const IDENTITY = 0;
const HOST = 1;
const PEOPLE = 30;

const technique = (externalId: string, tacticExternalIds: ReadonlyArray<string>, families: AttackRunTechnique['families']): AttackRunTechnique =>
  ({ externalId, tacticExternalIds, families, populationScoped: externalId === 'T1566' });

const REPERTOIRE: ReadonlyArray<AttackRunTechnique> = [
  technique('T1566', ['TA0001'], ['identity', 'host']),
  technique('T1486', ['TA0040'], ['host']),
];

const groupsOf = (accounts: number): ReadonlyArray<AttackRunGroup> => [
  { id: 'accounts', family: 'identity', assets: accounts, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
  { id: 'hosts', family: 'host', assets: 50, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
];

const PERSONS: PhishingDoor['persons'] = [
  { target: false, devices: [{ family: HOST, openings: [{ cve: 0, technique: 0, opening: 0.8 }] }] },
];

const doorOf = (phishing: Partial<PhishingDoor> = {}): DoorEstate => ({
  techniques: ['T1566'],
  families: ['identity', 'host'],
  cves: [{ cveId: 'CVE-2024-0001', threat: 0.5, priced: true }],
  assets: [],
  applicable: [Float64Array.from([0, 0])],
  targetApplicable: [Float64Array.from([0, 0])],
  phishing: { personFamily: IDENTITY, deviceFamily: HOST, people: PEOPLE, targetPeople: 0, persons: PERSONS, cleanPersons: [], ...phishing },
});

const control = (
  capabilityExternalId: string,
  prevent: ReadonlyArray<string>,
  detect: ReadonlyArray<string> = [],
  declaredPreventEfficacy?: number,
): AttackRunControl => ({
  capabilityExternalId,
  preventTechniqueExternalIds: prevent,
  detectTechniqueExternalIds: detect,
  ...(declaredPreventEfficacy === undefined ? {} : { declaredPreventEfficacy }),
});

const SEG = 0;
const IDP = 1;
const PATCH = 2;
const CONTROLS = [control('SEG', ['T1566']), control('IDP', ['T1078']), control('PATCH', ['T1204'])];

const lawOf = (over: Partial<AttackRunLawInputs> = {}): CompiledAttackRunLaw => compileAttackRunLaw({
  terminalTacticExternalId: 'TA0040',
  actorClass: { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 },
  repertoire: REPERTOIRE,
  groups: groupsOf(PEOPLE),
  controls: CONTROLS,
  constants: ATTACK_RUN_CONSTANTS,
  door: doorOf(),
  phishing: { actorClass: 'default', declaredSusceptibility: null },
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
  ...over,
});

interface Draw {
  readonly prevent?: ReadonlyArray<number>,
  readonly detect?: ReadonlyArray<number>,
  readonly exploitedCve?: boolean,
  readonly floorHeld?: boolean,
}

const worldOf = (law: CompiledAttackRunLaw, { prevent = [], detect = [], exploitedCve = false, floorHeld = false }: Draw = {}): PreparedWorld => {
  const draw: AttackRunWorldDraw = {
    deployed: law.controls.map(() => true),
    preventEfficacy: law.controls.map((_, index) => prevent[index] ?? 0),
    detectEfficacy: law.controls.map((_, index) => detect[index] ?? 0),
    knockoutUniform: law.controls.map(() => law.obstacles.map(() => 1)),
    reactionTimeHours: { min: 8, likely: 8, max: 8 },
    cveUniform: Float64Array.of(exploitedCve ? 0 : 1),
    familyUniform: Float64Array.from({ length: 2 }, () => (floorHeld ? 0 : 1)),
  };
  return prepareWorld(law, draw);
};

const doorClear = (world: PreparedWorld, ...rest: [undefined?, undefined?, number?]): number =>
  evaluateAttackRun(world, ...rest).clearByObstacle[0];

const passAt = (over: {
  readonly delivery?: number,
  readonly credential?: number,
  readonly payload?: number,
  readonly susceptibility?: number,
  readonly exploited?: boolean,
  readonly floorHeld?: boolean,
  readonly campaignSize?: number,
  readonly people?: number,
}): number => phishingPass(doorOf({ people: over.people ?? PEOPLE }).phishing!, {
  exploited: () => over.exploited ?? false,
  floorHeld: () => over.floorHeld ?? false,
  delivery: over.delivery ?? 1,
  credential: over.credential ?? 1,
  payload: () => over.payload ?? 1,
  susceptibility: over.susceptibility ?? PHISHING_CONSTANTS.defaultSusceptibility,
  campaignSize: over.campaignSize ?? phishingCampaignSize('default', over.people ?? PEOPLE),
  cap: COUPLE_SUCCESS_CAP,
}, PHISHING_CONSTANTS).other;

describe('the door of an estate whose phishing is read from its people', () => {
  it('clears at the phishing pass of the stages the world holds', () => {
    const law = lawOf();
    expect(doorClear(worldOf(law))).toBeCloseTo(passAt({}), 12);
    expect(doorClear(worldOf(law, { prevent: [0.4, 0.5, 0.25] })))
      .toBeCloseTo(passAt({ delivery: 0.6, credential: 0.5, payload: 0.75 }), 12);
  });

  it('moves with each stage and with no other control', () => {
    const law = lawOf();
    const held = doorClear(worldOf(law));
    const at = (index: number): number => doorClear(worldOf(law, { prevent: law.controls.map((_, position) => (position === index ? 0.5 : 0)) }));
    expect(at(SEG)).toBeLessThan(held);
    expect(at(IDP)).toBeLessThan(held);
    expect(at(PATCH)).toBeLessThan(held);
  });

  it('reads the flaws of the devices of the people only when their exploit circulates, and the floor of the device family otherwise', () => {
    const law = lawOf();
    expect(doorClear(worldOf(law, { exploitedCve: true }))).toBeCloseTo(passAt({ exploited: true }), 12);
    expect(doorClear(worldOf(law, { exploitedCve: true }))).toBeGreaterThan(doorClear(worldOf(law)));
    expect(doorClear(worldOf(law, { floorHeld: true }))).toBeCloseTo(passAt({ floorHeld: true }), 12);
  });

  it('forgoes an exploit the evaluation names, and answers the world without it to the bit', () => {
    const law = lawOf();
    const circulating = worldOf(law, { exploitedCve: true });
    expect(doorClear(circulating, undefined, undefined, 0)).toBe(doorClear(worldOf(law)));
  });

  it('closes the door when the delivery technique is interdicted', () => {
    const law = lawOf();
    expect(evaluateAttackRun(worldOf(law), { lever: 'prevent', technique: 0 }).clearByObstacle[0]).toBe(0);
    expect(evaluateAttackRun(worldOf(law), { lever: 'detect', technique: 0 }).clearByObstacle[0]).toBe(doorClear(worldOf(law)));
  });

  it('closes the credential branch when T1078 is interdicted, and the payload branch when T1204 is', () => {
    const law = lawOf({
      repertoire: [...REPERTOIRE, technique('T1078', ['TA0005'], ['identity']), technique('T1204', ['TA0002'], ['host'])],
    });
    const interdicted = (externalId: string): number => evaluateAttackRun(
      worldOf(law),
      { lever: 'prevent', technique: law.inputs.repertoire.findIndex((entry) => entry.externalId === externalId) },
    ).clearByObstacle[0];
    expect(interdicted('T1078')).toBeCloseTo(passAt({ credential: 0 }), 12);
    expect(interdicted('T1204')).toBeCloseTo(passAt({ payload: 0 }), 12);
  });

  it('reads the declared susceptibility instead of the default', () => {
    const law = lawOf({ phishing: { actorClass: 'default', declaredSusceptibility: 0.2 } });
    expect(doorClear(worldOf(law))).toBeCloseTo(passAt({ susceptibility: 0.2 }), 12);
  });

  it('sizes the campaign by the actor class on the people of the estate', () => {
    const people = 200;
    const door = doorOf({ people });
    const ransomware = lawOf({ door, phishing: { actorClass: 'ransomware_operator', declaredSusceptibility: null } });
    expect(doorClear(worldOf(ransomware))).toBeCloseTo(passAt({ people, campaignSize: phishingCampaignSize('ransomware_operator', people) }), 12);
    expect(doorClear(worldOf(ransomware))).toBeGreaterThan(doorClear(worldOf(lawOf({ door }))));
  });

  it('reads no control at all on a family no group of the law holds', () => {
    const law = lawOf({ groups: groupsOf(PEOPLE).filter((group) => group.family === 'host') });
    expect(doorClear(worldOf(law, { prevent: [0.4, 0.5, 0.25] }))).toBeCloseTo(passAt({ payload: 0.75 }), 12);
  });

  it('recomputes after a stage moved on the same draw, and answers the memo bit for bit when nothing moved', () => {
    const law = lawOf();
    const world = worldOf(law, { prevent: [0.4, 0.5, 0.25] });
    const first = evaluateAttackRun(world);
    expect(evaluateAttackRun(world)).toEqual(first);
    world.phishingLetThrough[1 * law.familyCount + 0] = 1;
    expect(evaluateAttackRun(world).clearByObstacle[0]).toBeGreaterThan(first.clearByObstacle[0]);
  });
});

describe('detection at the door of a phishing campaign', () => {
  const detecting = [control('SEG', ['T1566'], ['T1566'])];
  const detectedAt = (law: CompiledAttackRunLaw): number =>
    evaluateAttackRun(worldOf(law, { detect: [0.6] })).firstDetectionAtObstacle[0];

  it('reads the campaign size as the assets it reaches, not the accounts of the group', () => {
    const small = lawOf({ controls: detecting, groups: groupsOf(PEOPLE) });
    const large = lawOf({ controls: detecting, groups: groupsOf(PEOPLE * 100) });
    expect(detectedAt(small)).toBeGreaterThan(0);
    expect(detectedAt(large)).toBe(detectedAt(small));
  });

  it('sees a larger campaign more often', () => {
    const fixed = lawOf({ controls: detecting });
    const wide = lawOf({
      controls: detecting,
      door: doorOf({ people: 1000 }),
      phishing: { actorClass: 'ransomware_operator', declaredSusceptibility: null },
    });
    expect(detectedAt(wide)).toBeGreaterThan(detectedAt(fixed));
  });
});
