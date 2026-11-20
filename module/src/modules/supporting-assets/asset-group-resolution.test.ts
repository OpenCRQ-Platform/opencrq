import { describe, expect, it } from 'vitest';
import type { StoredAssetGroup } from './asset-group-resolution';
import { diffMemberships, matchPushedGroup, normalizePushedGroups } from './asset-group-resolution';

const manual: StoredAssetGroup = { id: 'g-manual', name: 'Payments', externalReference: null, connectorId: null };
const referenced: StoredAssetGroup = { id: 'g-ref', name: 'Old name', externalReference: 'cmdb-42', connectorId: null };
const fromOpenaev: StoredAssetGroup = { id: 'g-oaev', name: 'Payments', externalReference: null, connectorId: 'conn-openaev' };

describe('normalizePushedGroups', () => {
  it('trims, drops blank names and collapses duplicates on the reference, else on the name', () => {
    expect(normalizePushedGroups([
      { name: ' Payments ' },
      { name: 'Payments' },
      { name: '   ' },
      { name: 'A', externalReference: 'r1' },
      { name: 'B', externalReference: ' r1 ' },
      { name: 'C', externalReference: '' },
    ])).toEqual([
      { name: 'Payments', externalReference: null },
      { name: 'A', externalReference: 'r1' },
      { name: 'C', externalReference: null },
    ]);
  });
});

describe('matchPushedGroup', () => {
  it('creates a group when neither the reference nor the name is stored', () => {
    expect(matchPushedGroup({ name: 'New', externalReference: 'r9' }, [manual, referenced]))
      .toEqual({ action: 'create', name: 'New', externalReference: 'r9' });
  });

  it('matches on the external reference before the name, and renames a group no connector owns', () => {
    expect(matchPushedGroup({ name: 'Payments', externalReference: 'cmdb-42' }, [manual, referenced]))
      .toEqual({ action: 'use', groupId: 'g-ref', update: { name: 'Payments' } });
  });

  it('never renames a connector group matched on its reference', () => {
    const connectorRef: StoredAssetGroup = { ...fromOpenaev, externalReference: 'cmdb-7' };
    expect(matchPushedGroup({ name: 'Other', externalReference: 'cmdb-7' }, [connectorRef]))
      .toEqual({ action: 'use', groupId: 'g-oaev' });
  });

  it('prefers the group of no connector among groups with the same name', () => {
    expect(matchPushedGroup({ name: 'Payments', externalReference: null }, [fromOpenaev, manual]))
      .toEqual({ action: 'use', groupId: 'g-manual' });
  });

  it('links to a connector group by name when it is the only one, without changing it', () => {
    expect(matchPushedGroup({ name: 'Payments', externalReference: 'r1' }, [fromOpenaev]))
      .toEqual({ action: 'use', groupId: 'g-oaev' });
  });

  it('gives its reference to a group matched by name that holds none', () => {
    expect(matchPushedGroup({ name: 'Payments', externalReference: 'r1' }, [manual]))
      .toEqual({ action: 'use', groupId: 'g-manual', update: { externalReference: 'r1' } });
  });

  it('matches names exactly, case included, as the tag vocabulary does', () => {
    expect(matchPushedGroup({ name: 'payments', externalReference: null }, [manual]).action).toBe('create');
  });
});

describe('diffMemberships', () => {
  it('keeps the rows the new set holds, sweeps the stale and duplicated ones, inserts only the missing', () => {
    const held = [
      { id: 'm1', assetGroupId: 'g1', supportingAssetId: 'a1' },
      { id: 'm2', assetGroupId: 'g1', supportingAssetId: 'a2' },
      { id: 'm3', assetGroupId: 'g1', supportingAssetId: 'a1' },
    ];
    const wanted = [
      { assetGroupId: 'g1', supportingAssetId: 'a1' },
      { assetGroupId: 'g2', supportingAssetId: 'a1' },
    ];
    expect(diffMemberships(held, wanted)).toEqual({
      staleIds: ['m2', 'm3'],
      missing: [{ assetGroupId: 'g2', supportingAssetId: 'a1' }],
    });
  });

  it('writes nothing for an unchanged set', () => {
    const held = [{ id: 'm1', assetGroupId: 'g1', supportingAssetId: 'a1' }];
    expect(diffMemberships(held, [{ assetGroupId: 'g1', supportingAssetId: 'a1' }])).toEqual({ staleIds: [], missing: [] });
  });

  it('clears every row of the author for an empty set', () => {
    const held = [{ id: 'm1', assetGroupId: 'g1', supportingAssetId: 'a1' }];
    expect(diffMemberships(held, [])).toEqual({ staleIds: ['m1'], missing: [] });
  });
});
