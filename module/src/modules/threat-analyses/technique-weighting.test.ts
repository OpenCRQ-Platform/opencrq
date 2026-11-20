import { describe, expect, it } from 'vitest';
import type { ActivityAnchor } from './activity-scoring';
import type { AttackerMixture, MixtureGroupInput, TechniqueLink } from './technique-weighting';
import {
  computeAttackerMixture,
  computeScenarioTechniqueWeights,
  DEFAULT_ACT_HALF_LIFE_AUTHORED_DAYS,
  DEFAULT_ACT_HALF_LIFE_OBSERVED_DAYS,
  foldToParentTechnique,
  NULL_ANCHOR_RHO,
} from './technique-weighting';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const MS_PER_DAY = 86_400_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * MS_PER_DAY);

const authoredAnchor = (days: number): ActivityAnchor => ({ date: daysAgo(days), provenance: 'authored' });
const observedAnchor = (days: number): ActivityAnchor => ({ date: daysAgo(days), provenance: 'observed' });
const NO_ANCHOR: ActivityAnchor = { date: null, provenance: 'none' };

const group = (groupKey: string, overrides: Partial<MixtureGroupInput> = {}): MixtureGroupInput => ({
  groupKey,
  name: groupKey,
  entityType: 'intrusion-set',
  aliases: [],
  mitreGroupId: null,
  stixId: `intrusion-set--${groupKey}`,
  anchor: authoredAnchor(30),
  countryMatch: false,
  sectorMatch: false,
  weight: 1,
  techniqueExternalIds: [],
  ...overrides,
});

const linksOf = (groups: Array<MixtureGroupInput>): Array<TechniqueLink> =>
  groups.flatMap((entry) => entry.techniqueExternalIds.map((mitreExternalId) => ({ groupKey: entry.groupKey, mitreExternalId })));

const weightOf = (weights: ReturnType<typeof computeScenarioTechniqueWeights>, mitreExternalId: string): number =>
  weights.find((entry) => entry.mitreExternalId === mitreExternalId)?.weight ?? 0;

const SCENARIO_GROUPS: Array<MixtureGroupInput> = [
  group('salt-typhoon', {
    name: 'Salt Typhoon',
    aliases: ['Earth Estries'],
    mitreGroupId: 'G1045',
    anchor: observedAnchor(20),
    countryMatch: true,
    sectorMatch: true,
    techniqueExternalIds: ['T1566.001', 'T1059', 'T1027'],
  }),
  group('lockbit', {
    name: 'LockBit',
    anchor: authoredAnchor(200),
    sectorMatch: true,
    techniqueExternalIds: ['T1059', 'T1486'],
  }),
  group('dormant-crew', {
    name: 'Dormant Crew',
    anchor: authoredAnchor(1200),
    techniqueExternalIds: ['T1027'],
  }),
];

describe('foldToParentTechnique', () => {
  it('should fold a sub-technique to its parent and leave a parent untouched', () => {
    expect(foldToParentTechnique('T1003.001')).toBe('T1003');
    expect(foldToParentTechnique(' T1003 ')).toBe('T1003');
  });

  it('should uppercase a lowercase identifier so both spellings fold to one technique', () => {
    expect(foldToParentTechnique('t1059')).toBe('T1059');
    expect(foldToParentTechnique('t1059.001')).toBe('T1059');
  });

  it('should fold an empty or blank identifier to an empty string', () => {
    expect(foldToParentTechnique('')).toBe('');
    expect(foldToParentTechnique('   ')).toBe('');
  });
});

