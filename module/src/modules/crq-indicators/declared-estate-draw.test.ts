import { describe, expect, it } from 'vitest';
import type { AttackRunInputsSource } from './attack-run-inputs';
import type { DeclaredKindRow } from './declared-estate-completion';
import type { DoorCountRow } from './attack-run-door-estate';
import type { AttackRunDeclaredKind, AttackRunGroup } from './engine/attack-run-law';
import type { EngineRunResult } from './engine/engine-run';
import { resolveAttackRunInputs } from './attack-run-inputs';
import { buildDoorEstate } from './attack-run-door-estate';
import { prepareCollapse } from './attack-run-estate';
import { completeDeclaredEstate } from './declared-estate-completion';
import { createEngineRun } from './engine/engine-run';
import { buildAttackRunWorlds, declaredVirtualCount, worldDrawAt } from './engine/attack-run-worlds';

const WORLDS = 1000;

const drawnTotals = (declared: AttackRunDeclaredKind, controls: Parameters<typeof buildAttackRunWorlds>[0]['controls'] = []): Array<number> => {
  const worlds = buildAttackRunWorlds({
    controls,
    obstacleCount: 5,
    reactionTimeHours: { min: 1, likely: 8, max: 48 },
    worlds: WORLDS,
    seed: 'declared-draw',
    cveIds: [],
    familyIds: [],
    declaredKinds: [declared],
  });
  return Array.from({ length: WORLDS }, (_, world) => declared.held + worldDrawAt(worlds, world).declaredCount![0]);
};

describe('the count a world draws for a declared kind', () => {
  it('should vary between worlds and stay within the bounds', () => {
    const totals = drawnTotals({ kind: 'people', low: 251, high: 1000, held: 0 });

    expect(new Set(totals).size).toBeGreaterThan(100);
    expect(Math.min(...totals)).toBeGreaterThanOrEqual(251);
    expect(Math.max(...totals)).toBeLessThanOrEqual(1000);
    expect(totals.every(Number.isInteger)).toBe(true);
  });

  it('should draw on a log scale, as many worlds between 251 and 500 as between 501 and 1,000', () => {
    const totals = drawnTotals({ kind: 'people', low: 251, high: 1000, held: 0 });
    const lower = totals.filter((total) => total <= 500).length;

    expect(Math.abs(lower - (WORLDS - lower))).toBeLessThanOrEqual(10);
  });

  it('should draw a range starting at 0 uniformly', () => {
    const totals = drawnTotals({ kind: 'servers', low: 0, high: 100, held: 0 });

    expect(Math.abs(totals.filter((total) => total <= 50).length - WORLDS / 2)).toBeLessThanOrEqual(10);
    expect(Math.min(...totals)).toBe(0);
  });

  it('should never count a kind below what it already holds', () => {
    const totals = drawnTotals({ kind: 'workstations', low: 10, high: 100, held: 30 });

    expect(Math.min(...totals)).toBe(30);
    expect(totals.filter((total) => total === 30).length).toBeGreaterThan(400);
    expect(Math.max(...totals)).toBeLessThanOrEqual(100);
  });

  it('should read the first and last cells at the bounds', () => {
    const declared = { kind: 'people', low: 251, high: 1000, held: 0 };

    expect(declaredVirtualCount(declared, 0)).toBe(251);
    expect(declaredVirtualCount(declared, 1)).toBe(1000);
  });

  it('should key each draw by its kind, so adding a control or another kind moves none of it', () => {
    const declared = { kind: 'people', low: 11, high: 50, held: 0 };
    const control = {
      capabilityExternalId: 'EDR',
      coverage: 0.7,
      upgradedCoverage: 1,
      prevent: { strength: 0.7, upgradedStrength: 0.85 },
      detect: { strength: 0.7, upgradedStrength: 0.85 },
    };
    const withOther = buildAttackRunWorlds({
      controls: [control],
      obstacleCount: 5,
      reactionTimeHours: { min: 1, likely: 8, max: 48 },
      worlds: WORLDS,
      seed: 'declared-draw',
      cveIds: ['cve-1'],
      familyIds: ['host'],
      declaredKinds: [{ kind: 'servers', low: 1, high: 10, held: 0 }, declared],
    });

    expect(Array.from({ length: WORLDS }, (_, world) => worldDrawAt(withOther, world).declaredCount![1])).toEqual(drawnTotals(declared));
  });
});

