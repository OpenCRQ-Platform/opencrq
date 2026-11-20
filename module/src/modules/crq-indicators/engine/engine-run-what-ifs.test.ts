import { describe, expect, it, vi } from 'vitest';
import type { DoorEstate } from './attack-run-door';
import type { AttackRunConstants, AttackRunGroup, AttackRunTechnique } from './attack-run-law';
import type { EngineRunActor, EngineRunControl, EngineRunInputs, EngineRunResult } from './engine-run';
import { buildDoorEstate } from '../attack-run-door-estate';
import { PHISHING_CONSTANTS, phishingCampaignSize } from './attack-run-constants';
import { createEngineRun } from './engine-run';
import * as evaluation from './attack-run-evaluation';

vi.mock('./attack-run-evaluation', async (importOriginal) => {
  const actual = await importOriginal<typeof evaluation>();
  return {
    ...actual,
    evaluateAttackRun: vi.fn(actual.evaluateAttackRun),
    evaluateBaseline: vi.fn(actual.evaluateBaseline),
    evaluateWhatIf: vi.fn(actual.evaluateWhatIf),
    forgoneExploitLeavesDoor: vi.fn(actual.forgoneExploitLeavesDoor),
  };
});

const EVALUATIONS = [evaluation.evaluateAttackRun, evaluation.evaluateBaseline, evaluation.evaluateWhatIf];

const CONSTANTS: AttackRunConstants = {
  visitQuota: 5,
  populationDetectionCap: 7,
  unknownFlawFloorScale: 0.04,
  detectionScale: 0.0383,
  signalGain: 0.3,
  execFloor: 0.3,
  postDetectionRate: 0.7,
  coupleSuccessCap: 0.98,
  actorExploitedCveFloor: 0.9,
};

const technique = (externalId: string, tacticExternalIds: ReadonlyArray<string>): AttackRunTechnique =>
  ({ externalId, tacticExternalIds, families: ['host'] });

const REPERTOIRE: ReadonlyArray<AttackRunTechnique> = [
  technique('X1', ['TA0001']), technique('X2', ['TA0006']), technique('X3', ['TA0007']), technique('X4', ['TA0008']),
  technique('X5', ['TA0040']), technique('E1', ['TA0002']), technique('S1', ['TA0005']), technique('P1', ['TA0003']),
  technique('C1', ['TA0011']), technique('T1553', ['TA0112']),
];

const GROUPS: ReadonlyArray<AttackRunGroup> = [
  { id: 'jewels', family: 'host', assets: 8, exposure: 'internal', criticality: 'high', matchedByScenarioGroup: true },
  { id: 'desktops', family: 'host', assets: 200, exposure: 'internal', criticality: 'low', matchedByScenarioGroup: false },
];

const control = (capabilityExternalId: string, prevent: ReadonlyArray<string>, detect: ReadonlyArray<string>, over: Partial<EngineRunControl> = {}): EngineRunControl => ({
  controlId: `id-${capabilityExternalId}`,
  capabilityExternalId,
  strengthRung: 'L2',
  coverageBucket: 'L2',
  preventTechniqueExternalIds: prevent,
  detectTechniqueExternalIds: detect,
  ...over,
});

const actor = (over: Partial<EngineRunActor> = {}): EngineRunActor => ({
  key: 'actor-1',
  name: 'Ransomware crew',
  actorClass: 'ransomware_operator',
  knobs: { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 },
  share: 1,
  repertoire: REPERTOIRE,
  groups: GROUPS,
  ...over,
});

/** Several independent flaws, so a full run prices a what-if per CVE and the profile has something to skip. */
const DOOR: DoorEstate = {
  techniques: ['X1'],
  families: ['host'],
  cves: Array.from({ length: 4 }, (_, index) => ({ cveId: `CVE-2024-000${index}`, threat: 0.5, priced: true })),
  assets: Array.from({ length: 4 }, (_, index) => ({ family: 0, openings: [{ cve: index, technique: 0, opening: 0.6 }], target: false })),
  applicable: [Float64Array.from([20])],
  targetApplicable: [Float64Array.from([0])],
  phishing: null,
};

const WORLDS = 300;

