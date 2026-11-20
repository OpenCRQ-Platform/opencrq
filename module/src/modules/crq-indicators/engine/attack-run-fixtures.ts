import type { CapabilityFunction } from '../../controls/capability/constants';
import type { AssetCategory, AssetCriticality } from '../../supporting-assets/constants';
import type { SupportingAssetExposure } from '../../supporting-assets/schema';
import type { DoorAsset, DoorEstate } from './attack-run-door';
import { controlCapabilitiesData, controlCapabilityEdgesData } from '../../controls/capability/data/capabilities.generated';
import { ACTOR_EXPLOITED_CVE_FLOOR, COUPLE_SUCCESS_CAP } from './engine-constants';

/**
 * The cases the law is benched on. Deliberately tiny and deliberately uneven: a mistake in a closed
 * form surfaces on a small heterogeneous estate and hides on a large uniform one, where every
 * weighted mean equals every term it averages.
 *
 * A fixture states every input as a point, the constants included, so nothing it exercises depends
 * on a value the calibration landed and no bench reads a production constant by accident.
 */

export interface FixtureTechnique {
  readonly externalId: string,
  readonly tacticExternalIds: ReadonlyArray<string>,
  readonly families: ReadonlyArray<AssetCategory>,
  /** Reaches its whole group in one move rather than one asset. Section 6.2. */
  readonly populationScoped?: boolean,
}

export interface FixtureGroup {
  readonly id: string,
  readonly family: AssetCategory,
  readonly assets: number,
  readonly exposure: SupportingAssetExposure,
  readonly criticality: AssetCriticality,
  readonly matchedByScenarioGroup: boolean,
  /** The floored-route mask: the techniques this group carries an actor-exploited CVE for. */
  readonly cveFloors?: ReadonlyArray<{ readonly techniqueExternalId: string, readonly share: number }>,
}

export interface FixtureControlFunction {
  /** `theta`. */
  readonly strength: number,
  readonly techniqueExternalIds: ReadonlyArray<string>,
}

export interface FixtureControl {
  readonly capabilityExternalId: string,
  /** Probability the control is present, drawn once per attack run and held for the whole chain. */
  readonly coverage: number,
  readonly prevent: FixtureControlFunction,
  readonly detect: FixtureControlFunction,
}

export interface FixtureActorClass {
  readonly capability: number,
  readonly stealth: number,
  readonly patience: number,
  readonly attackRunDays: number,
}

export interface FixtureConstants {
  readonly visitQuota: number,
  readonly populationDetectionCap: number,
  readonly unknownFlawFloorScale: number,
  readonly detectionScale: number,
  readonly signalGain: number,
  readonly execFloor: number,
  readonly postDetectionRate: number,
  readonly coupleSuccessCap: number,
  readonly actorExploitedCveFloor: number,
}

export interface AttackRunFixture {
  readonly name: string,
  /** What this fixture is there to break, so a failing bench points at a mechanism. */
  readonly exercises: string,
  readonly terminalTacticExternalId: string,
  readonly actorClass: FixtureActorClass,
  readonly repertoire: ReadonlyArray<FixtureTechnique>,
  readonly groups: ReadonlyArray<FixtureGroup>,
  readonly controls: ReadonlyArray<FixtureControl>,
  readonly reactionTimeHours: { readonly min: number, readonly likely: number, readonly max: number },
  readonly constants: FixtureConstants,
  /** What the estate offers the door: every family named here is one the groups hold. */
  readonly door: DoorEstate,
}

const IMPACT = 'TA0040';
const EXFILTRATION = 'TA0010';

const BENCH_CONSTANTS: FixtureConstants = {
  visitQuota: 5,
  populationDetectionCap: 5,
  unknownFlawFloorScale: 0.04,
  detectionScale: 0.0383,
  signalGain: 0.3,
  execFloor: 0.3,
  postDetectionRate: 0.7,
  coupleSuccessCap: COUPLE_SUCCESS_CAP,
  actorExploitedCveFloor: ACTOR_EXPLOITED_CVE_FLOOR,
};

const RANSOMWARE = { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 };

const technique = (
  externalId: string,
  tacticExternalIds: ReadonlyArray<string>,
  families: ReadonlyArray<FixtureTechnique['families'][number]>,
  populationScoped = false,
): FixtureTechnique => ({ externalId, tacticExternalIds, families, populationScoped });

const flaw = (cveId: string, threat: number): DoorEstate['cves'][number] => ({ cveId, threat, priced: true });

/** An asset whose family index and openings are stated, openings being `[cve, technique, opening]`. */
const exposed = (family: number, ...openings: ReadonlyArray<readonly [number, number, number]>): DoorAsset => ({
  family,
  openings: openings.map(([cve, index, opening]) => ({ cve, technique: index, opening })),
  target: false,
});

/**
 * A repertoire wide enough to play every obstacle of the impact chain and to hold all five
 * functions, and narrow enough that a reviewer can hold it in their head. `T1566` is the
 * population-scoped door, `T1685` takes the endpoint agent down and `T1686.003` the host firewall,
 * while no technique here targets multi-factor authentication.
 */