describe('computeAttackerMixture', () => {
  it('should type a cluster by the member that names it', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('campaign-wave', { entityType: 'campaign', aliases: ['Shared'] }),
        group('group-g', { entityType: 'intrusion-set', aliases: ['Shared'], mitreGroupId: 'G0001' }),
        group('actor-a', { entityType: 'threat-actor' }),
      ],
      now: NOW,
    });

    expect(mixture.groups.map((entry) => [entry.name, entry.entityType])).toEqual([
      ['actor-a', 'threat-actor'],
      ['group-g', 'intrusion-set'],
    ]);
  });

  it('should make the group shares sum to exactly 1', () => {
    const mixture = computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW });
    expect(mixture.groups.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 12);
    expect(mixture.groups.every((entry) => entry.share > 0)).toBe(true);
  });

  it('should give an empty mixture when no group is admitted', () => {
    const mixture = computeAttackerMixture({ groups: [], now: NOW });
    expect(mixture.groups).toEqual([]);
    expect(mixture.denominator).toBe(0);
  });

  it('should decay an observed anchor twice as fast as an authored one', () => {
    const observed = computeAttackerMixture({
      groups: [group('g', { anchor: observedAnchor(DEFAULT_ACT_HALF_LIFE_OBSERVED_DAYS) })],
      now: NOW,
    });
    const authored = computeAttackerMixture({
      groups: [group('g', { anchor: authoredAnchor(DEFAULT_ACT_HALF_LIFE_AUTHORED_DAYS) })],
      now: NOW,
    });
    expect(observed.groups[0].rho).toBeCloseTo(0.5, 12);
    expect(authored.groups[0].rho).toBeCloseTo(0.5, 12);
    expect(computeAttackerMixture({
      groups: [group('g', { anchor: authoredAnchor(DEFAULT_ACT_HALF_LIFE_OBSERVED_DAYS) })],
      now: NOW,
    }).groups[0].rho).toBeCloseTo(2 ** (-180 / 365), 12);
  });

  it('should apply the null-anchor activity to a group with no temporal signal', () => {
    const noDate = computeAttackerMixture({ groups: [group('g', { anchor: NO_ANCHOR })], now: NOW });
    expect(noDate.groups[0].rho).toBe(NULL_ANCHOR_RHO);
    expect(noDate.groups[0].lastActivityAt).toBeNull();
    expect(noDate.groups[0].anchorProvenance).toBe('none');
  });

  it('should halve activity at a custom half-life for each anchor grade', () => {
    const observed = computeAttackerMixture({
      groups: [group('g', { anchor: observedAnchor(90) })],
      now: NOW,
      halfLifeObservedDays: 90,
    });
    const authored = computeAttackerMixture({
      groups: [group('g', { anchor: authoredAnchor(90) })],
      now: NOW,
      halfLifeAuthoredDays: 90,
    });
    expect(observed.groups[0].rho).toBe(0.5);
    expect(authored.groups[0].rho).toBe(0.5);

    // The grade selects the half-life: the authored knob must leave an observed anchor alone.
    const crossed = computeAttackerMixture({
      groups: [group('g', { anchor: observedAnchor(90) })],
      now: NOW,
      halfLifeAuthoredDays: 90,
    });
    expect(crossed.groups[0].rho).toBeCloseTo(2 ** (-90 / DEFAULT_ACT_HALF_LIFE_OBSERVED_DAYS), 12);
  });

  it('should never let activity exceed a fresh anchor', () => {
    const future = computeAttackerMixture({ groups: [group('g', { anchor: authoredAnchor(-30) })], now: NOW });
    expect(future.groups[0].rho).toBe(1);
  });

  it('should multiply targeting by 2.5 on a country match, 4 on a sector match and 10 on both', () => {
    const taus = [
      { countryMatch: false, sectorMatch: false },
      { countryMatch: true, sectorMatch: false },
      { countryMatch: false, sectorMatch: true },
      { countryMatch: true, sectorMatch: true },
    ].map((targeting) => computeAttackerMixture({ groups: [group('g', targeting)], now: NOW }).groups[0].tau);
    // Exact, not approximate: the persisted explainability payload must read 1, 2.5, 4 and 10.
    expect(taus).toEqual([1, 2.5, 4, 10]);
  });

  it('should make the denominator the plain sum of the cluster thetas', () => {
    const mixture = computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW });
    expect(mixture.denominator).toBeCloseTo(mixture.groups.reduce((total, entry) => total + entry.theta, 0), 12);
    mixture.groups.forEach((entry) => expect(entry.share).toBeCloseTo(entry.theta / mixture.denominator, 12));
  });

  it('should reject a half-life outside its domain', () => {
    expect(() => computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW, halfLifeObservedDays: 0 })).toThrow(/halfLifeObservedDays/);
    expect(() => computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW, halfLifeObservedDays: Number.NaN })).toThrow(/halfLifeObservedDays/);
    expect(() => computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW, halfLifeAuthoredDays: -365 })).toThrow(/halfLifeAuthoredDays/);
    expect(() => computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW, halfLifeAuthoredDays: Number.POSITIVE_INFINITY })).toThrow(/halfLifeAuthoredDays/);
  });

  it('should reject an invalid now rather than silently return an all-zero mixture', () => {
    expect(() => computeAttackerMixture({ groups: SCENARIO_GROUPS, now: new Date('not-a-date') })).toThrow(/out of domain/);
  });

  it('should reject duplicate group keys', () => {
    expect(() => computeAttackerMixture({
      groups: [group('a', { name: 'Alpha' }), group('a', { name: 'Beta' })],
      now: NOW,
    })).toThrow(/duplicate group keys/);
  });

  it('should keep the clusters at a zero share rather than emit NaN when every theta underflows', () => {
    const mixture = computeAttackerMixture({
      groups: [group('ancient', { anchor: authoredAnchor(500_000) })],
      now: NOW,
    });
    expect(mixture.denominator).toBe(0);
    expect(mixture.groups).toHaveLength(1);
    expect(mixture.groups[0].share).toBe(0);
  });

  it('should split the shares by weight between two groups of the same rho and tau', () => {
    const mixture = computeAttackerMixture({
      groups: [group('heavy', { weight: 0.64 }), group('light', { weight: 0.16 })],
      now: NOW,
    });
    expect(mixture.groups.find((entry) => entry.groupKey === 'heavy')?.share).toBeCloseTo(0.8, 12);
    expect(mixture.groups.find((entry) => entry.groupKey === 'light')?.share).toBeCloseTo(0.2, 12);
  });

  it('should fold the weight into theta as rho x tau x weight', () => {
    const [entry] = computeAttackerMixture({
      groups: [group('g', { weight: 0.5, countryMatch: true, anchor: authoredAnchor(365) })],
      now: NOW,
    }).groups;
    expect(entry.rho).toBeCloseTo(0.5, 12);
    expect(entry.tau).toBe(2.5);
    expect(entry.theta).toBeCloseTo(0.5 * 2.5 * 0.5, 12);
  });

  it('should give a group of weight 0 a zero share', () => {
    const mixture = computeAttackerMixture({
      groups: [group('absent', { weight: 0 }), group('present', { weight: 0.5 })],
      now: NOW,
    });
    expect(mixture.groups.find((entry) => entry.groupKey === 'absent')?.share).toBe(0);
    expect(mixture.groups.find((entry) => entry.groupKey === 'present')?.share).toBeCloseTo(1, 12);
  });

  it('should return zero shares rather than NaN when every weight is 0', () => {
    const mixture = computeAttackerMixture({
      groups: [group('a', { weight: 0 }), group('b', { weight: 0 })],
      now: NOW,
    });
    expect(mixture.denominator).toBe(0);
    expect(mixture.groups.map((entry) => entry.share)).toEqual([0, 0]);
  });

  it('should pick the cluster representative on the theta that includes the weight', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('a-targeted-light', { name: 'Alpha', aliases: ['Alpha Two'], countryMatch: true, sectorMatch: true, weight: 0.05 }),
        group('b-plain-heavy', { name: 'Alpha Two', weight: 1 }),
      ],
      now: NOW,
    });
    expect(mixture.groups).toHaveLength(1);
    // Without the weight the targeted member (tau 10) would win; with it, 10 x 0.05 < 1 x 1.
    expect(mixture.groups[0].groupKey).toBe('b-plain-heavy');
    expect(mixture.groups[0].tau).toBe(1);
  });

  it('should keep the shares summing to 1 however stale every group is', () => {
    const stale = computeAttackerMixture({ groups: SCENARIO_GROUPS, now: new Date(NOW.getTime() + 730 * MS_PER_DAY) });
    expect(stale.groups.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 12);
  });

  it('should be deterministic for a fixed now', () => {
    expect(computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW }))
      .toEqual(computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW }));
  });

  // The run fingerprint hashes the shares: a reordered read must not reprice an unchanged scenario.
  it('should give the same mixture whatever order the groups come in', () => {
    const permutations = <T>(items: Array<T>): Array<Array<T>> => (items.length <= 1
      ? [items]
      : items.flatMap((item, index) =>
        permutations(items.toSpliced(index, 1)).map((rest) => [item, ...rest])));
    const tiedAlias = group('earth-estries', {
      name: 'Earth Estries',
      aliases: ['Salt Typhoon'],
      anchor: observedAnchor(20),
      countryMatch: true,
      sectorMatch: true,
    });
    const mixtures = permutations([...SCENARIO_GROUPS, tiedAlias])
      .map((groups) => computeAttackerMixture({ groups, now: NOW }));
    mixtures.forEach((mixture) => expect(mixture).toStrictEqual(mixtures[0]));
    // Equal thetas: the lowest key represents the cluster.
    expect(mixtures[0].groups.find((entry) => entry.memberGroupKeys.includes('salt-typhoon'))?.groupKey)
      .toBe('earth-estries');
  });
});