const inputsOf = (over: Partial<EngineRunInputs> = {}): EngineRunInputs => ({
  terminalTacticExternalId: 'TA0040',
  controls: [
    control('EDR', ['X1', 'X4', 'E1'], ['X1', 'X3', 'X4', 'X5']),
    control('PAM', ['X2'], ['X2']),
    control('NGFW', ['X4'], ['X4'], { strengthRung: 'L1', coverageBucket: 'L1' }),
    control('NDR', ['X3'], ['C1', 'X3'], { strengthRung: 'L0', coverageBucket: 'L0' }),
  ],
  actors: [
    actor({ key: 'a', share: 0.6 }),
    actor({ key: 'b', share: 0.4, knobs: { capability: 0.5, stealth: 0.7, patience: 0.4, attackRunDays: 20 }, repertoire: REPERTOIRE.slice(0, 7) }),
  ],
  tef: { min: 0.5, likely: 1, max: 3 },
  lossDrivers: [{ min: 100000, likely: 400000, max: 2000000 }, { min: 1000, likely: 5000, max: 90000 }],
  reactionTimeHours: { min: 0.5, likely: 8, max: 96 },
  constants: CONSTANTS,
  door: DOOR,
  phishing: { declaredSusceptibility: null },
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
  worlds: WORLDS,
  seed: 'what-ifs-scenario',
  plans: [
    { planId: 'p1', moves: [{ controlId: 'id-NGFW', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }] },
    { planId: 'p2', moves: [{ controlId: 'id-EDR', targetStrengthRung: 'L3', targetCoverageBucket: null }, { controlId: 'id-NDR', targetStrengthRung: 'L2', targetCoverageBucket: 'L2' }] },
  ],
  ...over,
});

const NO_WHAT_IF = { techniques: false, cves: false, leverControlIds: new Set<string>() };

const runWhole = (inputs: EngineRunInputs): EngineRunResult => {
  const run = createEngineRun(inputs);
  run.advance(inputs.worlds);
  return run.result();
};

const runStepwise = (inputs: EngineRunInputs): EngineRunResult => {
  const run = createEngineRun(inputs);
  while (!run.done()) {
    run.advanceUntil(() => true);
  }
  return run.result();
};

const headline = (result: EngineRunResult) => ({
  ale: result.ale,
  lef: result.lef,
  vulnerability: result.vulnerability,
  magnitude: result.magnitude,
  outcomes: result.outcomes,
  annualLoss: result.annualLoss,
  memorylessAle: result.calibration.memorylessAle,
  actors: result.actors,
});

const evaluationsOf = (inputs: EngineRunInputs): number => {
  EVALUATIONS.forEach((evaluate) => vi.mocked(evaluate).mockClear());
  runWhole(inputs);
  return EVALUATIONS.reduce((calls, evaluate) => calls + vi.mocked(evaluate).mock.calls.length, 0);
};

const BASELINE_EVALUATIONS = WORLDS * 2 * 2;

