import { describe, expect, it } from 'vitest';
import type { AttackRunInputsSource, ResolvedAttackRunInputs } from './attack-run-inputs';
import type { AssetCategory } from '../supporting-assets/constants';
import type { DoorCountRow, EntryOpeningRow, PrimaryUserRow } from './attack-run-door-estate';
import type { AttackRunTestedCell, CompiledAttackRunLaw } from './engine/attack-run-law';
import { ASSET_CATEGORY_VALUES, DECLARED_CRITICALITY_VALUES } from '../supporting-assets/constants';
import { APPLICABLE_TECHNIQUES } from '../attack-surfaces/data';
import { SILENT_FLAW_THREAT } from '../cve/silent-flaw-threat';
import { fingerprintedBaseline, resolveAttackRunInputs } from './attack-run-inputs';
import { fingerprintRunInputs } from './run-fingerprint';
import { compileAttackRunLaw } from './engine/attack-run-law';

/**
 * The engine promises a run reproducible from its seed, and every collection below reaches a float
 * reduction or a per-index seed. None of the reads that fill them fixes an order, so the promise
 * holds only if the resolver imposes one.
 */

const doorCount = (
  categoryId: DoorCountRow['categoryId'],
  subcategoryId: DoorCountRow['subcategoryId'],
  exposure: DoorCountRow['exposure'],
  identityEnabled: boolean,
  count: number,
): DoorCountRow => ({ categoryId, subcategoryId, exposure, identityEnabled, target: false, count });

const DOOR_COUNTS: ReadonlyArray<DoorCountRow> = [
  doorCount('host', null, 'internal', true, 200),
  doorCount('host', null, 'internet_facing', true, 12),
  doorCount('host', 'server', 'internal', true, 7),
  doorCount('host', 'workstation', 'unknown', true, 5),
  doorCount('web_application', null, 'internet_facing', true, 9),
  doorCount('identity', 'user_account', 'internal', true, 45),
  doorCount('identity', 'user_account', 'internal', false, 3),
  doorCount('identity', 'service_account', 'unknown', true, 6),
];

const opening = (
  supportingAssetId: string,
  cveId: string,
  techniqueExternalId: string,
  value: number,
  threat: number,
  categoryId: EntryOpeningRow['categoryId'] = 'host',
  exposure: EntryOpeningRow['exposure'] = 'internet_facing',
  subcategoryId: EntryOpeningRow['subcategoryId'] = null,
): EntryOpeningRow => ({
  supportingAssetId, categoryId, subcategoryId, exposure, target: false, cveId, techniqueExternalId, opening: value, threat,
});

const DOOR_OPENINGS: ReadonlyArray<EntryOpeningRow> = [
  opening('asset-b', 'CVE-2024-0001', 'T1566.001', 0.4, 0.9),
  opening('asset-b', 'CVE-2024-0001', 'T1566.002', 0.7, 0.9),
  opening('asset-b', 'CVE-2024-0001', 'T1190', 1, 0.9),
  opening('asset-b', 'CVE-2024-0002', 'T1566.001', 0.2, 0.3),
  opening('asset-a', 'CVE-2024-0001', 'T1190', 0.5, 0.95),
  // A technique no attacker of the run plays: it is no way in for this scenario.
  opening('asset-a', 'CVE-2024-0003', 'T1133', 1, 0.8),
];

const PRIMARY_USERS: ReadonlyArray<PrimaryUserRow> = [
  { identityId: 'user-b', deviceId: 'asset-b', deviceCategoryId: 'host', identityTarget: false },
  { identityId: 'user-a', deviceId: 'asset-b', deviceCategoryId: 'host', identityTarget: true },
  { identityId: 'user-a', deviceId: 'asset-a', deviceCategoryId: 'host', identityTarget: true },
];

const SOURCE: AttackRunInputsSource = {
  terminalTacticExternalId: 'TA0040',
  applicableFamiliesByTechnique: new Map([
    ['T1566', ['host', 'identity']],
    ['T1190', ['host']],
    ['T1078', ['identity', 'host']],
    ['T1059', ['host', 'cloud_resource']],
    ['T1053', ['host', 'identity']],
    ['T1003', ['host', 'identity']],
    ['T1021', ['host', 'identity']],
    ['T1486', ['host', 'identity']],
  ]),
  mixture: [
    {
      groupKey: 'b-crew',
      name: 'Ransomware crew',
      share: 0.4,
      techniqueExternalIds: ['T1566', 'T1190', 'T1059', 'T1003', 'T1021', 'T1486'],
      actorClass: 'ransomware_operator',
      cveExternalIds: new Set(['CVE-2024-0001']),
    },
    {
      groupKey: 'a-state',
      name: 'State actor',
      share: 0.3,
      techniqueExternalIds: ['T1566', 'T1078', 'T1053', 'T1003', 'T1486'],
      actorClass: 'state_sponsored',
      cveExternalIds: new Set(['CVE-2024-0002']),
    },
    {
      groupKey: 'c-crowd',
      name: 'Opportunistic crowd',
      share: 0.2,
      techniqueExternalIds: ['T1566', 'T1059', 'T1486'],
      actorClass: 'opportunistic_crime',
      cveExternalIds: new Set(['CVE-2024-0001', 'CVE-2024-0002']),
    },
    {
      groupKey: 'd-affiliate',
      name: 'Ransomware affiliate',
      share: 0.1,
      techniqueExternalIds: ['T1566', 'T1053', 'T1486'],
      actorClass: 'ransomware_operator',
      cveExternalIds: new Set(['CVE-2024-0002']),
    },
  ],
  controls: [
    {
      controlId: 'c-mfa',
      capabilityExternalId: 'IDP',
      strengthRung: 'L2',
      coverageBucket: 'L2',
      preventTechniqueExternalIds: ['T1078', 'T1021'],
      detectTechniqueExternalIds: [],
    },
    {
      controlId: 'a-edr',
      capabilityExternalId: 'EDR',
      strengthRung: 'L3',
      coverageBucket: 'L2',
      preventTechniqueExternalIds: ['T1059', 'T1486'],
      detectTechniqueExternalIds: ['T1003', 'T1059'],
    },
    {
      controlId: 'b-backup',
      capabilityExternalId: 'BCK',
      strengthRung: 'L2',
      coverageBucket: 'L1',
      preventTechniqueExternalIds: ['T1486'],
      detectTechniqueExternalIds: [],
    },
  ],
  estate: {
    counts: [
      { categoryId: 'host', exposure: 'internal', criticality: 'low', count: 200 },
      { categoryId: 'host', exposure: 'internet_facing', criticality: 'high', count: 12 },
      { categoryId: 'identity', exposure: 'internal', criticality: 'medium', count: 45 },
    ],
    scenarioGroupCounts: [
      { categoryId: 'host', exposure: 'internal', criticality: 'low', count: 30 },
      { categoryId: 'host', exposure: 'internet_facing', criticality: 'high', count: 5 },
    ],
    routes: [
      {
        supportingAssetId: 'asset-1',
        categoryId: 'host',
        exposure: 'internet_facing',
        criticality: 'high',
        matchedByScenarioGroup: true,
        cveExternalId: 'CVE-2024-0001',
        cveRowId: 'CVE-2024-0001',
        techniqueExternalId: 'T1059',
      },
      {
        supportingAssetId: 'asset-2',
        categoryId: 'host',
        exposure: 'internal',
        criticality: 'low',
        matchedByScenarioGroup: false,
        cveExternalId: 'CVE-2024-0002',
        cveRowId: 'CVE-2024-0002',
        techniqueExternalId: 'T1003',
      },
      {
        supportingAssetId: 'asset-3',
        categoryId: 'host',
        exposure: 'internal',
        criticality: 'low',
        matchedByScenarioGroup: false,
        cveExternalId: 'CVE-2024-0001',
        cveRowId: 'CVE-2024-0001',
        techniqueExternalId: 'T1486',
      },
    ],
    unscannedAssetCount: 17,
    door: { counts: DOOR_COUNTS, openings: DOOR_OPENINGS, primaryUsers: PRIMARY_USERS },
  },
  phishing: { declaredSusceptibility: null },
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
  plans: [
    {
      planId: 'b-widen-endpoints',
      moves: [
        { controlId: 'c-mfa', targetStrengthRung: 'L3', targetCoverageBucket: null },
        { controlId: 'a-edr', targetStrengthRung: null, targetCoverageBucket: 'L3' },
      ],
    },
    {
      planId: 'a-harden-identity',
      moves: [{ controlId: 'b-backup', targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }],
    },
  ],
  tef: { min: 0.5, likely: 1.5, max: 4 },
  lossDrivers: [
    { min: 100_000, likely: 600_000, max: 3_000_000 },
    { min: 50_000, likely: 200_000, max: 800_000 },
    { min: 10_000, likely: 90_000, max: 400_000 },
  ],
  reactionTimeHours: { min: 4, likely: 24, max: 96 },
  worlds: 64,
  seed: 'a-scenario-id',
  threatRelevance: {
    evidenceMode: 'attacker-mixture',
    admittedActorCount: 3,
  },
  computesCveWhatIfs: true,
};

