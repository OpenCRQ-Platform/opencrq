import { describe, expect, it, vi } from 'vitest';
import { syncAssetGroups, toConnectorAssetGroups } from './openaev-group-phase';

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logFromError: vi.fn(),
    logTrace: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  }),
}));

const group = (id: string, assets: Array<string>, dynamic: Array<string> = []) => ({
  asset_group_id: id,
  asset_group_name: `Group ${id}`,
  asset_group_description: null,
  asset_group_assets: assets,
  asset_group_dynamic_assets: dynamic,
});

describe('toConnectorAssetGroups', () => {
  it('maps static and dynamic members onto the assets the inventory folded them onto, once each', () => {
    const map = new Map([['oaev-1', 'crq-1'], ['oaev-2', 'crq-2'], ['oaev-3', 'crq-1']]);
    expect(toConnectorAssetGroups([group('g1', ['oaev-1', 'oaev-2'], ['oaev-3', 'oaev-2'])], map)).toEqual([
      { sourceGroupId: 'g1', name: 'Group g1', description: null, supportingAssetIds: ['crq-1', 'crq-2'] },
    ]);
  });

  it('leaves out a member the inventory does not know, and keeps an empty group', () => {
    expect(toConnectorAssetGroups([group('g1', ['unknown'])], new Map())).toEqual([
      { sourceGroupId: 'g1', name: 'Group g1', description: null, supportingAssetIds: [] },
    ]);
  });

  it('reads null member lists as empty', () => {
    const nulls = { asset_group_id: 'g1', asset_group_name: 'G', asset_group_assets: null, asset_group_dynamic_assets: null };
    expect(toConnectorAssetGroups([nulls], new Map())[0].supportingAssetIds).toEqual([]);
  });
});

describe('syncAssetGroups', () => {
  const result = { groups: 0, membersAdded: 0, membersRemoved: 0, groupsDeleted: 0 };

  it('writes every tenant\'s groups in one call, marked complete', async () => {
    const listAssetGroups = vi.fn((tenantId: string) => Promise.resolve([group(`${tenantId}-g`, ['a'])]));
    const syncConnectorAssetGroups = vi.fn(() => Promise.resolve(result));
    await syncAssetGroups({
      client: { listAssetGroups },
      svc: { supportingAssets: { syncConnectorAssetGroups } },
      connectorId: 'conn',
      openaevTenantIds: ['t1', 't2'],
      assetIdMapByTenant: new Map([['t1', new Map([['a', 'crq-a']])], ['t2', new Map()]]),
    });
    expect(syncConnectorAssetGroups).toHaveBeenCalledTimes(1);
    expect(syncConnectorAssetGroups).toHaveBeenCalledWith('conn', [
      { sourceGroupId: 't1-g', name: 'Group t1-g', description: null, supportingAssetIds: ['crq-a'] },
      { sourceGroupId: 't2-g', name: 'Group t2-g', description: null, supportingAssetIds: [] },
    ], true);
  });

  it('marks the listing incomplete when one tenant fails, so no group is deleted', async () => {
    const listAssetGroups = vi.fn((tenantId: string) => (tenantId === 't2'
      ? Promise.reject(new Error('503'))
      : Promise.resolve([group('g1', [])])));
    const syncConnectorAssetGroups = vi.fn(() => Promise.resolve(result));
    await syncAssetGroups({
      client: { listAssetGroups },
      svc: { supportingAssets: { syncConnectorAssetGroups } },
      connectorId: 'conn',
      openaevTenantIds: ['t1', 't2'],
      assetIdMapByTenant: new Map(),
    });
    expect(syncConnectorAssetGroups).toHaveBeenCalledWith('conn', [expect.objectContaining({ sourceGroupId: 'g1' })], false);
  });
});