const REPERTOIRE: ReadonlyArray<FixtureTechnique> = [
  technique('T1566', ['TA0001'], ['host', 'identity'], true),
  technique('T1190', ['TA0001'], ['host', 'web_application']),
  technique('T1110', ['TA0006'], ['host', 'identity']),
  technique('T1003', ['TA0006'], ['host']),
  technique('T1068', ['TA0004'], ['host']),
  technique('T1018', ['TA0007'], ['host', 'network_device']),
  technique('T1021', ['TA0008'], ['host', 'network_device']),
  technique('T1486', ['TA0040'], ['host']),
  technique('T1059', ['TA0002'], ['host']),
  technique('T1047', ['TA0002'], ['host', 'network_device']),
  technique('T1027', ['TA0005'], ['host']),
  technique('T1070', ['TA0005'], ['host', 'network_device']),
  technique('T1685', ['TA0112'], ['host']),
  technique('T1686.003', ['TA0112'], ['host']),
  technique('T1547', ['TA0003'], ['host']),
  technique('T1071', ['TA0011'], ['host', 'network_device']),
];

const CAPABILITY_EXTERNAL_ID_BY_ID = new Map(controlCapabilitiesData.map((capability) => [capability.id, capability.externalId]));

/**
 * Which techniques a capability covers, read from the shipped catalogue edges rather than authored
 * here. A hand-written coverage list is the one part of a fixture that can be quietly impossible:
 * it lets the bench arbitrate a closed form on a posture no tenant could ever declare.
 */
export const catalogueCoverage = (capabilityExternalId: string, capabilityFunction: CapabilityFunction): ReadonlyArray<string> => [
  ...new Set(controlCapabilityEdgesData
    .filter((edge) => edge.function === capabilityFunction
      && CAPABILITY_EXTERNAL_ID_BY_ID.get(edge.capabilityId) === capabilityExternalId)
    .map((edge) => edge.techniqueExternalId)),
];

const control = (
  capabilityExternalId: string,
  coverage: number,
  strengths: { readonly prevent: number, readonly detect: number },
): FixtureControl => ({
  capabilityExternalId,
  coverage,
  prevent: { strength: strengths.prevent, techniqueExternalIds: catalogueCoverage(capabilityExternalId, 'prevent') },
  detect: { strength: strengths.detect, techniqueExternalIds: catalogueCoverage(capabilityExternalId, 'detect') },
});

/** Partial on purpose, so that the deployment common mode is a live draw rather than a constant. */
const EDR = control('EDR', 0.7, { prevent: 0.6, detect: 0.5 });

/**
 * The capability nothing in the repertoire targets, which is what makes "a capability falls only
 * to what targets it" assertable: no technique here takes IDP down in the impairment relation.
 */
const IDP = control('IDP', 1, { prevent: 0.7, detect: 0.3 });

const FIREWALL = control('NGFW', 0.9, { prevent: 0.5, detect: 0.4 });