describe('computeAttackerMixture clustering', () => {
  const clusterKeys = (groups: Array<MixtureGroupInput>): Array<Array<string>> =>
    computeAttackerMixture({ groups, now: NOW }).groups.map((entry) => entry.memberGroupKeys);

  it('should merge groups sharing a normalized name or alias', () => {
    expect(clusterKeys([
      group('a', { name: 'APT 41' }),
      group('b', { name: 'Winnti', aliases: ['apt-41'] }),
      group('c', { name: 'LockBit' }),
    ])).toEqual([['a', 'b'], ['c']]);
  });

  it('should merge groups sharing a MITRE group id', () => {
    expect(clusterKeys([
      group('a', { name: 'Salt Typhoon', mitreGroupId: 'G1045' }),
      group('b', { name: 'FamousSparrow', mitreGroupId: 'G1045' }),
    ])).toEqual([['a', 'b']]);
  });

  it('should merge groups whose MITRE group id differs only in case or padding', () => {
    expect(clusterKeys([
      group('a', { name: 'Salt Typhoon', mitreGroupId: 'G1045' }),
      group('b', { name: 'FamousSparrow', mitreGroupId: ' g1045 ' }),
    ])).toEqual([['a', 'b']]);
  });

  it('should ignore labels too short to identify an actor', () => {
    expect(clusterKeys([
      group('a', { name: 'Alpha', aliases: ['CN'] }),
      group('b', { name: 'Beta', aliases: ['c-n'] }),
    ])).toEqual([['a'], ['b']]);
  });

  it('should keep a share for each of two actors whose repertoires are identical under different names', () => {
    const repertoire = ['T1566', 'T1059', 'T1027', 'T1486', 'T1078', 'T1105', 'T1071', 'T1055', 'T1090', 'T1041'];
    const mixture = computeAttackerMixture({
      groups: [
        group('a', { name: 'Alpha', techniqueExternalIds: repertoire }),
        group('b', { name: 'Beta', techniqueExternalIds: [...repertoire] }),
      ],
      now: NOW,
    });
    expect(mixture.groups.map((entry) => entry.memberGroupKeys)).toEqual([['a'], ['b']]);
    expect(mixture.groups.map((entry) => entry.share)).toEqual([0.5, 0.5]);
  });

  it('should not let blank technique identifiers inflate a repertoire', () => {
    const thin = ['T1566', 'T1059', 'T1027', 'T1486'];
    const mixture = computeAttackerMixture({
      groups: [
        group('a', { name: 'Alpha', techniqueExternalIds: [...thin, '   '] }),
        group('b', { name: 'Beta', techniqueExternalIds: [...thin, ''] }),
      ],
      now: NOW,
    });
    expect(mixture.groups.map((entry) => entry.memberGroupKeys)).toEqual([['a'], ['b']]);
    expect(mixture.groups[0].techniqueExternalIds).toEqual(['T1027', 'T1059', 'T1486', 'T1566']);
  });

  it('should close the merge transitively and keep the strongest member as representative', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('a', { name: 'Alpha', anchor: authoredAnchor(900) }),
        group('b', { name: 'Beta', aliases: ['alpha'], anchor: authoredAnchor(10) }),
        group('c', { name: 'Gamma', aliases: ['beta'], anchor: authoredAnchor(400) }),
      ],
      now: NOW,
    });
    expect(mixture.groups).toHaveLength(1);
    expect(mixture.groups[0].groupKey).toBe('b');
    expect(mixture.groups[0].memberGroupKeys).toEqual(['a', 'b', 'c']);
    expect(mixture.groups[0].dedupedStixIds).toEqual(['intrusion-set--a', 'intrusion-set--b', 'intrusion-set--c']);
  });

  it('should emit each STIX id once when cluster members repeat one', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('a', { name: 'Alpha', stixId: 'intrusion-set--shared', anchor: authoredAnchor(900) }),
        group('b', { name: 'Beta', aliases: ['alpha'], stixId: 'intrusion-set--shared', anchor: authoredAnchor(10) }),
        group('c', { name: 'Gamma', aliases: ['beta'], stixId: 'intrusion-set--other', anchor: authoredAnchor(400) }),
        group('d', { name: 'Delta', aliases: ['gamma'], stixId: null, anchor: authoredAnchor(500) }),
      ],
      now: NOW,
    });
    expect(mixture.groups).toHaveLength(1);
    expect(mixture.groups[0].memberGroupKeys).toEqual(['a', 'b', 'c', 'd']);
    expect(mixture.groups[0].dedupedStixIds).toEqual(['intrusion-set--shared', 'intrusion-set--other']);

    const weights = computeScenarioTechniqueWeights({
      mixture,
      links: [{ groupKey: 'b', mitreExternalId: 'T1059' }],
    });
    const { dedupedStixIds } = weights[0].contributions[0];
    expect(dedupedStixIds).toEqual(['intrusion-set--shared', 'intrusion-set--other']);
    expect(new Set(dedupedStixIds).size).toBe(dedupedStixIds.length);
  });

  it('should name a cluster after its MITRE-identified member rather than its representative', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('a', { name: 'Alpha', mitreGroupId: 'G1045', anchor: authoredAnchor(900) }),
        group('b', { name: 'Beta', aliases: ['alpha'], anchor: authoredAnchor(10) }),
      ],
      now: NOW,
    });
    expect(mixture.groups[0].groupKey).toBe('b');
    expect(mixture.groups[0].name).toBe('Alpha');
  });

  it('should name a cluster after the first MITRE-identified member in group-key order', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('b', { name: 'Beta', aliases: ['alpha'], mitreGroupId: 'G0002' }),
        group('a', { name: 'Alpha', mitreGroupId: 'G0001' }),
      ],
      now: NOW,
    });
    expect(mixture.groups).toHaveLength(1);
    expect([mixture.groups[0].name, mixture.groups[0].mitreGroupId]).toEqual(['Alpha', 'G0001']);
  });

  it('should carry the normalized MITRE group id of the naming member', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('a', { name: 'Alpha', mitreGroupId: ' g1045 ', anchor: authoredAnchor(900) }),
        group('b', { name: 'Beta', aliases: ['alpha'], anchor: authoredAnchor(10) }),
      ],
      now: NOW,
    });
    expect(mixture.groups[0].mitreGroupId).toBe('G1045');
  });

  it('should treat a whitespace-only MITRE group id as absent and emit null', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('a', { name: 'Alpha', mitreGroupId: '   ', anchor: authoredAnchor(900) }),
        group('b', { name: 'Beta', aliases: ['alpha'], anchor: authoredAnchor(10) }),
      ],
      now: NOW,
    });
    expect(mixture.groups[0].mitreGroupId).toBeNull();
  });

  it('should fall back to the first member in group-key order when no member carries a MITRE id', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('b', { name: 'Beta', aliases: ['alpha'], anchor: authoredAnchor(10) }),
        group('a', { name: 'Alpha', anchor: authoredAnchor(900) }),
      ],
      now: NOW,
    });
    expect(mixture.groups[0].name).toBe('Alpha');
    expect(mixture.groups[0].mitreGroupId).toBeNull();
  });

  it('should take the max theta and the union of the repertoires over cluster members', () => {
    const mixture = computeAttackerMixture({
      groups: [
        group('a', { name: 'Alpha', anchor: authoredAnchor(400), techniqueExternalIds: ['T1059'] }),
        group('b', { name: 'Alpha', anchor: authoredAnchor(10), techniqueExternalIds: ['T1566.001'] }),
      ],
      now: NOW,
    });
    const alone = computeAttackerMixture({
      groups: [group('b', { name: 'Alpha', anchor: authoredAnchor(10), techniqueExternalIds: ['T1566.001'] })],
      now: NOW,
    });
    expect(mixture.groups[0].theta).toBeCloseTo(alone.groups[0].theta, 12);
    expect(mixture.groups[0].techniqueExternalIds).toEqual(['T1059', 'T1566']);
  });
});

