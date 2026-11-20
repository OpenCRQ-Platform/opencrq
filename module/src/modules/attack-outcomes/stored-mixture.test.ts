import { describe, expect, it } from 'vitest';
import type { MixtureGroupInput, TechniqueLink } from '../threat-analyses/technique-weighting';
import { computeAttackerMixture, computeScenarioTechniqueWeights } from '../threat-analyses/technique-weighting';
import { linksOfMixture, mixtureClockOf, mixtureFromRows, mixturePairKey, mixtureToRows, sameStoredMixture } from './stored-mixture';

const NOW = new Date('2026-07-27T00:00:00.000Z');
const TENANT_ID = 'tenant-1';
const PAIR = { organizationId: 'org-1', attackOutcomeId: 'outcome-1' };
const COMPUTED_AT = new Date('2026-07-27T00:00:00.000Z');

const input = (overrides: Partial<MixtureGroupInput> & Pick<MixtureGroupInput, 'groupKey' | 'name'>): MixtureGroupInput => ({
  entityType: 'intrusion-set',
  aliases: [],
  mitreGroupId: null,
  stixId: null,
  anchor: { date: new Date('2026-07-01T00:00:00.000Z'), provenance: 'observed' },
  countryMatch: false,
  sectorMatch: false,
  weight: 1,
  techniqueExternalIds: [],
  ...overrides,
});

const GROUPS: Array<MixtureGroupInput> = [
  // The two Alpha rows fold into one cluster through the shared alias, and carry the same STIX id.
  input({
    groupKey: 'a-1',
    name: 'APT Alpha',
    aliases: ['Alpha Team'],
    mitreGroupId: 'G0001',
    stixId: 'intrusion-set--alpha',
    countryMatch: true,
    techniqueExternalIds: ['T1003.001', 'T1078'],
  }),
  input({
    groupKey: 'a-2',
    name: 'Alpha Team',
    stixId: 'intrusion-set--alpha',
    techniqueExternalIds: ['T1566'],
  }),
  input({
    groupKey: 'b-1',
    name: 'Bravo Crew',
    entityType: 'threat-actor',
    stixId: 'threat-actor--bravo',
    anchor: { date: new Date('2025-11-15T00:00:00.000Z'), provenance: 'authored' },
    sectorMatch: true,
    techniqueExternalIds: ['T1078', 'T1190'],
  }),
  input({
    groupKey: 'c-1',
    name: 'Charlie Group',
    anchor: { date: null, provenance: 'none' },
    techniqueExternalIds: ['T1190'],
  }),
  input({ groupKey: 'd-1', name: 'Delta Ops', entityType: 'campaign', countryMatch: true, sectorMatch: true }),
  input({ groupKey: 'e-1', name: 'Echo Unit', techniqueExternalIds: ['T1566.002'] }),
];

const mixture = computeAttackerMixture({ groups: GROUPS, now: NOW });

// Per member, the way the evidence read builds them.
const memberLinks: Array<TechniqueLink> = GROUPS.flatMap((group) =>
  group.techniqueExternalIds.map((mitreExternalId) => ({ groupKey: group.groupKey, mitreExternalId })));

const rowsOf = (source = mixture) => mixtureToRows(TENANT_ID, PAIR, COMPUTED_AT, source);

describe('mixturePairKey', () => {
  it('joins the organization and the attack outcome', () => {
    expect(mixturePairKey(PAIR)).toBe('org-1/outcome-1');
  });
});