/** Every collection the reads hand over, in the opposite order. */
const reversed = (source: AttackRunInputsSource): AttackRunInputsSource => ({
  ...source,
  applicableFamiliesByTechnique: new Map([...source.applicableFamiliesByTechnique]
    .reverse()
    .map(([externalId, families]) => [externalId, [...families].reverse()])),
  mixture: [...source.mixture]
    .reverse()
    .map((group) => ({ ...group, techniqueExternalIds: [...group.techniqueExternalIds].reverse() })),
  controls: [...source.controls].reverse(),
  plans: [...source.plans].reverse().map((plan) => ({ ...plan, moves: [...plan.moves].reverse() })),
  estate: {
    ...source.estate,
    counts: [...source.estate.counts].reverse(),
    scenarioGroupCounts: [...source.estate.scenarioGroupCounts].reverse(),
    routes: [...source.estate.routes].reverse(),
    door: {
      counts: [...source.estate.door.counts].reverse(),
      openings: [...source.estate.door.openings].reverse(),
      primaryUsers: [...source.estate.door.primaryUsers].reverse(),
    },
  },
  lossDrivers: [...source.lossDrivers].reverse(),
});

describe('resolveAttackRunInputs', () => {
  const pairsOf = (pairs: ReadonlyArray<{ techniqueExternalId: string, family: string }>) =>
    pairs.map((pair) => `${pair.techniqueExternalId}|${pair.family}`);

  it('should resolve the same run whatever order the reads returned', async () => {
    const straight = await resolveAttackRunInputs(SOURCE);
    const shuffled = await resolveAttackRunInputs(reversed(SOURCE));

    expect(shuffled.inputs).toEqual(straight.inputs);
    expect(shuffled.reach).toEqual(straight.reach);
  });

  it('should canonicalise the primary users, whatever order the read returned them in', async () => {
    const straight = await resolveAttackRunInputs(SOURCE);
    const shuffled = await resolveAttackRunInputs(reversed(SOURCE));

    expect(straight.inputs.door.phishing?.persons).toHaveLength(2);
    expect(shuffled.inputs.door.phishing).toEqual(straight.inputs.door.phishing);
  });

  it('should hand the declared susceptibility on to the run', async () => {
    expect((await resolveAttackRunInputs(SOURCE)).inputs.phishing).toEqual({ declaredSusceptibility: null });
    expect((await resolveAttackRunInputs({ ...SOURCE, phishing: { declaredSusceptibility: 0.12 } })).inputs.phishing)
      .toEqual({ declaredSusceptibility: 0.12 });
  });

  it('should keep the fixture wide enough for an order to be observable', async () => {
    const { inputs, reach } = await resolveAttackRunInputs(SOURCE);

    expect(inputs.actors.length).toBeGreaterThan(2);
    expect(inputs.controls.length).toBeGreaterThan(2);
    expect(inputs.lossDrivers.length).toBeGreaterThan(2);
    expect(inputs.plans?.length).toBeGreaterThan(1);
    expect(inputs.plans?.some((plan) => plan.moves.length > 1)).toBe(true);
    for (const actor of inputs.actors) {
      expect(actor.repertoire.length).toBeGreaterThan(1);
      expect(actor.groups.length).toBeGreaterThan(1);
    }
    expect(reach.contestedTechniqueExternalIds.size).toBeGreaterThan(0);
  });

  it('should hand each control its strength and coverage, and nothing else about its posture', async () => {
    const { inputs } = await resolveAttackRunInputs(SOURCE);

    expect(inputs.controls).toStrictEqual([
      {
        controlId: 'a-edr',
        capabilityExternalId: 'EDR',
        strengthRung: 'L3',
        coverageBucket: 'L2',
        preventTechniqueExternalIds: ['T1059', 'T1486'],
        detectTechniqueExternalIds: ['T1003', 'T1059'],
      },
      {
        controlId: 'b-backup',
        capabilityExternalId: 'BCK',
        strengthRung: 'L2',
        coverageBucket: 'L1',
        preventTechniqueExternalIds: ['T1486'],
        detectTechniqueExternalIds: [],
      },
      {
        controlId: 'c-mfa',
        capabilityExternalId: 'IDP',
        strengthRung: 'L2',
        coverageBucket: 'L2',
        preventTechniqueExternalIds: ['T1078', 'T1021'],
        detectTechniqueExternalIds: [],
      },
    ]);
  });

  it('should simulate one attacker per class, each technique carrying the share of the class holding it', async () => {
    const { inputs } = await resolveAttackRunInputs(SOURCE);

    expect(inputs.actors.map((actor) => [actor.key, actor.share])).toEqual([
      ['opportunistic_crime', 0.2],
      ['ransomware_operator', 0.5],
      ['state_sponsored', 0.3],
    ]);
    const ransomware = inputs.actors.find((actor) => actor.actorClass === 'ransomware_operator')!;
    const prevalence = new Map(ransomware.repertoire.map((technique) => [technique.externalId, technique.prevalence]));
    expect(prevalence.get('T1566')).toBeCloseTo(1, 12);
    expect(prevalence.get('T1486')).toBeCloseTo(1, 12);
    for (const [externalId, value] of prevalence) {
      const held = SOURCE.mixture
        .filter((group) => group.actorClass === 'ransomware_operator' && group.techniqueExternalIds.includes(externalId))
        .reduce((sum, group) => sum + group.share, 0);
      expect(value).toBeCloseTo(held / 0.5, 12);
    }
  });

  describe('the groups of each priced CVE', () => {
    const cveGroupsOf = (resolved: ResolvedAttackRunInputs, key: string) =>
      resolved.inputs.actors.find((actor) => actor.key === key)!.cveGroups ?? [];

    it('should give a CVE its own groups for each priced CVE its class cites, and the reference groups none', async () => {
      const resolved = await resolveAttackRunInputs(SOURCE);

      expect(cveGroupsOf(resolved, 'state_sponsored').map((entry) => entry.cveId)).toEqual(['CVE-2024-0002']);
      expect(cveGroupsOf(resolved, 'ransomware_operator').map((entry) => entry.cveId)).toEqual(['CVE-2024-0001']);
    });

    it('should give a CVE the estate as its dismissal leaves it', async () => {
      const resolved = await resolveAttackRunInputs(SOURCE);
      const ransomware = resolved.inputs.actors.find((actor) => actor.key === 'ransomware_operator')!;
      const [entry] = cveGroupsOf(resolved, 'ransomware_operator');

      expect(entry.groups.reduce((sum, group) => sum + group.assets, 0)).toBe(ransomware.groups.reduce((sum, group) => sum + group.assets, 0));
      expect(entry.groups).not.toEqual(ransomware.groups);
    });

    it('should give groups to a cited CVE the door lists but does not price, and keep it out of the floor-only list', async () => {
      const silent = SOURCE.estate.door.openings.map((row) => ({ ...row, threat: SILENT_FLAW_THREAT }));
      const resolved = await resolveAttackRunInputs({ ...SOURCE, estate: { ...SOURCE.estate, door: { ...SOURCE.estate.door, openings: silent } } });

      expect(resolved.inputs.door.cves.every((cve) => !cve.priced)).toBe(true);
      expect(cveGroupsOf(resolved, 'state_sponsored').map((entry) => entry.cveId)).toEqual(['CVE-2024-0002']);
      expect(cveGroupsOf(resolved, 'ransomware_operator').map((entry) => entry.cveId)).toEqual(['CVE-2024-0001']);
      expect(resolved.inputs.floorCves).toEqual([]);
    });

    it('should give no groups to a door CVE the door does not price when no actor cites it', async () => {
      const silent = SOURCE.estate.door.openings.map((row) => ({ ...row, threat: SILENT_FLAW_THREAT }));
      const resolved = await resolveAttackRunInputs({
        ...SOURCE,
        mixture: SOURCE.mixture.map((group) => ({ ...group, cveExternalIds: new Set<string>() })),
        estate: { ...SOURCE.estate, door: { ...SOURCE.estate.door, openings: silent } },
      });

      for (const actor of resolved.inputs.actors) {
        expect(actor.cveGroups ?? [], actor.key).toEqual([]);
      }
    });

    it('should give none when no actor cites a CVE', async () => {
      const resolved = await resolveAttackRunInputs({
        ...SOURCE,
        mixture: SOURCE.mixture.map((group) => ({ ...group, cveExternalIds: new Set<string>() })),
      });

      for (const actor of resolved.inputs.actors) {
        expect(actor.cveGroups ?? [], actor.key).toEqual([]);
      }
    });

    it('should give none when the run does not price the CVE what-ifs, and leave the reference groups as they were', async () => {
      const priced = await resolveAttackRunInputs(SOURCE);
      const unpriced = await resolveAttackRunInputs({ ...SOURCE, computesCveWhatIfs: false });

      expect(priced.inputs.actors.some((actor) => (actor.cveGroups ?? []).length > 0)).toBe(true);
      for (const actor of unpriced.inputs.actors) {
        expect(actor.cveGroups ?? [], actor.key).toEqual([]);
      }
      expect(unpriced.inputs.actors.map((actor) => actor.groups)).toEqual(priced.inputs.actors.map((actor) => actor.groups));
    });

    it('should fingerprint a run that prices the CVE what-ifs like one that does not, over the same state', async () => {
      const priced = await resolveAttackRunInputs(SOURCE);
      const unpriced = await resolveAttackRunInputs({ ...SOURCE, computesCveWhatIfs: false });

      expect(fingerprintRunInputs(fingerprintedBaseline(unpriced.inputs))).toBe(fingerprintRunInputs(fingerprintedBaseline(priced.inputs)));
    });

    it('should leave a result on a technique the control does not cover out of the inputs and the fingerprint', async () => {
      const withTested = (tested: ReadonlyArray<AttackRunTestedCell>): AttackRunInputsSource => ({
        ...SOURCE,
        controls: SOURCE.controls.map((control) => (control.controlId === 'a-edr' ? { ...control, tested } : control)),
      });
      const covered: AttackRunTestedCell = { function: 'prevent', techniqueExternalId: 'T1059', rate: 0.1, hostsTested: 10, scopeHosts: 20 };
      const uncovered: AttackRunTestedCell = { function: 'prevent', techniqueExternalId: 'T1003', rate: 0, hostsTested: 10, scopeHosts: 20 };
      const without = await resolveAttackRunInputs(withTested([covered]));
      const withUncovered = await resolveAttackRunInputs(withTested([covered, uncovered]));

      expect(withUncovered.inputs.controls.find((control) => control.controlId === 'a-edr')?.tested).toEqual([covered]);
      expect(fingerprintRunInputs(fingerprintedBaseline(withUncovered.inputs))).toBe(fingerprintRunInputs(fingerprintedBaseline(without.inputs)));
    });

    it('should fingerprint a moved reference group', async () => {
      const straight = await resolveAttackRunInputs(SOURCE);
      const moved = await resolveAttackRunInputs({
        ...SOURCE,
        estate: { ...SOURCE.estate, counts: SOURCE.estate.counts.map((row) => ({ ...row, count: row.count + 1 })) },
      });

      expect(fingerprintRunInputs(fingerprintedBaseline(moved.inputs))).not.toBe(fingerprintRunInputs(fingerprintedBaseline(straight.inputs)));
    });

    it('should resolve the same groups whatever order the reads returned', async () => {
      const straight = await resolveAttackRunInputs(SOURCE);
      const shuffled = await resolveAttackRunInputs(reversed(SOURCE));

      expect(shuffled.inputs.actors.map((actor) => actor.cveGroups)).toEqual(straight.inputs.actors.map((actor) => actor.cveGroups));
      expect(shuffled.inputs.actors.map((actor) => actor.groups)).toEqual(straight.inputs.actors.map((actor) => actor.groups));
    });
  });

  describe('the cited CVEs that open no entry at the door', () => {
    const route = (assetId: string, cveId: string, techniqueExternalId: string) => ({
      supportingAssetId: assetId,
      categoryId: 'host' as const,
      exposure: 'internal' as const,
      criticality: 'low' as const,
      matchedByScenarioGroup: false,
      cveExternalId: cveId,
      cveRowId: cveId,
      techniqueExternalId,
    });
    /* 0004 and 0000 are cited and carried, and no opening names them; 0005 is cited for a technique no member holds. */
    const CITED: AttackRunInputsSource = {
      ...SOURCE,
      mixture: SOURCE.mixture.map((group) => (group.groupKey === 'a-state'
        ? { ...group, cveExternalIds: new Set([...group.cveExternalIds, 'CVE-2024-0004', 'CVE-2024-0000', 'CVE-2024-0005']) }
        : group)),
      estate: {
        ...SOURCE.estate,
        routes: [
          ...SOURCE.estate.routes,
          route('asset-4', 'CVE-2024-0004', 'T1003'),
          route('asset-5', 'CVE-2024-0000', 'T1003'),
          route('asset-6', 'CVE-2024-0005', 'T1190'),
        ],
      },
    };

    it('should list them sorted, with the groups each actor splits by them', async () => {
      const resolved = await resolveAttackRunInputs(CITED);
      const state = resolved.inputs.actors.find((actor) => actor.key === 'state_sponsored')!;

      expect(resolved.inputs.floorCves).toEqual([{ cveId: 'CVE-2024-0000' }, { cveId: 'CVE-2024-0004' }]);
      expect((state.cveGroups ?? []).map((entry) => entry.cveId)).toEqual(['CVE-2024-0000', 'CVE-2024-0002', 'CVE-2024-0004']);
    });

    it('should list none of the CVEs of the door, nor one whose removal changes no group', async () => {
      const { inputs } = await resolveAttackRunInputs(CITED);
      const door = new Set(inputs.door.cves.map((cve) => cve.cveId));

      expect(inputs.floorCves!.some((entry) => door.has(entry.cveId))).toBe(false);
      expect(inputs.floorCves!.some((entry) => entry.cveId === 'CVE-2024-0005')).toBe(false);
    });

    it('should list none when no actor cites a CVE the door does not carry', async () => {
      expect((await resolveAttackRunInputs(SOURCE)).inputs.floorCves).toEqual([]);
    });

    it('should list none when the run does not price the CVE what-ifs', async () => {
      expect((await resolveAttackRunInputs({ ...CITED, computesCveWhatIfs: false })).inputs.floorCves).toEqual([]);
    });

    it('should list the same whatever order the reads returned', async () => {
      const straight = await resolveAttackRunInputs(CITED);
      const shuffled = await resolveAttackRunInputs(reversed(CITED));

      expect(shuffled.inputs.floorCves).toEqual(straight.inputs.floorCves);
    });

    it('should leave them out of the fingerprint', async () => {
      const priced = await resolveAttackRunInputs(CITED);
      const unpriced = await resolveAttackRunInputs({ ...CITED, computesCveWhatIfs: false });

      expect(priced.inputs.floorCves!.length).toBeGreaterThan(0);
      expect(fingerprintRunInputs(fingerprintedBaseline(unpriced.inputs))).toBe(fingerprintRunInputs(fingerprintedBaseline(priced.inputs)));
    });
  });

  describe('on a mobile estate', () => {
    const MOBILE: AttackRunInputsSource = {
      ...SOURCE,
      applicableFamiliesByTechnique: new Map([
        ['T1005', ['mobile_device']],
        ['T1675', ['mobile_device']],
      ]),
      mixture: [{ ...SOURCE.mixture[0], techniqueExternalIds: ['T1005', 'T1675'] }],
      controls: [],
      plans: [],
      estate: {
        counts: [{ categoryId: 'mobile_device', exposure: 'internal', criticality: 'medium', count: 80 }],
        scenarioGroupCounts: [],
        routes: [],
        unscannedAssetCount: 0,
        door: { counts: [], openings: [], primaryUsers: [] },
      },
    };
    const UEM_CONTROL = {
      controlId: 'a-uem',
      capabilityExternalId: 'UEM',
      strengthRung: 'L2',
      coverageBucket: 'L2',
      preventTechniqueExternalIds: ['T1005'],
      detectTechniqueExternalIds: [],
    } as const;

    it('should leave to the estate the pairs UEM can contest, and to the catalogue the ones it cannot', async () => {
      const { reach } = await resolveAttackRunInputs(MOBILE);

      expect(pairsOf(reach.uncontestableByCatalogue)).toEqual(['T1675|mobile_device']);
      expect(pairsOf(reach.uncontestedByEstate)).toEqual(['T1005|mobile_device']);
    });

    it('should take a pair UEM covers out of the estate gap once the tenant declares UEM', async () => {
      const { reach } = await resolveAttackRunInputs({ ...MOBILE, controls: [UEM_CONTROL] });

      expect(pairsOf(reach.uncontestedByEstate)).toEqual([]);
      expect([...reach.contestedTechniqueExternalIds]).toEqual(['T1005']);
      expect(pairsOf(reach.uncontestableByCatalogue)).toEqual(['T1675|mobile_device']);
    });
  });

  describe('the techniques ATT&CK 20.0 added', () => {
    const ADDED = ['T1696', 'T1697', 'T1698', 'T1699', 'T1700'];
    const ADDED_FAMILIES = new Map(ADDED.map((externalId) => [
      externalId,
      ASSET_CATEGORY_VALUES.filter((family) => APPLICABLE_TECHNIQUES[family].some((held) => held === externalId)),
    ]));
    const ADDED_SOURCE: AttackRunInputsSource = {
      ...SOURCE,
      applicableFamiliesByTechnique: ADDED_FAMILIES,
      mixture: [{ ...SOURCE.mixture[0], techniqueExternalIds: ADDED }],
      controls: [],
      plans: [],
      estate: {
        counts: [...new Set([...ADDED_FAMILIES.values()].flat())]
          .map((categoryId) => ({ categoryId, exposure: 'internal' as const, criticality: 'medium' as const, count: 10 })),
        scenarioGroupCounts: [],
        routes: [],
        unscannedAssetCount: 0,
        door: { counts: [], openings: [], primaryUsers: [] },
      },
    };

    it('should play each of them on the families the catalogue contests it on', async () => {
      const { inputs } = await resolveAttackRunInputs(ADDED_SOURCE);

      expect(inputs.actors[0].repertoire.map((technique) => [technique.externalId, technique.families])).toEqual([
        ['T1696', ['web_application']],
        ['T1697', ['identity', 'saas_application']],
        ['T1698', ['ai_target']],
        ['T1699', ['ai_target']],
        ['T1700', ['ai_target', 'host', 'saas_application']],
      ]);
    });

    it('should leave to the catalogue the pairs no capability with an edge on the technique protects', async () => {
      const { reach } = await resolveAttackRunInputs(ADDED_SOURCE);

      expect(pairsOf(reach.uncontestableByCatalogue)).toEqual([
        'T1696|saas_application',
        'T1698|host',
        'T1698|saas_application',
        'T1699|host',
        'T1699|saas_application',
      ]);
    });
  });

  describe('the door estate, one for the whole run', () => {
    const doorOf = async (override: Partial<AttackRunInputsSource> = {}) =>
      (await resolveAttackRunInputs({ ...SOURCE, ...override })).inputs.door;
    const applicableOf = (door: Awaited<ReturnType<typeof doorOf>>, technique: string, family: AssetCategory): number =>
      door.applicable[door.techniques.indexOf(technique)][door.families.indexOf(family)];

    it('should play the parents of the initial access techniques some attacker holds, and nothing else', async () => {
      const door = await doorOf();

      expect(door.techniques).toEqual(['T1078', 'T1190', 'T1566']);
    });

    it('should count each family the assets the technique applies to under the tenant setting, the technique families table crossed', async () => {
      const door = await doorOf();

      expect(door.families).toEqual(['host', 'identity']);
      expect(door.applicable.every((row) => row.length === door.families.length)).toBe(true);
      // T1190: exposed hosts only. The web application is exposed too but the table does not list the family.
      expect(applicableOf(door, 'T1190', 'host')).toBe(12);
      expect(applicableOf(door, 'T1190', 'identity')).toBe(0);
      // T1566 is read from the people, not from the assets: it applies to none of them, and the enabled user accounts are the people.
      expect(applicableOf(door, 'T1566', 'host')).toBe(0);
      expect(applicableOf(door, 'T1566', 'identity')).toBe(0);
      expect(door.phishing).toMatchObject({ personFamily: door.families.indexOf('identity'), people: 45 });
    });

    it('should leave a disabled identity out of valid accounts, and a host out of it although the table lists the family', async () => {
      const door = await doorOf();

      expect(applicableOf(door, 'T1078', 'identity')).toBe(45 + 6);
      expect(applicableOf(door, 'T1078', 'host')).toBe(0);
    });

    it('should open T1190 on the assets of unknown exposure when the tenant counts them as internet-facing', async () => {
      const internal = await doorOf({ unknownExposureCountsAs: 'internal' });
      const exposed = await doorOf({ unknownExposureCountsAs: 'internet_facing' });

      expect(applicableOf(internal, 'T1190', 'host')).toBe(12);
      expect(applicableOf(exposed, 'T1190', 'host')).toBe(12 + 5);
      expect(applicableOf(exposed, 'T1566', 'host')).toBe(applicableOf(internal, 'T1566', 'host'));
    });

    it('should fold the openings to the parent technique, keeping the strongest per asset and CVE', async () => {
      const door = await doorOf();
      const asset = (index: number) => door.assets[index].openings
        .map((entry) => [door.cves[entry.cve].cveId, door.techniques[entry.technique], entry.opening]);

      expect(door.assets).toHaveLength(2);
      expect(door.assets.map((entry) => door.families[entry.family])).toEqual(['host', 'host']);
      expect(asset(0)).toEqual([['CVE-2024-0001', 'T1190', 0.5]]);
      expect(asset(1)).toEqual([['CVE-2024-0001', 'T1190', 1]]);
    });

    it('should file the phishing openings of a device, folded to the parent, under each primary user of it', async () => {
      const door = await doorOf();
      const technique = door.techniques.indexOf('T1566');
      const cve = (cveId: string) => door.cves.findIndex((entry) => entry.cveId === cveId);

      const host = door.families.indexOf('host');
      const flawed = {
        family: host,
        openings: [
          { cve: cve('CVE-2024-0001'), technique, opening: 0.7 },
          { cve: cve('CVE-2024-0002'), technique, opening: 0.2 },
        ],
      };
      // user-a is also the primary user of asset-a, which carries no phishing flaw.
      expect(door.phishing?.persons).toEqual([
        { target: true, devices: [{ family: host, openings: [] }, flawed] },
        { target: false, devices: [flawed] },
      ]);
    });

    describe('an opening reread under the setting the run holds', () => {
      const withOpenings = (unknownExposureCountsAs: AttackRunInputsSource['unknownExposureCountsAs']) => doorOf({
        unknownExposureCountsAs,
        estate: {
          ...SOURCE.estate,
          door: {
            counts: DOOR_COUNTS,
            primaryUsers: [],
            openings: [
              opening('unknown-asset', 'CVE-2024-0001', 'T1190', 0.5, 0.9, 'host', 'unknown'),
              opening('internal-asset', 'CVE-2024-0002', 'T1190', 0.5, 0.9, 'host', 'internal'),
            ],
          },
        },
      });

      it('should drop the T1190 opening of an unknown exposure asset under internal and keep it under internet-facing', async () => {
        const internal = await withOpenings('internal');
        const exposed = await withOpenings('internet_facing');

        expect(internal.assets).toEqual([]);
        expect(exposed.assets).toHaveLength(1);
        expect(exposed.cves.map((entry) => entry.cveId)).toEqual(['CVE-2024-0001']);
      });

      it('should drop the T1190 opening of an internal asset whatever the setting', async () => {
        for (const setting of ['internal', 'internet_facing'] as const) {
          const door = await withOpenings(setting);

          expect(door.cves.map((entry) => entry.cveId)).not.toContain('CVE-2024-0002');
        }
      });
    });

    it('should drop the opening of an asset whose family the technique families table does not carry', async () => {
      const door = await doorOf({
        estate: {
          ...SOURCE.estate,
          door: {
            counts: DOOR_COUNTS,
            primaryUsers: [],
            openings: [
              opening('host-asset', 'CVE-2024-0001', 'T1190', 0.5, 0.9, 'host', 'internet_facing'),
              opening('web-asset', 'CVE-2024-0002', 'T1190', 0.5, 0.9, 'web_application', 'internet_facing'),
            ],
          },
        },
      });

      expect(door.families).toEqual(['host', 'identity']);
      expect(door.assets).toHaveLength(1);
      expect(door.cves.map((entry) => entry.cveId)).toEqual(['CVE-2024-0001']);
    });

    it('should list the CVEs the retained openings name, with their threat', async () => {
      const door = await doorOf();

      expect(door.cves).toEqual([
        { cveId: 'CVE-2024-0001', threat: 0.95, priced: true },
        { cveId: 'CVE-2024-0002', threat: 0.3, priced: true },
      ]);
    });

    it('should price a CVE only when its threat is above the threat of a silent flaw', async () => {
      const door = await doorOf({
        estate: {
          ...SOURCE.estate,
          door: {
            counts: DOOR_COUNTS,
            primaryUsers: [],
            openings: [
              opening('asset-a', 'CVE-2024-0001', 'T1190', 0.5, SILENT_FLAW_THREAT),
              opening('asset-a', 'CVE-2024-0002', 'T1190', 0.5, SILENT_FLAW_THREAT + 1e-9),
              opening('asset-b', 'CVE-2024-0003', 'T1190', 0.5, 0.01),
              opening('asset-b', 'CVE-2024-0004', 'T1190', 0.5, 0.9),
            ],
          },
        },
      });

      expect(door.cves.map((entry) => [entry.cveId, entry.priced])).toEqual([
        ['CVE-2024-0001', false],
        ['CVE-2024-0002', true],
        ['CVE-2024-0003', false],
        ['CVE-2024-0004', true],
      ]);
    });

    it('should price a CVE whose strongest opening is above silence although another one is silent', async () => {
      const door = await doorOf({
        estate: {
          ...SOURCE.estate,
          door: {
            counts: DOOR_COUNTS,
            primaryUsers: [],
            openings: [
              opening('asset-a', 'CVE-2024-0001', 'T1190', 0.5, SILENT_FLAW_THREAT),
              opening('asset-b', 'CVE-2024-0001', 'T1190', 0.5, 0.4),
            ],
          },
        },
      });

      expect(door.cves).toEqual([{ cveId: 'CVE-2024-0001', threat: 0.4, priced: true }]);
    });

    it('should take the highest threat when the openings of one CVE disagree on it', async () => {
      const door = await doorOf({
        estate: {
          ...SOURCE.estate,
          door: {
            counts: DOOR_COUNTS,
            primaryUsers: [],
            openings: [opening('asset-a', 'CVE-2024-0001', 'T1190', 0.5, 0.2), opening('asset-b', 'CVE-2024-0001', 'T1190', 0.5, 0.6)],
          },
        },
      });

      expect(door.cves).toEqual([{ cveId: 'CVE-2024-0001', threat: 0.6, priced: true }]);
    });

    it('should build the same door whether or not an actor cites a CVE, since the citation only feeds the later obstacles', async () => {
      const cited = await doorOf();
      const uncited = await doorOf({
        mixture: SOURCE.mixture.map((group) => ({ ...group, cveExternalIds: new Set<string>() })),
        estate: { ...SOURCE.estate, routes: [] },
      });

      expect(uncited).toEqual(cited);
    });

    it('should hold a door with no opening when the estate carries no finding', async () => {
      const door = await doorOf({ estate: { ...SOURCE.estate, door: { counts: DOOR_COUNTS, openings: [], primaryUsers: [] } } });

      expect(door.assets).toEqual([]);
      expect(door.cves).toEqual([]);
      expect(applicableOf(door, 'T1190', 'host')).toBe(12);
    });

    it('should leave the door empty when no attacker plays an initial access technique', async () => {
      const door = await doorOf({
        mixture: SOURCE.mixture.map((group) => ({
          ...group,
          techniqueExternalIds: group.techniqueExternalIds.filter((id) => !['T1566', 'T1190', 'T1078'].includes(id)),
        })),
      });

      expect(door.techniques).toEqual([]);
      expect(door.assets).toEqual([]);
    });
  });
});