describe('computeScenarioTechniqueWeights', () => {
  const mixture = computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW });
  const weights = computeScenarioTechniqueWeights({ mixture, links: linksOf(SCENARIO_GROUPS) });

  it('should fold sub-technique links into their parent', () => {
    expect(weights.map((entry) => entry.mitreExternalId).sort()).toEqual(['T1027', 'T1059', 'T1486', 'T1566']);
  });

  it('should sum the shares of the groups using the technique', () => {
    const saltTyphoon = mixture.groups.find((entry) => entry.groupKey === 'salt-typhoon')!;
    const lockbit = mixture.groups.find((entry) => entry.groupKey === 'lockbit')!;
    expect(weightOf(weights, 'T1059')).toBeCloseTo(saltTyphoon.share + lockbit.share, 12);
    expect(weightOf(weights, 'T1486')).toBeCloseTo(lockbit.share, 12);
  });

  it('should make the per-technique contributions sum exactly to the weight', () => {
    for (const entry of weights) {
      const summed = entry.contributions.reduce((total, contribution) => total + contribution.share, 0);
      expect(summed).toBe(entry.weight);
    }
  });

  it('should publish 1, not the summed shares, when the clamp binds', () => {
    // Hand-built mixture: the shares overshoot 1 the way float accumulation does over a few hundred
    // clusters, but by a visible amount so the clamped branch is asserted on purpose.
    const overshooting: AttackerMixture = {
      groups: [
        { ...mixture.groups[0], groupKey: 'first', memberGroupKeys: ['first'], share: 0.7 },
        { ...mixture.groups[1], groupKey: 'second', memberGroupKeys: ['second'], share: 0.7 },
      ],
      denominator: 1,
    };
    const [entry] = computeScenarioTechniqueWeights({
      mixture: overshooting,
      links: [
        { groupKey: 'first', mitreExternalId: 'T1059' },
        { groupKey: 'second', mitreExternalId: 'T1059' },
      ],
    });
    const summed = entry.contributions.reduce((total, contribution) => total + contribution.share, 0);
    expect(entry.weight).toBe(1);
    expect(summed).toBeGreaterThan(entry.weight);
    expect(summed).not.toBe(entry.weight);
  });

  it('should keep every weight within [0, 1]', () => {
    for (const entry of weights) {
      expect(entry.weight).toBeGreaterThanOrEqual(0);
      expect(entry.weight).toBeLessThanOrEqual(1);
    }
  });

  it('should reach 1 up to float accumulation error for a technique used by every admitted group', () => {
    const links = SCENARIO_GROUPS.map((entry) => ({ groupKey: entry.groupKey, mitreExternalId: 'T1078' }));
    expect(weightOf(computeScenarioTechniqueWeights({ mixture, links }), 'T1078')).toBeCloseTo(1, 12);
  });

  it('should hold the unit bound across many clusters', () => {
    const many = Array.from({ length: 200 }, (_, index) => group(`g${index}`, {
      name: `Group ${index}`,
      anchor: authoredAnchor(index + 1),
      techniqueExternalIds: ['T1059'],
    }));
    const manyMixture = computeAttackerMixture({ groups: many, now: NOW });
    expect(manyMixture.groups).toHaveLength(200);

    const [entry] = computeScenarioTechniqueWeights({ mixture: manyMixture, links: linksOf(many) });
    expect(entry.weight).toBeLessThanOrEqual(1);
    expect(entry.weight).toBeCloseTo(1, 12);
    const summed = entry.contributions.reduce((total, contribution) => total + contribution.share, 0);
    expect(Math.abs(summed - entry.weight) / entry.weight).toBeLessThan(1e-12);
  });

  it('should rank techniques by descending weight, breaking ties alphabetically', () => {
    const ranked = computeScenarioTechniqueWeights({
      mixture,
      links: [
        { groupKey: 'lockbit', mitreExternalId: 'T1600' },
        { groupKey: 'lockbit', mitreExternalId: 'T1500' },
        { groupKey: 'salt-typhoon', mitreExternalId: 'T1400' },
        { groupKey: 'dormant-crew', mitreExternalId: 'T1300' },
      ],
    });
    expect(ranked.map((entry) => entry.mitreExternalId)).toEqual(['T1400', 'T1500', 'T1600', 'T1300']);
    expect(weightOf(ranked, 'T1500')).toBe(weightOf(ranked, 'T1600'));
  });

  it('should order the contributions of equal shares by group key', () => {
    const twins = [group('zulu'), group('alpha')];
    const twinMixture = computeAttackerMixture({ groups: twins, now: NOW });
    expect(twinMixture.groups[0].share).toBe(twinMixture.groups[1].share);

    const [entry] = computeScenarioTechniqueWeights({
      mixture: twinMixture,
      links: twins.map((twin) => ({ groupKey: twin.groupKey, mitreExternalId: 'T1059' })),
    });
    expect(entry.contributions.map((contribution) => contribution.groupKey)).toEqual(['alpha', 'zulu']);
  });

  it('should report a zero weight for links from groups outside the mixture', () => {
    const outside = computeScenarioTechniqueWeights({ mixture, links: [{ groupKey: 'not-admitted', mitreExternalId: 'T1552' }] });
    expect(outside).toEqual([{ mitreExternalId: 'T1552', weight: 0, contributions: [] }]);
  });

  it('should emit one zero-weight entry per parent technique when the mixture is empty', () => {
    const emptyMixture = computeAttackerMixture({ groups: [], now: NOW });
    expect(computeScenarioTechniqueWeights({
      mixture: emptyMixture,
      links: [
        { groupKey: 'g', mitreExternalId: 'T1059.001' },
        { groupKey: 'h', mitreExternalId: 'T1059' },
        { groupKey: 'g', mitreExternalId: 'T1027' },
      ],
    })).toEqual([
      { mitreExternalId: 'T1027', weight: 0, contributions: [] },
      { mitreExternalId: 'T1059', weight: 0, contributions: [] },
    ]);
  });

  it('should skip links whose identifier folds to nothing and merge case variants', () => {
    const result = computeScenarioTechniqueWeights({
      mixture,
      links: [
        { groupKey: 'lockbit', mitreExternalId: '   ' },
        { groupKey: 'lockbit', mitreExternalId: '' },
        { groupKey: 'lockbit', mitreExternalId: 't1486' },
        { groupKey: 'salt-typhoon', mitreExternalId: 'T1486.001' },
      ],
    });
    expect(result.map((entry) => entry.mitreExternalId)).toEqual(['T1486']);
    expect(result[0].contributions).toHaveLength(2);
  });

  it('should carry the explainability payload of each contributing group', () => {
    const contribution = weights.find((entry) => entry.mitreExternalId === 'T1486')!.contributions[0];
    expect(contribution).toEqual({
      groupKey: 'lockbit',
      name: 'LockBit',
      entityType: 'intrusion-set',
      mitreGroupId: null,
      share: mixture.groups.find((entry) => entry.groupKey === 'lockbit')!.share,
      rho: 2 ** (-200 / DEFAULT_ACT_HALF_LIFE_AUTHORED_DAYS),
      tau: 4,
      anchorProvenance: 'authored',
      lastActivityAt: daysAgo(200),
      dedupedStixIds: ['intrusion-set--lockbit'],
    });
  });

  it('should deep-link a contribution to MITRE through the cluster group id', () => {
    const contribution = weights.find((entry) => entry.mitreExternalId === 'T1566')!.contributions[0];
    expect(contribution.groupKey).toBe('salt-typhoon');
    expect(contribution.mitreGroupId).toBe('G1045');
  });

  it('should count a technique linked twice by the same group once', () => {
    const once = computeScenarioTechniqueWeights({ mixture, links: [{ groupKey: 'lockbit', mitreExternalId: 'T1486' }] });
    const twice = computeScenarioTechniqueWeights({
      mixture,
      links: [
        { groupKey: 'lockbit', mitreExternalId: 'T1486' },
        { groupKey: 'lockbit', mitreExternalId: 'T1486' },
        { groupKey: 'lockbit', mitreExternalId: 'T1486.001' },
      ],
    });
    expect(twice[0].contributions).toHaveLength(1);
    expect(twice[0].weight).toBe(once[0].weight);
  });

  it('should not share the deduped stix id array nor the activity date with the mixture', () => {
    const localMixture = computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW });
    const localWeights = computeScenarioTechniqueWeights({ mixture: localMixture, links: linksOf(SCENARIO_GROUPS) });
    const contribution = localWeights.find((entry) => entry.mitreExternalId === 'T1486')!.contributions[0];
    contribution.dedupedStixIds.push('mutated');
    contribution.lastActivityAt!.setUTCFullYear(1970);
    const lockbit = localMixture.groups.find((entry) => entry.groupKey === 'lockbit')!;
    expect(lockbit.lastActivityAt).toEqual(daysAgo(200));
    expect(SCENARIO_GROUPS[1].anchor.date).toEqual(daysAgo(200));
    expect(localMixture.groups.find((entry) => entry.groupKey === 'lockbit')!.dedupedStixIds)
      .toEqual(['intrusion-set--lockbit']);
  });
});