describe('completing the measured estate with drawn kinds', () => {
  const door = (categoryId: DoorCountRow['categoryId'], subcategoryId: DoorCountRow['subcategoryId'], count: number): DoorCountRow =>
    ({ categoryId, subcategoryId, exposure: 'internal', identityEnabled: true, target: false, count });

  it('should draw nothing for an exact number, which completes the estate as it did', () => {
    const completion = completeDeclaredEstate([{ kind: 'servers', low: 8, high: 8, internetFacing: null }], [], 'internal');

    expect(completion.kinds).toEqual([]);
    expect(completion.counts).toEqual([{ categoryId: 'host', exposure: 'internal', criticality: 'unknown', count: 8 }]);
  });

  it('should draw a range above what the kind holds, keeping its row at the low bound', () => {
    const completion = completeDeclaredEstate(
      [{ kind: 'servers', low: 11, high: 50, internetFacing: true }],
      [door('host', 'server', 4)],
      'internal',
    );

    expect(completion.kinds).toEqual([{ kind: 'servers', low: 11, high: 50, held: 5 }]);
    expect(completion.counts).toEqual([
      { categoryId: 'host', exposure: 'internet_facing', criticality: 'unknown', count: 1 },
      { categoryId: 'host', exposure: 'internal', criticality: 'unknown', count: 6, declaredKind: 'servers' },
    ]);
  });

  it('should keep a drawn kind the measure already reaches at no virtual asset, for the worlds drawing more', () => {
    const completion = completeDeclaredEstate([{ kind: 'servers', low: 11, high: 50, internetFacing: null }], [door('host', 'server', 20)], 'internal');

    expect(completion.kinds).toEqual([{ kind: 'servers', low: 11, high: 50, held: 20 }]);
    expect(completion.doorCounts).toEqual([{ ...door('host', 'server', 0), declaredKind: 'servers' }]);
  });

  it('should draw nothing for a kind the measure already fills to its high bound', () => {
    expect(completeDeclaredEstate([{ kind: 'servers', low: 11, high: 50, internetFacing: null }], [door('host', 'server', 60)], 'internal'))
      .toEqual({ counts: [], doorCounts: [], kinds: [] });
  });
});

const APPLICABLE = new Map<string, Array<'host' | 'identity'>>([
  ['T1566', ['host', 'identity']],
  ['T1078', ['identity', 'host']],
  ['T1059', ['host']],
  ['T1018', ['host']],
  ['T1082', ['host']],
  ['T1068', ['host']],
  ['T1003', ['host', 'identity']],
  ['T1021', ['host', 'identity']],
  ['T1486', ['host', 'identity']],
]);

/** A scope that measured nothing and declared its people and workstations. */
const sourceOf = (declared: ReadonlyArray<DeclaredKindRow>): AttackRunInputsSource => ({
  terminalTacticExternalId: 'TA0040',
  applicableFamiliesByTechnique: APPLICABLE,
  mixture: [{
    groupKey: 'crew',
    name: 'Ransomware crew',
    share: 1,
    techniqueExternalIds: ['T1566', 'T1078', 'T1059', 'T1018', 'T1082', 'T1068', 'T1003', 'T1021', 'T1486'],
    actorClass: 'ransomware_operator',
    cveExternalIds: new Set(),
  }],
  controls: [{
    controlId: 'edr',
    capabilityExternalId: 'EDR',
    strengthRung: 'L2',
    coverageBucket: 'L2',
    preventTechniqueExternalIds: ['T1059', 'T1486'],
    detectTechniqueExternalIds: ['T1003', 'T1059'],
  }],
  estate: {
    counts: [],
    scenarioGroupCounts: [],
    routes: [],
    unscannedAssetCount: 0,
    door: { counts: [], openings: [], primaryUsers: [] },
    declared: completeDeclaredEstate(declared, [], 'internal'),
  },
  phishing: { declaredSusceptibility: null },
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
  plans: [],
  tef: { min: 0.5, likely: 1.5, max: 4 },
  lossDrivers: [{ min: 100_000, likely: 600_000, max: 3_000_000 }],
  reactionTimeHours: { min: 4, likely: 24, max: 96 },
  worlds: WORLDS,
  seed: 'declared-estate-draw',
  threatRelevance: { evidenceMode: 'mixture', admittedActorCount: 1 },
  computesCveWhatIfs: true,
});