describe('a run computing part of the what-ifs', () => {
  it('answers the headline of a full run bit for bit without any of them', () => {
    const full = runWhole(inputsOf());

    for (const priceOnly of [
      runWhole(inputsOf({ whatIfs: NO_WHAT_IF, plans: [] })),
      runStepwise(inputsOf({ whatIfs: NO_WHAT_IF, plans: [] })),
      runWhole(inputsOf({ whatIfs: NO_WHAT_IF })),
    ]) {
      expect(headline(priceOnly)).toStrictEqual(headline(full));
      expect(Object.is(priceOnly.ale.mean, full.ale.mean)).toBe(true);
    }
  });

  it('evaluates only the baseline and its memoryless replay on a price profile', () => {
    expect(evaluationsOf(inputsOf({ whatIfs: NO_WHAT_IF, plans: [] }))).toBe(BASELINE_EVALUATIONS);
    expect(evaluationsOf(inputsOf())).toBeGreaterThan(BASELINE_EVALUATIONS);
  });

  it('spends no whole evaluation on what the baseline it records already answers', () => {
    vi.mocked(evaluation.forgoneExploitLeavesDoor).mockClear();
    evaluationsOf(inputsOf());
    const whole = vi.mocked(evaluation.evaluateAttackRun).mock.calls;
    const resumed = vi.mocked(evaluation.evaluateWhatIf).mock.calls;
    const leaves = vi.mocked(evaluation.forgoneExploitLeavesDoor).mock.results.flatMap((result) => (result.type === 'return' ? [result.value] : []));

    expect(vi.mocked(evaluation.evaluateBaseline).mock.calls).toHaveLength(WORLDS * inputsOf().actors.length);
    expect(whole.filter(([, interdiction]) => interdiction !== undefined)).toEqual([]);
    expect(resumed.filter(([, interdiction]) => interdiction === undefined).length).toBeGreaterThan(0);
    expect(leaves).toContain(true);
    expect(whole.filter(([, , , forgone]) => (forgone ?? -1) >= 0)).toHaveLength(leaves.filter((leave) => !leave).length);
  });

  it('can pause after every door pass a forgone exploit spends', () => {
    const scans = vi.mocked(evaluation.forgoneExploitLeavesDoor);
    scans.mockClear();
    const run = createEngineRun(inputsOf());
    const scansAtPause = [0];
    while (!run.done()) {
      run.advanceUntil(() => true);
      scansAtPause.push(scans.mock.calls.length);
    }
    const scansPerStep = scansAtPause.slice(1).map((count, step) => count - scansAtPause[step]);

    expect(scans.mock.results.filter((result) => result.type === 'return' && result.value === true).length).toBeGreaterThan(1);
    expect(Math.max(...scansPerStep)).toBe(1);
  });

  it('reports only the controls it names, priced as a full run prices them', () => {
    const full = runWhole(inputsOf());
    const levers = runWhole(inputsOf({ whatIfs: { techniques: false, cves: false, leverControlIds: new Set(['id-PAM']) }, plans: [] }));

    expect(levers.techniqueValues).toEqual([]);
    expect(levers.planValues).toEqual([]);
    expect(levers.controlValues).toStrictEqual(full.controlValues.filter((value) => value.controlId === 'id-PAM'));
  });

  it('reports no CVE what-if when it does not compute them, and every other figure as a run computing them', () => {
    const full = runWhole(inputsOf());
    const without = runWhole(inputsOf({ whatIfs: { techniques: true, cves: false, leverControlIds: 'all' } }));

    expect(full.cveValues).toHaveLength(DOOR.cves.length);
    expect(without.cveValues).toEqual([]);
    expect(headline(without)).toStrictEqual(headline(full));
    expect(without.techniqueValues).toStrictEqual(full.techniqueValues);
    expect(without.controlValues).toStrictEqual(full.controlValues);
    expect(without.planValues).toStrictEqual(full.planValues);
  });

  it('computes the CVE what-ifs alone for the price of the baseline and the flaws that circulate', () => {
    const onlyCves = { techniques: false, cves: true, leverControlIds: new Set<string>() };
    const full = runWhole(inputsOf());
    const result = runWhole(inputsOf({ whatIfs: onlyCves, plans: [] }));

    expect(result.cveValues).toStrictEqual(full.cveValues);
    expect(result.techniqueValues).toEqual([]);
    expect(evaluationsOf(inputsOf({ whatIfs: onlyCves, plans: [] }))).toBeGreaterThan(BASELINE_EVALUATIONS);
  });

  it('prices the plans it is given exactly as a full run does', () => {
    const full = runWhole(inputsOf());
    const plan = runWhole(inputsOf({ whatIfs: NO_WHAT_IF, plans: inputsOf().plans!.slice(1) }));

    expect(plan.planValues).toStrictEqual(full.planValues.slice(1));
  });
});

describe('a run that cannot price', () => {
  it.each([
    ['no TEF', { tef: null }],
    ['no loss estimate', { lossDrivers: [] }],
  ] as const)('with %s evaluates no what-if and reports the rows a priced run reports, at zero', (_, unpriced) => {
    const priced = runWhole(inputsOf());
    const result = runWhole(inputsOf(unpriced));

    expect(evaluationsOf(inputsOf(unpriced))).toBe(BASELINE_EVALUATIONS);
    const zero = { mean: 0, p5: 0, p10: 0, p50: 0, p90: 0, p95: 0 };
    expect(result.controlValues).toStrictEqual(priced.controlValues.map((value) => ({
      ...value,
      levers: value.levers.map((lever) => ({ ...lever, aleReduction: zero })),
    })));
    expect(result.techniqueValues).toStrictEqual(priced.techniqueValues.map((value) => ({ ...value, preventValue: 0, detectValue: 0 })));
    expect(result.planValues).toStrictEqual(priced.planValues.map((value) => ({ ...value, aleReduction: zero })));
  });
});