describe('the declared estate', () => {
  const withDeclared = (declared: NonNullable<AttackRunInputsSource['estate']['declared']>): AttackRunInputsSource =>
    ({ ...SOURCE, estate: { ...SOURCE.estate, declared } });

  // The reach report enters the run's digest key by key, so even an undefined key would reprice every scenario once.
  it('should report nothing declared for a scope that declared nothing', async () => {
    expect((await resolveAttackRunInputs(SOURCE)).reach).not.toHaveProperty('declared');
  });

  it('should resolve a declaration the measured estate already meets as the measured estate, reporting zero added', async () => {
    const plain = await resolveAttackRunInputs(SOURCE);
    const met = await resolveAttackRunInputs(withDeclared({ counts: [], doorCounts: [], kinds: [] }));

    expect(met.inputs).toEqual(plain.inputs);
    expect(met.reach.declared).toEqual({ assetCount: 0, assetShare: 0 });
  });

  it('should add the virtual assets to the groups and the door, keeping the estate count to the real assets', async () => {
    const plain = await resolveAttackRunInputs(SOURCE);
    const completed = await resolveAttackRunInputs(withDeclared({
      counts: [{ categoryId: 'identity', exposure: 'internal', criticality: 'unknown', count: 55 }],
      doorCounts: [{ categoryId: 'identity', subcategoryId: 'user_account', exposure: 'internal', identityEnabled: true, target: false, count: 55 }],
      kinds: [],
    }));

    expect(completed.reach.estateAssetCount).toBe(plain.reach.estateAssetCount);
    expect(completed.reach.declared).toEqual({ assetCount: 55, assetShare: 55 / (plain.reach.estateAssetCount + 55) });
    expect(completed.inputs.door.phishing?.people).toBe((plain.inputs.door.phishing?.people ?? 0) + 55);
    const assetsOf = (resolved: ResolvedAttackRunInputs) => resolved.inputs.actors[0].groups
      .filter((group) => group.family === 'identity')
      .reduce((sum, group) => sum + group.assets, 0);
    expect(assetsOf(completed)).toBe(assetsOf(plain) + 55);
  });

  it('should count no virtual asset of a family the scenario walks no technique on, and still hand it to the door', async () => {
    const completed = await resolveAttackRunInputs(withDeclared({
      counts: [{ categoryId: 'saas_application', exposure: 'internal', criticality: 'unknown', count: 9 }],
      doorCounts: [{ categoryId: 'saas_application', subcategoryId: null, exposure: 'internal', identityEnabled: true, target: false, count: 9 }],
      kinds: [],
    }));

    expect(completed.reach.declared?.assetCount).toBe(0);
    expect(completed.inputs.actors.every((actor) => actor.groups.every((group) => group.family !== 'saas_application'))).toBe(true);
  });
});

