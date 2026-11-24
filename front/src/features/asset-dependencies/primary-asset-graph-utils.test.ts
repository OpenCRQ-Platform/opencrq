import type { PrimaryToPrimaryLinkStrength, SecurityNeedLevel } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import type { PrimaryGraphAsset, PrimaryGraphFilters, PrimaryGraphLink } from './primary-asset-graph-utils';
import { buildPrimaryAssetGraph, edgeStrength, linksOfKeptAssets, strengthCounts } from './primary-asset-graph-utils';
import { ANY_RESOURCE_TYPE, NO_RESOURCE_TYPE } from './primary-to-primary-links-utils';

const asset = (id: string, businessFunction: string, availability: SecurityNeedLevel | null = null): PrimaryGraphAsset => ({
  id,
  name: id,
  businessFunction,
  availability,
  integrity: null,
  confidentiality: null,
  traceability: null,
});

const link = (
  id: string,
  dependentAssetId: string,
  providerAssetId: string,
  strength: PrimaryToPrimaryLinkStrength = 'critical',
  dependencyResourceTypeId: string | null = null,
): PrimaryGraphLink => ({
  id, dependentAssetId, providerAssetId, strength, dependencyResourceTypeId, dependencyResourceTypeName: dependencyResourceTypeId,
});

// Month-end closing depends on payroll and on the general ledger, payroll on HR management, which
// depends on recruiting, and archiving is linked to nothing.
const assets = [
  asset('closing', 'Finance', 'very_high'),
  asset('payroll', 'Finance', 'high'),
  asset('ledger', 'Finance'),
  asset('hr', 'HR', 'medium'),
  asset('recruiting', 'HR'),
  asset('archiving', 'Finance'),
];
const links = [
  link('l1', 'closing', 'payroll', 'important', 'people'),
  link('l2', 'closing', 'ledger', 'critical'),
  link('l3', 'payroll', 'hr', 'critical', 'people'),
  link('l4', 'hr', 'recruiting', 'minor'),
];

const everything = (overrides: Partial<PrimaryGraphFilters> = {}): PrimaryGraphFilters => ({
  keptIds: new Set(assets.map((candidate) => candidate.id)),
  hiddenStrengths: new Set(),
  resourceType: ANY_RESOURCE_TYPE,
  ...overrides,
});

const finance = new Set(['closing', 'payroll', 'ledger', 'archiving']);

describe('buildPrimaryAssetGraph', () => {
  it('should draw every linked asset and every link, and count the unlinked ones', () => {
    const model = buildPrimaryAssetGraph(assets, links, everything());

    expect(model.nodes.map((node) => node.id)).toEqual(['closing', 'payroll', 'ledger', 'hr', 'recruiting']);
    expect(model.edges.map((edge) => edge.id)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(model.unlinkedCount).toBe(1);
  });

  it('should put the dependents on the left of what they depend on', () => {
    const columns = new Map(buildPrimaryAssetGraph(assets, links, everything()).nodes.map((node) => [node.id, node.level]));

    expect(columns).toEqual(new Map([['closing', 0], ['payroll', 1], ['ledger', 1], ['hr', 2], ['recruiting', 3]]));
  });

  it('should carry the overall level, the highest of the security needs', () => {
    const model = buildPrimaryAssetGraph(assets, links, everything());

    expect(model.nodes.find((node) => node.id === 'closing')?.overallLevel).toBe('very_high');
    expect(model.nodes.find((node) => node.id === 'ledger')?.overallLevel).toBeNull();
  });

  it('should keep a direct neighbour outside the node filters, faded, and nothing further', () => {
    const model = buildPrimaryAssetGraph(assets, links, everything({ keptIds: finance }));

    expect(model.nodes.map((node) => [node.id, node.outsideFilters])).toEqual([
      ['closing', false], ['payroll', false], ['ledger', false], ['hr', true],
    ]);
    expect(model.edges.map((edge) => edge.id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('should leave out the links of a hidden strength', () => {
    const model = buildPrimaryAssetGraph(assets, links, everything({ hiddenStrengths: new Set(['critical']) }));

    expect(model.edges.map((edge) => edge.id)).toEqual(['l1', 'l4']);
    expect(model.nodes.map((node) => node.id)).toEqual(['closing', 'payroll', 'hr', 'recruiting']);
  });

  it('should keep only the links of the picked resource type, or those without one', () => {
    expect(buildPrimaryAssetGraph(assets, links, everything({ resourceType: 'people' })).edges.map((edge) => edge.id)).toEqual(['l1', 'l3']);
    expect(buildPrimaryAssetGraph(assets, links, everything({ resourceType: NO_RESOURCE_TYPE })).edges.map((edge) => edge.id)).toEqual(['l2', 'l4']);
  });

  it('should count among the kept assets only those without any link', () => {
    expect(buildPrimaryAssetGraph(assets, links, everything({ keptIds: new Set(['hr', 'recruiting']) })).unlinkedCount).toBe(0);
    expect(buildPrimaryAssetGraph(assets, links, everything({ keptIds: finance })).unlinkedCount).toBe(1);
  });

  it('should draw a mutual dependency as one edge carrying both links, in one column', () => {
    const model = buildPrimaryAssetGraph(assets, [link('m2', 'ledger', 'closing', 'minor'), link('m1', 'closing', 'ledger', 'unknown')], everything());

    expect(model.edges).toHaveLength(1);
    expect(model.edges[0].id).toBe('m1');
    expect(model.edges[0].links.map((candidate) => candidate.id)).toEqual(['m1', 'm2']);
    expect(new Set(model.nodes.map((node) => node.level)).size).toBe(1);
  });

  it('should skip a link whose end is missing from the assets', () => {
    expect(buildPrimaryAssetGraph(assets, [link('x', 'closing', 'gone')], everything()).edges).toEqual([]);
  });
});

describe('strengthCounts', () => {
  it('should count the links of each strength', () => {
    expect(strengthCounts(links)).toEqual({ critical: 2, important: 1, minor: 1, unknown: 0 });
  });
});

describe('linksOfKeptAssets', () => {
  it('should keep the links with at least one kept end', () => {
    expect(linksOfKeptAssets(links, new Set(['ledger', 'recruiting'])).map((candidate) => candidate.id)).toEqual(['l2', 'l4']);
  });
});

describe('edgeStrength', () => {
  it('should read a mutual dependency at its stronger link', () => {
    expect(edgeStrength({ id: 'm', source: 'a', target: 'b', links: [link('m', 'a', 'b', 'unknown'), link('n', 'b', 'a', 'minor')] })).toBe('minor');
  });
});
