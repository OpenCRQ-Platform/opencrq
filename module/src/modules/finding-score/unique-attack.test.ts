import { describe, expect, it } from 'vitest';
import type { AssetCategory } from '../supporting-assets/constants';
import type { CatalogueTechnique, StoredTechniqueClaim } from '../technique-mapping/attack-claims';
import type { UniqueAttackInput } from './unique-attack';
import { readAttackClaims } from '../technique-mapping/attack-claims';
import { aggregateUniqueAttack } from './unique-attack';

const technique = (externalId: string): CatalogueTechnique => ({ id: `id-${externalId}`, externalId, name: `${externalId} name`, isSubtechnique: false });

const ruleCatalogue = new Map(['T1078', 'T1189', 'T1190', 'T1203', 'T1210', 'T1534', 'T1566'].map((externalId) => [externalId, technique(externalId)]));

const stored = (externalId: string, over: Partial<StoredTechniqueClaim> = {}): StoredTechniqueClaim => ({
  mitreTechniqueId: `id-${externalId}`,
  techniqueExternalId: externalId,
  techniqueName: `${externalId} name`,
  role: 'exploitation_technique',
  lane: 'curated',
  grain: 'parent',
  ...over,
});

const NETWORK_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

const claimsOf = (claims: { stored?: Array<StoredTechniqueClaim>, cvssVector?: string | null }) => (exposure: 'internet_facing' | 'internal' | 'unknown') =>
  readAttackClaims({ stored: claims.stored ?? [], cwe: null, cvssVector: claims.cvssVector ?? null, cvssV2UserInteractionRequired: null, exposure, ruleCatalogue });

const carriesAll = (): null => null;

const aggregate = (input: Omit<UniqueAttackInput, 'unknownExposureCountsAs'> & Partial<Pick<UniqueAttackInput, 'unknownExposureCountsAs'>>) =>
  aggregateUniqueAttack({ unknownExposureCountsAs: 'internal', ...input });

describe('aggregateUniqueAttack', () => {
  it('counts a curated technique on every asset of the group', () => {
    const attack = aggregate({
      claimsFor: claimsOf({ stored: [stored('T1133'), stored('T1486', { role: 'primary_impact' })] }),
      carriedFor: carriesAll,
      members: [
        { exposure: 'internet_facing', categoryId: 'host', assetCount: 3 },
        { exposure: 'internal', categoryId: 'host', assetCount: 5 },
      ],
    });

    expect(attack.assetCount).toBe(8);
    expect(attack.rows.map((row) => [row.externalId, row.group, row.assetCount])).toEqual([
      ['T1133', 'exploitation', 8],
      ['T1486', 'primary_impact', 8],
    ]);
  });

  it.each([
    ['internal', [['T1190', 30, ['internet_facing']], ['T1210', 82, ['internal', 'unknown']]]],
    ['internet_facing', [['T1190', 50, ['internet_facing', 'unknown']], ['T1210', 62, ['internal']]]],
  ] as const)('splits the topology rule by exposure, an unknown exposure counting as %s', (unknownExposureCountsAs, rows) => {
    const attack = aggregate({
      claimsFor: claimsOf({ cvssVector: NETWORK_VECTOR }),
      unknownExposureCountsAs,
      carriedFor: carriesAll,
      members: [
        { exposure: 'internet_facing', categoryId: 'host', assetCount: 30 },
        { exposure: 'internal', categoryId: 'host', assetCount: 62 },
        { exposure: 'unknown', categoryId: 'host', assetCount: 20 },
      ],
    });

    expect(attack.assetCount).toBe(112);
    expect(attack.rows.map((row) => [row.externalId, row.assetCount, row.exposures])).toEqual(rows);
  });

  it('names only the exposures the members carry', () => {
    const attack = aggregate({
      claimsFor: claimsOf({ cvssVector: NETWORK_VECTOR }),
      carriedFor: carriesAll,
      members: [{ exposure: 'internet_facing', categoryId: 'host', assetCount: 4 }],
    });

    expect(attack.rows.map((row) => [row.externalId, row.assetCount, row.exposures])).toEqual([['T1190', 4, ['internet_facing']]]);
    expect(attack.waysIn.map((wayIn) => [wayIn.externalId, wayIn.exposures])).toEqual([
      ['T1190', ['internet_facing']],
      ['T1210', ['internal', 'unknown']],
    ]);
  });

  it('lists the ways in in the order the attack runs them, whatever exposure first names them', () => {
    const attack = aggregate({
      claimsFor: claimsOf({ cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H' }),
      carriedFor: carriesAll,
      members: [
        { exposure: 'internet_facing', categoryId: 'host', assetCount: 2 },
        { exposure: 'internal', categoryId: 'host', assetCount: 3 },
      ],
    });

    expect(attack.rows.map((row) => [row.externalId, row.assetCount])).toEqual([
      ['T1189', 5],
      ['T1566', 5],
      ['T1534', 3],
      ['T1203', 5],
    ]);
  });

  it('sets a way in aside by family and says on how many assets, never an impact', () => {
    const carried = new Map<AssetCategory, ReadonlySet<string>>([['host', new Set(['id-T1133', 'id-T1486'])], ['identity', new Set()]]);
    const attack = aggregate({
      claimsFor: claimsOf({ stored: [stored('T1133'), stored('T1486', { role: 'primary_impact' })] }),
      carriedFor: (categoryId) => carried.get(categoryId) ?? new Set(),
      members: [
        { exposure: 'internal', categoryId: 'host', assetCount: 10 },
        { exposure: 'internal', categoryId: 'identity', assetCount: 14 },
      ],
    });

    expect(attack.rows.map((row) => [row.externalId, row.assetCount, row.setAside])).toEqual([
      ['T1133', 10, [{ categoryId: 'identity', assetCount: 14 }]],
      ['T1486', 24, []],
    ]);
    expect(attack.waysIn.find((wayIn) => wayIn.externalId === 'T1133')?.setAsideOn).toContain('identity');
    expect(attack.waysIn.find((wayIn) => wayIn.externalId === 'T1133')?.setAsideOn).not.toContain('host');
  });

  it('keeps a way in every member sets aside, at zero assets', () => {
    const attack = aggregate({
      claimsFor: claimsOf({ stored: [stored('T1133')] }),
      carriedFor: () => new Set(),
      members: [{ exposure: 'internal', categoryId: 'identity', assetCount: 2 }],
    });

    expect(attack.rows.map((row) => [row.externalId, row.assetCount, row.setAside])).toEqual([
      ['T1133', 0, [{ categoryId: 'identity', assetCount: 2 }]],
    ]);
  });

  it('lists no row for a group without members, while still naming the ways in', () => {
    const attack = aggregate({ claimsFor: claimsOf({ cvssVector: NETWORK_VECTOR }), carriedFor: carriesAll, members: [] });

    expect(attack).toMatchObject({ assetCount: 0, rows: [] });
    expect(attack.waysIn.map((wayIn) => wayIn.externalId)).toEqual(['T1190', 'T1210']);
  });
});