/** Four crown-jewel servers against a visit quota of five, so a group can actually be exhausted. */
const UNEVEN_ESTATE: AttackRunFixture = {
  name: 'uneven-estate',
  exercises: 'the without-replacement term, the deployment common mode, and a sabotage that reaches EDR but never IDP',
  terminalTacticExternalId: IMPACT,
  actorClass: RANSOMWARE,
  repertoire: REPERTOIRE,
  groups: [
    {
      id: 'crown-jewels',
      family: 'host',
      assets: 4,
      exposure: 'internal',
      criticality: 'high',
      matchedByScenarioGroup: true,
      cveFloors: [{ techniqueExternalId: 'T1068', share: 1 }],
    },
    { id: 'workstations', family: 'host', assets: 120, exposure: 'internal', criticality: 'low', matchedByScenarioGroup: false },
    { id: 'edge', family: 'web_application', assets: 6, exposure: 'internet_facing', criticality: 'medium', matchedByScenarioGroup: false },
    { id: 'switches', family: 'network_device', assets: 9, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
    { id: 'accounts', family: 'identity', assets: 40, exposure: 'unknown', criticality: 'medium', matchedByScenarioGroup: false },
  ],
  controls: [EDR, IDP, FIREWALL],
  reactionTimeHours: { min: 0.5, likely: 8, max: 96 },
  constants: BENCH_CONSTANTS,
  door: {
    techniques: ['T1190', 'T1566'],
    families: ['host', 'web_application', 'identity'],
    cves: [flaw('CVE-2024-0001', 0.6), flaw('CVE-2024-0002', 0.1)],
    assets: [
      exposed(1, [0, 0, 0.5]),
      exposed(1, [0, 0, 0.5], [1, 0, 0.3]),
    ],
    applicable: [Float64Array.from([0, 6, 0]), Float64Array.from([0, 0, 0])],
    targetApplicable: [Float64Array.from([0, 0, 0]), Float64Array.from([0, 0, 0])],
    phishing: {
      personFamily: 2,
      deviceFamily: 0,
      people: 40,
      targetPeople: 0,
      persons: [{ target: false, devices: [{ family: 0, openings: [{ cve: 1, technique: 1, opening: 0.2 }] }] }],
      cleanPersons: [],
    },
  },
};

const HOMOGENEOUS_ESTATE: AttackRunFixture = {
  name: 'homogeneous-estate',
  exercises: 'the degenerate case: one family and full deployment, where every per-group refinement must vanish',
  terminalTacticExternalId: IMPACT,
  actorClass: RANSOMWARE,
  repertoire: REPERTOIRE.filter((candidate) => candidate.families.includes('host')),
  groups: [
    { id: 'fleet', family: 'host', assets: 200, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
  ],
  controls: [{ ...EDR, coverage: 1 }],
  reactionTimeHours: { min: 8, likely: 8, max: 8 },
  constants: BENCH_CONSTANTS,
  door: {
    techniques: ['T1190', 'T1566'],
    families: ['host'],
    cves: [flaw('CVE-2024-0001', 0.4)],
    assets: [exposed(0, [0, 0, 0.7]), exposed(0, [0, 0, 0.7])],
    applicable: [Float64Array.from([20]), Float64Array.from([0])],
    targetApplicable: [Float64Array.from([0]), Float64Array.from([0])],
    phishing: null,
  },
};

const NAKED_ESTATE: AttackRunFixture = {
  name: 'naked-estate',
  exercises: 'the empty posture: nothing prevents, nothing detects, and no capability can be knocked out',
  terminalTacticExternalId: IMPACT,
  actorClass: RANSOMWARE,
  repertoire: REPERTOIRE,
  groups: [
    { id: 'fleet', family: 'host', assets: 30, exposure: 'internet_facing', criticality: 'high', matchedByScenarioGroup: true },
    { id: 'switches', family: 'network_device', assets: 3, exposure: 'internal', criticality: 'low', matchedByScenarioGroup: false },
  ],
  controls: [],
  reactionTimeHours: { min: 0.5, likely: 8, max: 96 },
  constants: BENCH_CONSTANTS,
  door: {
    techniques: ['T1190', 'T1566'],
    families: ['host', 'network_device'],
    cves: [],
    assets: [],
    applicable: [Float64Array.from([30, 0]), Float64Array.from([0, 0])],
    targetApplicable: [Float64Array.from([0, 0]), Float64Array.from([0, 0])],
    phishing: null,
  },
};

const EXFILTRATION_CHAIN: AttackRunFixture = {
  name: 'exfiltration-chain',
  exercises: 'the six-obstacle chain: the depth grading and the race window both read the chain length',
  terminalTacticExternalId: EXFILTRATION,
  actorClass: RANSOMWARE,
  repertoire: [
    ...REPERTOIRE.filter((candidate) => candidate.externalId !== 'T1486'),
    technique('T1005', ['TA0009'], ['host', 'saas_application']),
    technique('T1048', ['TA0010'], ['host', 'network_device']),
  ],
  groups: [
    { id: 'crown-jewels', family: 'host', assets: 7, exposure: 'internal', criticality: 'high', matchedByScenarioGroup: true },
    { id: 'workstations', family: 'host', assets: 80, exposure: 'internal', criticality: 'low', matchedByScenarioGroup: false },
    { id: 'switches', family: 'network_device', assets: 5, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
  ],
  controls: [EDR, FIREWALL],
  reactionTimeHours: { min: 0.5, likely: 8, max: 96 },
  constants: BENCH_CONSTANTS,
  door: {
    techniques: ['T1190', 'T1566'],
    families: ['host'],
    cves: [flaw('CVE-2024-0001', 0.3)],
    assets: [exposed(0, [0, 0, 0.6])],
    applicable: [Float64Array.from([7]), Float64Array.from([0])],
    targetApplicable: [Float64Array.from([0]), Float64Array.from([0])],
    phishing: null,
  },
};

const UNPLAYABLE_OBSTACLE: AttackRunFixture = {
  name: 'unplayable-obstacle',
  exercises: 'an obstacle the repertoire cannot play at all, which must be named rather than shown as a silent zero',
  terminalTacticExternalId: IMPACT,
  actorClass: RANSOMWARE,
  repertoire: REPERTOIRE.filter((candidate) => !candidate.tacticExternalIds.includes('TA0007')),
  groups: [
    { id: 'fleet', family: 'host', assets: 40, exposure: 'internal', criticality: 'medium', matchedByScenarioGroup: false },
  ],
  controls: [EDR],
  reactionTimeHours: { min: 0.5, likely: 8, max: 96 },
  constants: BENCH_CONSTANTS,
  door: {
    techniques: ['T1190', 'T1566'],
    families: ['host'],
    cves: [],
    assets: [],
    applicable: [Float64Array.from([10]), Float64Array.from([0])],
    targetApplicable: [Float64Array.from([0]), Float64Array.from([0])],
    phishing: null,
  },
};

export const ATTACK_RUN_FIXTURES: ReadonlyArray<AttackRunFixture> = [
  UNEVEN_ESTATE,
  HOMOGENEOUS_ESTATE,
  NAKED_ESTATE,
  EXFILTRATION_CHAIN,
  UNPLAYABLE_OBSTACLE,
];
