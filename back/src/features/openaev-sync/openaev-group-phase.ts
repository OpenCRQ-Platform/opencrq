import type { OpenaevAssetGroup } from './openaev-types';
import type { createOpenaevClient } from './openaev-api-client';
import { createLogger } from '../../utils/logger';

const { logTrace, logFromError } = createLogger({ feature: 'openaev-sync' });

export type ConnectorAssetGroup = { sourceGroupId: string, name: string, description: string | null, supportingAssetIds: Array<string> };

/**
 * OpenAEV's groups of one tenant as the connector reports them (#3152, section 2): a group keyed on
 * its OpenAEV id, with its static members and the members its dynamic filter resolved at this read,
 * each mapped to the OpenCRQ asset the inventory folded it onto. A member the inventory does not know
 * (an asset outside the synced categories, a security platform before its category existed) is left
 * out, never created.
 */
export const toConnectorAssetGroups = (groups: ReadonlyArray<OpenaevAssetGroup>, assetIdMap: ReadonlyMap<string, string>): Array<ConnectorAssetGroup> =>
  groups.map((group) => {
    const members = new Set<string>();
    for (const sourceAssetId of [...(group.asset_group_assets ?? []), ...(group.asset_group_dynamic_assets ?? [])]) {
      const supportingAssetId = assetIdMap.get(sourceAssetId);
      if (supportingAssetId !== undefined) {
        members.add(supportingAssetId);
      }
    }
    return {
      sourceGroupId: group.asset_group_id,
      name: group.asset_group_name,
      description: group.asset_group_description ?? null,
      supportingAssetIds: [...members],
    };
  });

/**
 * Reads every OpenAEV tenant's groups and mirrors them in one write. One tenant's read failing makes
 * the listing incomplete: its groups are still written from the tenants that answered, and no group
 * of this connector is deleted in that run, so an OpenAEV outage never empties the groups.
 */
export const syncAssetGroups = async ({ client, svc, connectorId, openaevTenantIds, assetIdMapByTenant }: {
  client: Pick<ReturnType<typeof createOpenaevClient>, 'listAssetGroups'>,
  svc: { supportingAssets: { syncConnectorAssetGroups: (connectorId: string, groups: Array<ConnectorAssetGroup>, complete: boolean) => Promise<{ groups: number, membersAdded: number, membersRemoved: number, groupsDeleted: number }> } },
  connectorId: string,
  openaevTenantIds: ReadonlyArray<string>,
  assetIdMapByTenant: ReadonlyMap<string, ReadonlyMap<string, string>>,
}) => {
  const groups: Array<ConnectorAssetGroup> = [];
  let complete = true;
  for (const openaevTenantId of openaevTenantIds) {
    try {
      const listed = await client.listAssetGroups(openaevTenantId);
      groups.push(...toConnectorAssetGroups(listed, assetIdMapByTenant.get(openaevTenantId) ?? new Map()));
    } catch (err) {
      complete = false;
      logFromError(err, 'OpenAEV asset groups could not be read: groups kept as they are for this tenant', { openaevTenantId });
    }
  }
  const result = await svc.supportingAssets.syncConnectorAssetGroups(connectorId, groups, complete);
  logTrace('OpenAEV asset groups mirrored', { ...result, complete });
  return result;
};