const runOf = async (declared: ReadonlyArray<DeclaredKindRow>): Promise<EngineRunResult> => {
  const { inputs } = await resolveAttackRunInputs(sourceOf(declared));
  const run = createEngineRun(inputs);
  run.advance(WORLDS);
  return run.result();
};

const WORKSTATIONS: DeclaredKindRow = { kind: 'workstations', low: 20, high: 20, internetFacing: null };
const exactPeople = (count: number): DeclaredKindRow => ({ kind: 'people', low: count, high: count, internetFacing: null });

describe('a run on a declared estate', () => {
  it('should widen the annual loss range for a wide band against an exact number at its likely value', async () => {
    const band = await runOf([WORKSTATIONS, { kind: 'people', low: 1, high: 50, internetFacing: null }]);
    const exact = await runOf([WORKSTATIONS, exactPeople(7)]);

    expect(band.ale.p95 - band.ale.p5).toBeGreaterThan(exact.ale.p95 - exact.ale.p5);
    expect(band.vulnerability.p95 - band.vulnerability.p5).toBeGreaterThan(exact.vulnerability.p95 - exact.vulnerability.p5);
  });

  it('should give the same run for the same inputs', async () => {
    const declared = [WORKSTATIONS, { kind: 'people', low: 11, high: 50, internetFacing: null } as const];

    expect(await runOf(declared)).toEqual(await runOf(declared));
  });

  it('should read an exact number without any draw', async () => {
    const { inputs } = await resolveAttackRunInputs(sourceOf([WORKSTATIONS, exactPeople(7)]));

    expect(inputs).not.toHaveProperty('declaredKinds');
    expect(inputs.door).not.toHaveProperty('declared');
    expect(inputs.actors.every((actor) => actor.groups.every((group) => group.declaredKinds === undefined))).toBe(true);
  });
});

describe('where the drawn kinds land', () => {
  it('should name, at the door, the techniques counting each drawn kind and whether it is people', () => {
    const door = buildDoorEstate({
      techniqueExternalIds: ['T1566', 'T1078'],
      applicableFamiliesByTechnique: new Map([['T1078', ['identity']], ['T1566', ['identity', 'host']]]),
      counts: [
        { categoryId: 'identity', subcategoryId: 'service_account', exposure: 'internal', identityEnabled: true, target: false, count: 0, declaredKind: 'service_accounts' },
        { categoryId: 'identity', subcategoryId: 'user_account', exposure: 'internal', identityEnabled: true, target: false, count: 3, declaredKind: 'people' },
      ],
      openings: [],
      primaryUsers: [],
      unknownExposureCountsAs: 'internal',
    });

    expect(door.techniques).toEqual(['T1078', 'T1566']);
    expect(door.declared).toEqual([
      { kind: 'people', family: 0, techniques: [0], people: true },
      { kind: 'service_accounts', family: 0, techniques: [0], people: false },
    ]);
    expect(door.phishing?.people).toBe(3);
  });

  it('should keep the drawn kinds on the plain group of the estate a CVE what-if regroups', () => {
    const collapse = prepareCollapse({
      counts: [
        { categoryId: 'host', exposure: 'internal', criticality: 'unknown', count: 10, declaredKind: 'servers' },
        { categoryId: 'host', exposure: 'internal', criticality: 'unknown', count: 5 },
      ],
      scenarioGroupCounts: [],
      routes: [{
        supportingAssetId: 'asset-1',
        categoryId: 'host',
        exposure: 'internal',
        criticality: 'unknown',
        matchedByScenarioGroup: false,
        cveExternalId: 'CVE-2024-0001',
        cveRowId: 'cve-1',
        techniqueExternalId: 'T1068',
      }],
      members: [{ share: 1, cveExternalIds: new Set(['CVE-2024-0001']), techniqueExternalIds: new Set(['T1068']) }],
    });
    const plain = (groups: ReadonlyArray<AttackRunGroup>) => groups.filter((group) => group.declaredKinds !== undefined);

    expect(plain(collapse.groups)).toEqual([expect.objectContaining({ assets: 14, declaredKinds: ['servers'], cveFloors: [] })]);
    expect(plain(collapse.without('cve-1')!)).toEqual([expect.objectContaining({ assets: 15, declaredKinds: ['servers'], cveFloors: [] })]);
  });
});