describe('computeScenarioTechniqueWeights invariants', () => {
  /**
   * The guardrail is "scaling every theta by a constant leaves all weights and V unchanged". With
   * the shares normalized over the admitted clusters alone, the constant cancels in both dimensions:
   * a uniform targeting rescale and a uniform activity rescale, asserted by the two tests below.
   */
  it('should leave every weight unchanged when every targeting factor is scaled together', () => {
    const scaled = SCENARIO_GROUPS.map((entry) => ({ ...entry, countryMatch: true, sectorMatch: true }));
    const base = SCENARIO_GROUPS.map((entry) => ({ ...entry, countryMatch: false, sectorMatch: false }));

    const baseWeights = computeScenarioTechniqueWeights({
      mixture: computeAttackerMixture({ groups: base, now: NOW }),
      links: linksOf(base),
    });
    const scaledWeights = computeScenarioTechniqueWeights({
      mixture: computeAttackerMixture({ groups: scaled, now: NOW }),
      links: linksOf(scaled),
    });

    expect(scaledWeights.map((entry) => entry.mitreExternalId)).toEqual(baseWeights.map((entry) => entry.mitreExternalId));
    scaledWeights.forEach((entry, index) => {
      expect(entry.weight).toBeCloseTo(baseWeights[index].weight, 12);
    });
  });

  it('should leave every weight unchanged when every activity factor is scaled together', () => {
    // Same anchor grade throughout, so moving `now` forward rescales every rho by the exact same
    // constant.
    const uniform: Array<MixtureGroupInput> = [
      group('alpha', { name: 'Alpha', anchor: authoredAnchor(10), techniqueExternalIds: ['T1059'] }),
      group('bravo', { name: 'Bravo', anchor: authoredAnchor(30), techniqueExternalIds: ['T1059', 'T1486'] }),
    ];
    const fresh = computeAttackerMixture({ groups: uniform, now: NOW });
    const stale = computeAttackerMixture({ groups: uniform, now: new Date(NOW.getTime() + 730 * MS_PER_DAY) });
    const freshWeights = computeScenarioTechniqueWeights({ mixture: fresh, links: linksOf(uniform) });
    const staleWeights = computeScenarioTechniqueWeights({ mixture: stale, links: linksOf(uniform) });

    for (const entry of freshWeights) {
      expect(weightOf(staleWeights, entry.mitreExternalId)).toBeCloseTo(entry.weight, 12);
    }
  });

  it('should leave every weight unchanged when a group is ingested three times under aliases', () => {
    const clones: Array<MixtureGroupInput> = [
      group('salt-typhoon-opencti', {
        name: 'Earth Estries',
        aliases: ['Salt Typhoon'],
        stixId: 'intrusion-set--salt-typhoon-opencti',
        anchor: authoredAnchor(400),
        countryMatch: true,
        sectorMatch: true,
        techniqueExternalIds: ['T1566.001', 'T1059'],
      }),
      group('salt-typhoon-mitre', {
        name: 'GhostEmperor',
        mitreGroupId: 'G1045',
        stixId: 'intrusion-set--salt-typhoon-mitre',
        anchor: authoredAnchor(600),
        countryMatch: true,
        sectorMatch: true,
        techniqueExternalIds: ['T1027'],
      }),
    ];
    const withClones = [...SCENARIO_GROUPS, ...clones];

    const reference = computeScenarioTechniqueWeights({
      mixture: computeAttackerMixture({ groups: SCENARIO_GROUPS, now: NOW }),
      links: linksOf(SCENARIO_GROUPS),
    });
    const deduped = computeScenarioTechniqueWeights({
      mixture: computeAttackerMixture({ groups: withClones, now: NOW }),
      links: linksOf(withClones),
    });

    expect(deduped.map((entry) => entry.mitreExternalId)).toEqual(reference.map((entry) => entry.mitreExternalId));
    deduped.forEach((entry, index) => {
      expect(entry.weight).toBeCloseTo(reference[index].weight, 12);
      expect(entry.contributions).toHaveLength(reference[index].contributions.length);
    });
    expect(deduped[0].contributions[0].dedupedStixIds).toEqual([
      'intrusion-set--salt-typhoon',
      'intrusion-set--salt-typhoon-mitre',
      'intrusion-set--salt-typhoon-opencti',
    ]);
  });

  it('should leave the denominator and every share bit-identical when a strictly weaker alias clone targets differently', () => {
    const base: Array<MixtureGroupInput> = [
      group('alpha', { name: 'Alpha', anchor: authoredAnchor(10), techniqueExternalIds: ['T1059'] }),
      group('bravo', { name: 'Bravo', anchor: authoredAnchor(30), techniqueExternalIds: ['T1486'] }),
    ];
    // Stale enough for its theta to stay below the representative's despite the perfect targeting:
    // the clone must not move the cluster theta.
    const clone = group('alpha-legacy', {
      name: 'Alpha Legacy',
      aliases: ['Alpha'],
      anchor: authoredAnchor(2000),
      countryMatch: true,
      sectorMatch: true,
      techniqueExternalIds: ['T1059'],
    });
    const withClone = [...base, clone];

    const reference = computeAttackerMixture({ groups: base, now: NOW });
    const deduped = computeAttackerMixture({ groups: withClone, now: NOW });

    expect(deduped.groups).toHaveLength(2);
    expect(deduped.groups[0].memberGroupKeys).toEqual(['alpha', 'alpha-legacy']);
    expect(deduped.denominator).toBe(reference.denominator);
    expect(deduped.groups.map((entry) => entry.share)).toEqual(reference.groups.map((entry) => entry.share));

    const referenceWeights = computeScenarioTechniqueWeights({ mixture: reference, links: linksOf(base) });
    const dedupedWeights = computeScenarioTechniqueWeights({ mixture: deduped, links: linksOf(withClone) });
    expect(dedupedWeights.map((entry) => entry.weight)).toEqual(referenceWeights.map((entry) => entry.weight));
  });

  it('should leave the denominator bit-identical when a weaker alias moves its cluster first in key order', () => {
    // Two thetas of half an ulp of 1: added to 1 one at a time they round away, added together
    // first they do not, so the denominator shows any change in the order of the clusters.
    const halfUlpDays = 53 * DEFAULT_ACT_HALF_LIFE_AUTHORED_DAYS;
    const base: Array<MixtureGroupInput> = [
      group('alpha', { name: 'Alpha', anchor: authoredAnchor(halfUlpDays) }),
      group('bravo', { name: 'Bravo', anchor: authoredAnchor(0) }),
      group('charlie', { name: 'Charlie', anchor: authoredAnchor(halfUlpDays) }),
    ];
    const clone = group('0-charlie-legacy', {
      name: 'Charlie Legacy',
      aliases: ['Charlie'],
      anchor: authoredAnchor(halfUlpDays + DEFAULT_ACT_HALF_LIFE_AUTHORED_DAYS),
    });

    const reference = computeAttackerMixture({ groups: base, now: NOW });
    const deduped = computeAttackerMixture({ groups: [...base, clone], now: NOW });

    expect(deduped.groups[0].memberGroupKeys).toEqual(['0-charlie-legacy', 'charlie']);
    expect(deduped.denominator).toBe(reference.denominator);
  });

  it('should adopt an alias row carrying stronger evidence rather than keep the shares frozen', () => {
    const base: Array<MixtureGroupInput> = [
      group('alpha', { name: 'Alpha', anchor: authoredAnchor(400), techniqueExternalIds: ['T1059'] }),
      group('bravo', { name: 'Bravo', anchor: authoredAnchor(30), techniqueExternalIds: ['T1486'] }),
    ];
    // Fresher, observed and perfectly targeted: its theta dominates the representative's, so the
    // cluster adopts it. Clone invariance is exact for strictly weaker duplicates only, because
    // theta_cluster is the max over members: the best evidence on file must win.
    const stronger = group('alpha-fresh', {
      name: 'Alpha Fresh',
      aliases: ['Alpha'],
      anchor: observedAnchor(5),
      countryMatch: true,
      sectorMatch: true,
      techniqueExternalIds: ['T1059'],
    });

    const reference = computeAttackerMixture({ groups: base, now: NOW });
    const merged = computeAttackerMixture({ groups: [...base, stronger], now: NOW });

    expect(merged.groups).toHaveLength(2);
    expect(merged.groups[0].memberGroupKeys).toEqual(['alpha', 'alpha-fresh']);
    expect(merged.groups[0].groupKey).toBe('alpha-fresh');
    expect(merged.groups[0].tau).toBe(10);
    expect(merged.groups[0].anchorProvenance).toBe('observed');
    expect(merged.groups[0].share).toBeGreaterThan(reference.groups[0].share);

    const referenceWeights = computeScenarioTechniqueWeights({ mixture: reference, links: linksOf(base) });
    const mergedWeights = computeScenarioTechniqueWeights({ mixture: merged, links: linksOf([...base, stronger]) });
    expect(weightOf(mergedWeights, 'T1059')).toBeGreaterThan(weightOf(referenceWeights, 'T1059'));
  });
});