describe('mixtureClockOf', () => {
  it('is the start of the UTC day', () => {
    expect(mixtureClockOf(new Date('2026-07-27T23:59:59.999Z')).toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });
});

describe('fixture', () => {
  it('folds the two Alpha rows into one cluster and keeps an actor without technique', () => {
    expect(mixture.groups).toHaveLength(5);
    expect(mixture.groups.find((group) => group.groupKey === 'a-1')?.memberGroupKeys).toEqual(['a-1', 'a-2']);
    expect(mixture.groups.find((group) => group.groupKey === 'a-1')?.dedupedStixIds).toEqual(['intrusion-set--alpha']);
    expect(mixture.groups.find((group) => group.groupKey === 'd-1')?.techniqueExternalIds).toEqual([]);
    expect(mixture.groups.find((group) => group.groupKey === 'c-1')?.lastActivityAt).toBeNull();
  });
});

describe('linksOfMixture', () => {
  it('gives computeScenarioTechniqueWeights the same weights as the per-member links', () => {
    const fromMembers = computeScenarioTechniqueWeights({ mixture, links: memberLinks });
    const fromMixture = computeScenarioTechniqueWeights({ mixture, links: linksOfMixture(mixture) });
    expect(fromMixture).toEqual(fromMembers);
    expect(fromMixture.length).toBeGreaterThan(0);
  });

  it('gives the same weights after a round trip through the rows', () => {
    const restored = mixtureFromRows(rowsOf());
    expect(computeScenarioTechniqueWeights({ mixture: restored, links: linksOfMixture(restored) }))
      .toEqual(computeScenarioTechniqueWeights({ mixture, links: memberLinks }));
  });

  it('emits no link for a group without technique', () => {
    expect(linksOfMixture(mixture).some((link) => link.groupKey === 'd-1')).toBe(false);
  });
});

describe('mixtureToRows and mixtureFromRows', () => {
  it('round-trips the mixture', () => {
    expect(mixtureFromRows(rowsOf())).toEqual(mixture);
  });

  it('round-trips the mixture when the group rows arrive in reverse order', () => {
    const rows = rowsOf();
    expect(mixtureFromRows({ ...rows, groups: [...rows.groups].reverse() })).toEqual(mixture);
  });

  it('writes the pair, the tenant, the clock and the position on every row', () => {
    const rows = rowsOf();
    expect(rows.mixture).toEqual({
      tenantId: TENANT_ID,
      organizationId: PAIR.organizationId,
      attackOutcomeId: PAIR.attackOutcomeId,
      computedAt: COMPUTED_AT,
      denominator: mixture.denominator,
    });
    expect(rows.groups.map((group) => group.position)).toEqual([0, 1, 2, 3, 4]);
    for (const group of rows.groups) {
      expect([group.tenantId, group.organizationId, group.attackOutcomeId]).toEqual([TENANT_ID, 'org-1', 'outcome-1']);
    }
  });

  it('aliases no input or output array nor date', () => {
    const rows = rowsOf();
    const source = mixture.groups[0];
    expect(rows.groups[0].memberGroupKeys).not.toBe(source.memberGroupKeys);
    expect(rows.groups[0].dedupedStixIds).not.toBe(source.dedupedStixIds);
    expect(rows.groups[0].techniqueExternalIds).not.toBe(source.techniqueExternalIds);
    expect(rows.groups[0].lastActivityAt).not.toBe(source.lastActivityAt);
    expect(rows.mixture.computedAt).not.toBe(COMPUTED_AT);

    const restored = mixtureFromRows(rows);
    expect(restored.groups[0].memberGroupKeys).not.toBe(rows.groups[0].memberGroupKeys);
    expect(restored.groups[0].dedupedStixIds).not.toBe(rows.groups[0].dedupedStixIds);
    expect(restored.groups[0].techniqueExternalIds).not.toBe(rows.groups[0].techniqueExternalIds);
    expect(restored.groups[0].lastActivityAt).not.toBe(rows.groups[0].lastActivityAt);
  });

  it('round-trips a mixture without group', () => {
    const empty = computeAttackerMixture({ groups: [], now: NOW });
    const rows = rowsOf(empty);
    expect(rows.groups).toEqual([]);
    expect(mixtureFromRows(rows)).toEqual({ groups: [], denominator: empty.denominator });
  });

  it('keeps a degenerate denominator and its zero shares', () => {
    const stale = computeAttackerMixture({
      groups: [input({
        groupKey: 'old-1',
        name: 'Old Actor',
        anchor: { date: new Date('1000-01-01T00:00:00.000Z'), provenance: 'observed' },
        techniqueExternalIds: ['T1078'],
      })],
      now: NOW,
    });
    expect(stale.denominator).toBe(0);
    expect(stale.groups[0].share).toBe(0);
    expect(mixtureFromRows(rowsOf(stale))).toEqual(stale);
  });
});

describe('sameStoredMixture', () => {
  it('is true for two outputs of the same input', () => {
    expect(sameStoredMixture(rowsOf(), rowsOf())).toBe(true);
  });

  it('is true when the stored group rows arrive in another order', () => {
    const stored = rowsOf();
    expect(sameStoredMixture({ ...stored, groups: [...stored.groups].reverse() }, rowsOf())).toBe(true);
  });

  it('is false when a share moves by one ulp', () => {
    const moved = rowsOf();
    moved.groups[0] = { ...moved.groups[0], share: moved.groups[0].share + Number.EPSILON * moved.groups[0].share };
    expect(sameStoredMixture(rowsOf(), moved)).toBe(false);
  });

  it('is false when the computation clock changes', () => {
    const later = mixtureToRows(TENANT_ID, PAIR, new Date('2026-07-28T00:00:00.000Z'), mixture);
    expect(sameStoredMixture(rowsOf(), later)).toBe(false);
  });

  it('is false when the denominator changes', () => {
    expect(sameStoredMixture(rowsOf(), rowsOf({ ...mixture, denominator: mixture.denominator * 2 }))).toBe(false);
  });

  it('is false when two groups swap places', () => {
    const swapped = { ...mixture, groups: [mixture.groups[1], mixture.groups[0], ...mixture.groups.slice(2)] };
    expect(sameStoredMixture(rowsOf(), rowsOf(swapped))).toBe(false);
  });

  it('is false when a group is added', () => {
    const added = { ...mixture, groups: [...mixture.groups, { ...mixture.groups[0], groupKey: 'z-1' }] };
    expect(sameStoredMixture(rowsOf(), rowsOf(added))).toBe(false);
  });

  it('is false when a group list changes order', () => {
    const reordered = rowsOf();
    reordered.groups[0] = { ...reordered.groups[0], techniqueExternalIds: [...reordered.groups[0].techniqueExternalIds].reverse() };
    expect(sameStoredMixture(rowsOf(), reordered)).toBe(false);
  });

  it('is false when a last activity date moves', () => {
    const moved = rowsOf();
    moved.groups[0] = { ...moved.groups[0], lastActivityAt: new Date('2026-07-02T00:00:00.000Z') };
    expect(sameStoredMixture(rowsOf(), moved)).toBe(false);
  });

  it('is false when a null last activity date becomes a date', () => {
    const dated = rowsOf();
    const index = dated.groups.findIndex((group) => group.lastActivityAt === null);
    dated.groups[index] = { ...dated.groups[index], lastActivityAt: NOW };
    expect(sameStoredMixture(rowsOf(), dated)).toBe(false);
  });

  it('is false when the computed group carries a field the stored row lacks', () => {
    const widened = rowsOf();
    widened.groups[0] = { ...widened.groups[0], evidenceRank: 1 } as typeof widened.groups[0];
    expect(sameStoredMixture(rowsOf(), widened)).toBe(false);
  });
});