describe('a run whose initial access is phishing', () => {
  const PEOPLE = 40;
  const PHISHING_REPERTOIRE: ReadonlyArray<AttackRunTechnique> = REPERTOIRE.map((entry) => (entry.externalId === 'X1'
    ? { externalId: 'T1566', tacticExternalIds: ['TA0001'], families: ['host', 'identity'], populationScoped: true }
    : entry));
  const PHISHING_GROUPS: ReadonlyArray<AttackRunGroup> = [
    ...GROUPS,
    { id: 'accounts', family: 'identity', assets: PEOPLE, exposure: 'internal', criticality: 'low', matchedByScenarioGroup: false },
  ];
  const DEVICE_FLAW = {
    supportingAssetId: 'device-1',
    categoryId: 'host',
    subcategoryId: 'workstation',
    exposure: 'internal',
    target: false,
    cveId: 'CVE-PHISH',
    techniqueExternalId: 'T1566',
    opening: 0.9,
    threat: 0.6,
  } as const;

  const doorOf = (primaryUsers: ReadonlyArray<{ identityId: string, deviceId: string, deviceCategoryId: 'host', identityTarget: boolean }>, flawed = true): DoorEstate =>
    buildDoorEstate({
      techniqueExternalIds: ['T1566'],
      applicableFamiliesByTechnique: new Map([['T1566', ['host', 'identity'] as const]]),
      counts: [
        { categoryId: 'identity', subcategoryId: 'user_account', exposure: 'unknown', identityEnabled: true, target: false, count: PEOPLE },
        { categoryId: 'host', subcategoryId: 'workstation', exposure: 'internal', identityEnabled: true, target: false, count: 200 },
      ],
      openings: flawed ? [DEVICE_FLAW] : [],
      primaryUsers,
      unknownExposureCountsAs: 'internal',
    });

  const phishingInputs = (door: DoorEstate, over: Partial<EngineRunInputs> = {}): EngineRunInputs => inputsOf({
    door,
    actors: [actor({ repertoire: PHISHING_REPERTOIRE, groups: PHISHING_GROUPS })],
    plans: [],
    phishing: { declaredSusceptibility: null },
    ...over,
  });

  const cveValueOf = (result: EngineRunResult) => result.cveValues.find((value) => value.cveId === 'CVE-PHISH')!;

  it('values a flaw that opens only phishing on a device with no user at exactly zero', () => {
    const value = cveValueOf(runWhole(phishingInputs(doorOf([]), { controls: [] })));

    expect(value.aleReductionMean).toBe(0);
    expect(value.aleReductionP10).toBe(0);
    expect(value.aleReductionP90).toBe(0);
  });

  it('values the same flaw above zero once the device has a user, and at no more than the share of phishing that needs a client-side exploit', () => {
    const inputs = phishingInputs(doorOf([{ identityId: 'user-1', deviceId: 'device-1', deviceCategoryId: 'host', identityTarget: false }]), { controls: [] });
    const result = runWhole(inputs);
    const value = cveValueOf(result);

    const { clientExploitShare, credentialShare, defaultSusceptibility } = PHISHING_CONSTANTS;
    const recipients = phishingCampaignSize('ransomware_operator', PEOPLE);
    // With no control a recipient falls with `s x (c + (1 - c) x (1 - kappa))`; one device opened lifts the campaign's mean by at most
    // `s x (1 - c) x kappa` over the people, and the entry is the chance that one of the recipients falls.
    const base = defaultSusceptibility * (credentialShare + (1 - credentialShare) * (1 - clientExploitShare));
    const lift = (defaultSusceptibility * (1 - credentialShare) * clientExploitShare) / PEOPLE;
    const entry = (chance: number): number => 1 - (1 - chance) ** recipients;
    const boundShare = entry(base + lift) / entry(base) - 1;
    expect(value.aleReductionMean).toBeGreaterThan(0);
    expect(value.aleReductionMean).toBeLessThanOrEqual(boundShare * result.ale.mean);
  });

  it('gives the email filtering and the multi-factor levers a gain on an estate with no flaw', () => {
    const controls = [
      control('SEG', ['T1566'], []),
      control('IDP', ['T1078'], []),
    ];
    const result = runWhole(phishingInputs(doorOf([], false), { controls }));

    for (const controlId of ['id-SEG', 'id-IDP']) {
      const levers = result.controlValues.find((value) => value.controlId === controlId)!.levers;
      const gain = (dimension: string): number => levers.find((lever) => lever.dimension === dimension)!.aleReduction.mean;
      expect(gain('strength'), `${controlId} strength`).toBeGreaterThan(0);
      expect(gain('coverage'), `${controlId} coverage`).toBeGreaterThan(0);
    }
  });
});