describe('the path around initial access', () => {
  const FLOOD = { key: 'outside_perimeter', share: 1, techniqueExternalIds: ['T1499', 'T1498'] };
  const FLOOD_IDS = ['T1498', 'T1499'];
  const WITH_FLOOD: AttackRunInputsSource = {
    ...SOURCE,
    applicableFamiliesByTechnique: new Map([...SOURCE.applicableFamiliesByTechnique, ['T1498', ['host']], ['T1499', ['host']]]),
    mixture: SOURCE.mixture.map((group) => (group.groupKey === 'c-crowd'
      ? { ...group, techniqueExternalIds: [...group.techniqueExternalIds, 'T1498'] }
      : group)),
    withoutInitialAccess: FLOOD,
  };
  const without = (source: AttackRunInputsSource): AttackRunInputsSource => ({ ...source, withoutInitialAccess: undefined });

  const lawOf = (resolved: ResolvedAttackRunInputs, key: string): CompiledAttackRunLaw => {
    const actor = resolved.inputs.actors.find((candidate) => candidate.key === key)!;
    return compileAttackRunLaw({
      terminalTacticExternalId: resolved.inputs.terminalTacticExternalId,
      actorClass: actor.knobs,
      repertoire: actor.repertoire,
      groups: actor.groups,
      controls: resolved.inputs.controls,
      constants: resolved.inputs.constants,
      door: resolved.inputs.door,
      withoutInitialAccess: resolved.inputs.withoutInitialAccess,
      unknownExposureCountsAs: resolved.inputs.unknownExposureCountsAs,
      unknownCriticalityCountsAs: resolved.inputs.unknownCriticalityCountsAs,
    });
  };
  /** The long chain as the techniques it plays, so a repertoire index shifting under an inserted technique is no difference. */
  const longChainOf = (compiled: CompiledAttackRunLaw) => ({
    obstacles: compiled.obstacles.map((obstacle) => ({
      key: obstacle.key,
      techniques: obstacle.techniques.map((index) => compiled.inputs.repertoire[index].externalId),
      groups: obstacle.groups.map((entry) => ({ groupIndex: entry.groupIndex, choice: entry.choice, weightShare: entry.weightShare })),
      unplayable: obstacle.unplayable,
    })),
    door: compiled.door.layers.map((layer) => ({ repertoire: [...layer.repertoire].map((index) => (index < 0 ? null : compiled.inputs.repertoire[index].externalId)), choice: [...layer.choice] })),
  });

  it('should add nothing and pass nothing when the scenario has no such path', async () => {
    const { inputs } = await resolveAttackRunInputs(without(WITH_FLOOD));

    expect(inputs.withoutInitialAccess).toBeUndefined();
    expect(inputs.actors.flatMap((actor) => actor.repertoire.map((technique) => technique.externalId))).not.toContain('T1499');
    expect(inputs.actors.flatMap((actor) => actor.repertoire).every((technique) => technique.pathFamilies === undefined)).toBe(true);
  });

  it('should drop a path technique the source gives no family for, and play no path when none has one', async () => {
    const families = (ids: ReadonlyArray<string>) => new Map([...WITH_FLOOD.applicableFamiliesByTechnique].filter(([externalId]) => !ids.includes(externalId)));

    const partial = await resolveAttackRunInputs({ ...WITH_FLOOD, applicableFamiliesByTechnique: families(['T1498']) });
    const bare = await resolveAttackRunInputs({ ...WITH_FLOOD, applicableFamiliesByTechnique: families(FLOOD_IDS) });

    const heldBy = (resolved: ResolvedAttackRunInputs) => resolved.inputs.actors.flatMap((actor) => actor.repertoire
      .filter((technique) => technique.pathFamilies !== undefined)
      .map((technique) => technique.externalId));
    expect(new Set(heldBy(partial))).toEqual(new Set(['T1499']));
    expect(heldBy(bare)).toEqual([]);
    for (const actor of bare.inputs.actors) {
      expect(lawOf(bare, actor.key).chains.withoutInitialAccess?.obstacle.unplayable ?? true).toBe(true);
    }
  });

  it('should hand the unknown exposure setting on, which the path reads and the run fingerprints', async () => {
    for (const setting of ['internal', 'internet_facing'] as const) {
      const { inputs } = await resolveAttackRunInputs({ ...WITH_FLOOD, unknownExposureCountsAs: setting });
      expect(inputs.unknownExposureCountsAs).toBe(setting);
    }
  });

  it('should hand the unknown criticality setting on, which the law reads and the run fingerprints', async () => {
    for (const setting of DECLARED_CRITICALITY_VALUES) {
      const { inputs } = await resolveAttackRunInputs({ ...WITH_FLOOD, unknownCriticalityCountsAs: setting });
      expect(inputs.unknownCriticalityCountsAs).toBe(setting);
    }
    const low = await resolveAttackRunInputs({ ...WITH_FLOOD, unknownCriticalityCountsAs: 'low' });
    const veryHigh = await resolveAttackRunInputs({ ...WITH_FLOOD, unknownCriticalityCountsAs: 'very_high' });
    expect(fingerprintRunInputs(fingerprintedBaseline(veryHigh.inputs))).not.toBe(fingerprintRunInputs(fingerprintedBaseline(low.inputs)));
  });

  it('should hand the path on with its key, its techniques sorted', async () => {
    const { inputs } = await resolveAttackRunInputs(WITH_FLOOD);

    expect(inputs.withoutInitialAccess).toEqual({ key: 'outside_perimeter', share: 1, techniqueExternalIds: FLOOD_IDS });
  });

  it('should hold the path techniques of every class, at the share of the class holding them', async () => {
    const { inputs } = await resolveAttackRunInputs(WITH_FLOOD);

    const prevalenceOf = (key: string) => new Map(inputs.actors.find((actor) => actor.key === key)!.repertoire
      .filter((technique) => FLOOD_IDS.includes(technique.externalId))
      .map((technique) => [technique.externalId, technique.prevalence]));
    expect(prevalenceOf('opportunistic_crime')).toEqual(new Map([['T1498', 1], ['T1499', 0]]));
    expect(prevalenceOf('ransomware_operator')).toEqual(new Map([['T1498', 0], ['T1499', 0]]));
    expect(prevalenceOf('state_sponsored')).toEqual(new Map([['T1498', 0], ['T1499', 0]]));
  });

  it('should keep the repertoire in the order of its ids whatever order the reads returned', async () => {
    const straight = await resolveAttackRunInputs(WITH_FLOOD);
    const shuffled = await resolveAttackRunInputs({ ...reversed(WITH_FLOOD), withoutInitialAccess: { ...FLOOD, techniqueExternalIds: FLOOD_IDS } });

    expect(shuffled.inputs).toEqual(straight.inputs);
    expect(shuffled.reach).toEqual(straight.reach);
  });

  it('should leave the reach report outside the path, the groups and the rest of every repertoire as they were', async () => {
    const before = await resolveAttackRunInputs(without(WITH_FLOOD));
    const after = await resolveAttackRunInputs(WITH_FLOOD);

    const outsidePath = ({ reach }: ResolvedAttackRunInputs) => ({
      ...reach,
      uncontestedByEstate: reach.uncontestedByEstate.filter((pair) => !FLOOD_IDS.includes(pair.techniqueExternalId)),
    });
    expect(outsidePath(after)).toEqual(outsidePath(before));
    expect(after.inputs.door).toEqual(before.inputs.door);
    for (const actor of after.inputs.actors) {
      const earlier = before.inputs.actors.find((candidate) => candidate.key === actor.key)!;
      expect(actor.groups).toEqual(earlier.groups);
      expect(actor.share).toBe(earlier.share);
      const others = actor.repertoire.filter((technique) => !FLOOD_IDS.includes(technique.externalId));
      expect(others).toEqual(earlier.repertoire.filter((technique) => !FLOOD_IDS.includes(technique.externalId)));
    }
  });

  it('should report a path technique no class holds as contested or uncontested like any other', async () => {
    const ddos = {
      controlId: 'd-ddos',
      capabilityExternalId: 'DDOS',
      strengthRung: 'L2',
      coverageBucket: 'L2',
      preventTechniqueExternalIds: ['T1499'],
      detectTechniqueExternalIds: [],
    } as const;

    const bare = await resolveAttackRunInputs(WITH_FLOOD);
    const covered = await resolveAttackRunInputs({ ...WITH_FLOOD, controls: [...WITH_FLOOD.controls, ddos] });

    const uncontested = ({ reach }: ResolvedAttackRunInputs) => reach.uncontestedByEstate
      .filter((pair) => pair.techniqueExternalId === 'T1499')
      .map((pair) => pair.family);
    expect(uncontested(bare)).toEqual(['host']);
    expect(bare.reach.contestedTechniqueExternalIds.has('T1499')).toBe(false);
    expect(uncontested(covered)).toEqual([]);
    expect(covered.reach.contestedTechniqueExternalIds.has('T1499')).toBe(true);
  });

  it('should leave the long chain of every class exactly as it compiled without the path', async () => {
    const before = await resolveAttackRunInputs(without(WITH_FLOOD));
    const after = await resolveAttackRunInputs(WITH_FLOOD);

    for (const actor of after.inputs.actors) {
      expect(longChainOf(lawOf(after, actor.key))).toEqual(longChainOf(lawOf(before, actor.key)));
    }
  });

  it('should compile the path on the class that holds one technique and on the one that holds none', async () => {
    const resolved = await resolveAttackRunInputs(WITH_FLOOD);
    const choicesOf = (key: string) => lawOf(resolved, key).chains.withoutInitialAccess!.obstacle.groups.map((entry) => entry.choice);

    expect(new Set(choicesOf('opportunistic_crime').map((choice) => choice.join()))).toEqual(new Set(['1']));
    expect(new Set(choicesOf('ransomware_operator').map((choice) => choice.join()))).toEqual(new Set(['0.5,0.5']));
  });

  describe('on an estate the catalogue cannot contest the path on', () => {
    const MOBILE_FLOOD: AttackRunInputsSource = {
      ...SOURCE,
      applicableFamiliesByTechnique: new Map([
        ['T1068', ['mobile_device']],
        ['T1498', ['generic_asset']],
        ['T1499', ['generic_asset']],
      ]),
      mixture: [{ ...SOURCE.mixture[0], techniqueExternalIds: ['T1068', 'T1498'] }],
      controls: [],
      plans: [],
      estate: {
        counts: [
          { categoryId: 'mobile_device', exposure: 'internet_facing', criticality: 'medium', count: 80 },
          { categoryId: 'generic_asset', exposure: 'internet_facing', criticality: 'medium', count: 12 },
        ],
        scenarioGroupCounts: [],
        routes: [],
        unscannedAssetCount: 0,
        door: { counts: [], openings: [], primaryUsers: [] },
      },
      withoutInitialAccess: FLOOD,
    };

    it('should still play the path there, whether the class holds the technique or not', async () => {
      const held = await resolveAttackRunInputs(MOBILE_FLOOD);
      const none = await resolveAttackRunInputs({ ...MOBILE_FLOOD, mixture: [{ ...MOBILE_FLOOD.mixture[0], techniqueExternalIds: ['T1068'] }] });

      for (const resolved of [held, none]) {
        const { obstacle } = lawOf(resolved, 'ransomware_operator').chains.withoutInitialAccess!;
        expect(obstacle.unplayable).toBe(false);
      }
      const flood = held.inputs.actors[0].repertoire.find((technique) => technique.externalId === 'T1498')!;
      expect(flood).toMatchObject({ prevalence: 1, families: [], pathFamilies: ['generic_asset'] });
    });

    it('should report the gap of the techniques the class holds and none of the others', async () => {
      const { reach } = await resolveAttackRunInputs(MOBILE_FLOOD);

      expect(reach.uncontestableByCatalogue.map((pair) => `${pair.techniqueExternalId}|${pair.family}`)).toEqual(['T1498|generic_asset']);
    });
  });
});
