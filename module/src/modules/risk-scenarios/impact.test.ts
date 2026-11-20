import { describe, expect, it } from 'vitest';
import type { CriteriaReached } from '../attack-outcomes/data/attack-outcomes-data';
import type { SupportToPrimaryLinkRole } from '../asset-dependencies/link-roles';
import { computeAssetImpacts, shareOfAttackTransmitted, wholePercent } from './impact';

const RANSOMWARE: CriteriaReached = { availability: 'full', integrity: 'lower', confidentiality: 'full', traceability: 'none' };

const stp = (supportingAssetId: string, primaryAssetId: string, roles: Array<SupportToPrimaryLinkRole>) =>
  ({ supportingAssetId, primaryAssetId, roles });
const sts = (providerAssetId: string, dependentAssetId: string) => ({ providerAssetId, dependentAssetId });

const percents = (impacts: ReturnType<typeof computeAssetImpacts>) =>
  Object.fromEntries([...impacts].map(([id, { impact }]) => [id, wholePercent(impact)]));

describe('shareOfAttackTransmitted', () => {
  it('weighs each criterion the link inherits by how far the outcome reaches it', () => {
    expect(shareOfAttackTransmitted(RANSOMWARE, { availability: 'lower', integrity: 'lower', confidentiality: 'full', traceability: 'none' }))
      .toEqual({ outcomeTotal: 2.5, transmittedTotal: 1.75, share: 0.7 });
  });

  it('reads 0 for an outcome that reaches no criterion', () => {
    const none: CriteriaReached = { availability: 'none', integrity: 'none', confidentiality: 'none', traceability: 'none' };
    expect(shareOfAttackTransmitted(none, { availability: 'full', integrity: 'full', confidentiality: 'full', traceability: 'full' }).share).toBe(0);
  });
});

describe('computeAssetImpacts', () => {
  it('ranks the worked example as the spec reads it', () => {
    const impacts = computeAssetImpacts({
      primaryAssetIds: ['ctd', 'cp'],
      supportToPrimaryLinks: [
        stp('cae', 'ctd', ['processes', 'transmits']),
        stp('cae', 'cp', ['processes', 'transmits']),
        stp('cdb', 'ctd', ['stores']),
        stp('bkp', 'ctd', ['stores', 'supports_availability']),
        stp('pbi', 'ctd', ['reads']),
        stp('elb', 'cp', ['supports_availability']),
        stp('spl', 'ctd', ['monitors']),
      ],
      supportToSupportLinks: [sts('aks', 'cae'), sts('az', 'aks')],
      criteriaReached: RANSOMWARE,
      maxHops: 5,
    });

    expect(percents(impacts)).toEqual({ cae: 100, cdb: 50, bkp: 50, aks: 50, pbi: 35, az: 25, elb: 20, spl: 10 });
    expect(impacts.get('az')?.contributions.map(({ primaryAssetId, hops, chain }) => ({ primaryAssetId, hops, chain }))).toEqual([
      { primaryAssetId: 'ctd', hops: 2, chain: ['aks', 'cae'] },
      { primaryAssetId: 'cp', hops: 2, chain: ['aks', 'cae'] },
    ]);
  });

  it('keeps the best path to a primary asset rather than summing two paths', () => {
    const impacts = computeAssetImpacts({
      primaryAssetIds: ['p'],
      supportToPrimaryLinks: [stp('backup', 'p', ['stores']), stp('db', 'p', ['stores'])],
      supportToSupportLinks: [sts('backup', 'db')],
      criteriaReached: RANSOMWARE,
      maxHops: 5,
    });

    expect(impacts.get('backup')).toMatchObject({ impact: 1, contributions: [{ hops: 0, chain: [] }] });
  });

  it('prefers a longer path when it transmits more than the shortest one', () => {
    const impacts = computeAssetImpacts({
      primaryAssetIds: ['p'],
      supportToPrimaryLinks: [stp('siem', 'p', ['monitors']), stp('db', 'p', ['stores'])],
      supportToSupportLinks: [sts('siem', 'db')],
      criteriaReached: RANSOMWARE,
      maxHops: 5,
    });

    expect(impacts.get('siem')).toMatchObject({ impact: 0.5, contributions: [{ hops: 1, chain: ['db'], roles: ['stores'] }] });
  });

  it('never reads above the whole loss, cycles and diamonds included', () => {
    const impacts = computeAssetImpacts({
      primaryAssetIds: ['p1', 'p2'],
      supportToPrimaryLinks: [stp('a', 'p1', ['unknown']), stp('a', 'p2', ['unknown']), stp('b', 'p1', ['unknown'])],
      supportToSupportLinks: [sts('a', 'b'), sts('b', 'a'), sts('c', 'a'), sts('c', 'b'), sts('a', 'c')],
      criteriaReached: RANSOMWARE,
      maxHops: 5,
    });

    for (const { impact } of impacts.values()) {
      expect(impact).toBeLessThanOrEqual(1);
    }
    expect(percents(impacts)).toEqual({ a: 100, b: 75, c: 50 });
  });

  it('reads the whole loss and not a hair above it for an asset that fully supports nine primary assets', () => {
    const primaryAssetIds = Array.from({ length: 9 }, (_, index) => `p${index}`);
    const impacts = computeAssetImpacts({
      primaryAssetIds,
      supportToPrimaryLinks: primaryAssetIds.map((primaryAssetId) => stp('hub', primaryAssetId, ['unknown'])),
      supportToSupportLinks: [],
      criteriaReached: RANSOMWARE,
      maxHops: 5,
    });

    expect(impacts.get('hub')?.impact).toBe(1);
  });

  it('stops the walk at the hop limit', () => {
    const impacts = computeAssetImpacts({
      primaryAssetIds: ['p'],
      supportToPrimaryLinks: [stp('s0', 'p', ['unknown'])],
      supportToSupportLinks: [sts('s1', 's0'), sts('s2', 's1'), sts('s3', 's2')],
      criteriaReached: RANSOMWARE,
      maxHops: 2,
    });

    expect([...impacts.keys()].sort()).toEqual(['s0', 's1', 's2']);
  });
});

describe('wholePercent', () => {
  it('truncates, and does not lose a percent to floating point', () => {
    expect(wholePercent(0.359)).toBe(35);
    expect(wholePercent((1.75 / 2.5) * 0.5)).toBe(35);
    expect(wholePercent(0.1 * 3)).toBe(30);
  });
});
