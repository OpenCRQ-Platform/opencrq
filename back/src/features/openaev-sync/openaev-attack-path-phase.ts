import type { AssetRelationSource } from '@app/module';
import type { AttackPathGraph } from './openaev-types';
import type { createOpenaevClient } from './openaev-api-client';
import { createLogger } from '../../utils/logger';

const { logTrace, logFromError } = createLogger({ feature: 'openaev-sync' });

/** The node type OpenAEV gives an asset on an attack path (the other ends are injectors, findings). */
const ASSET_NODE_TYPE = 'ASSET';

/**
 * One hop OpenAEV showed in a simulation, read from the asset reached to the asset it was reached
 * from, the way a `reachable_from` relation is stored.
 */
export type AttackPathHop = {
  fromAssetId: string,
  toAssetId: string,
  source: Extract<AssetRelationSource, 'openaev_attack_path_proven' | 'openaev_attack_path_inferred'>,
  evidenceRef: string,
};

/**
 * The verdict of the executions that reached an asset, as the collapsed graph colours it: RED got
 * through unseen, ORANGE got through seen, GREEN was prevented. A prevented hop is no way in and is
 * left out; a hop with no verdict yet (planned, or still running) is kept as inferred.
 */
const hopSourceOf = (status: string | null | undefined): AttackPathHop['source'] | null => {
  if (status === 'RED' || status === 'ORANGE') {
    return 'openaev_attack_path_proven';
  }
  if (status === 'GREEN') {
    return null;
  }
  return 'openaev_attack_path_inferred';
};

/**
 * The asset-to-asset hops of one simulation's collapsed graph whose two ends are in the inventory.
 * An edge from an injector is the way into the first asset, not a hop between two assets, and an
 * end the inventory does not hold (a discovered host, a team) is left out, never created. The
 * verdict is the reached asset's, the worst over the executions that reached it: the collapsed graph
 * carries no verdict per edge.
 */
export const toAttackPathHops = (
  graph: AttackPathGraph,
  simulationId: string,
  assetIdMap: ReadonlyMap<string, string>,
): Array<AttackPathHop> => {
  const assetNodes = new Map<string, { assetId: string, status: string | null | undefined }>();
  for (const node of graph.attackPathNodes ?? []) {
    const assetId = node.type === ASSET_NODE_TYPE && node.ref ? assetIdMap.get(node.ref) : undefined;
    if (assetId !== undefined) {
      assetNodes.set(node.id, { assetId, status: node.status });
    }
  }
  const hops = new Map<string, AttackPathHop>();
  for (const edge of graph.attackPathEdges ?? []) {
    const from = assetNodes.get(edge.edgeSourceId);
    const to = assetNodes.get(edge.edgeTargetId);
    if (from === undefined || to === undefined || from.assetId === to.assetId) {
      continue;
    }
    const source = hopSourceOf(to.status);
    if (source === null) {
      continue;
    }
    const key = `${to.assetId}:${from.assetId}`;
    const held = hops.get(key);
    if (held === undefined || (held.source === 'openaev_attack_path_inferred' && source === 'openaev_attack_path_proven')) {
      hops.set(key, { fromAssetId: to.assetId, toAssetId: from.assetId, source, evidenceRef: simulationId });
    }
  }
  return [...hops.values()];
};

/**
 * Two simulations showing the same hop keep one: the proven one before the inferred one, then the
 * later simulation as listed. A relation is keyed on its two ends, so it records the strongest
 * evidence the run saw.
 */
export const mergeAttackPathHops = (hops: ReadonlyArray<AttackPathHop>): Array<AttackPathHop> => {
  const merged = new Map<string, AttackPathHop>();
  for (const hop of hops) {
    const key = `${hop.fromAssetId}:${hop.toAssetId}`;
    const held = merged.get(key);
    if (held === undefined || held.source === 'openaev_attack_path_inferred' || hop.source === 'openaev_attack_path_proven') {
      merged.set(key, hop);
    }
  }
  return [...merged.values()];
};

/**
 * Reads the attack path of every simulation of every OpenAEV tenant and writes its asset-to-asset
 * hops as `reachable_from` relations. Nothing is retired by the sync: a hop OpenAEV stops showing is
 * kept and reads as stale once `ATTACK_PATH_STALE_AFTER_DAYS` pass without a new report, so a
 * simulation purged in OpenAEV or an outage never erases what a test proved. A tenant or a
 * simulation whose read fails is logged and skipped; the others are still written.
 */
export const syncAttackPaths = async ({ client, svc, connectorId, openaevTenantIds, assetIdMapByTenant, observedAt }: {
  client: Pick<ReturnType<typeof createOpenaevClient>, 'listAttackPathSimulations' | 'getAttackPathGraph'>,
  svc: {
    supportingAssets: {
      reconcileConnectorRelations: (params: {
        connectorId: string,
        kind: 'reachable_from',
        observedAt: Date,
        relations: ReadonlyArray<AttackPathHop>,
        retiredIds: ReadonlyArray<string>,
      }) => Promise<{ written: number, removed: number }>,
    },
  },
  connectorId: string,
  openaevTenantIds: ReadonlyArray<string>,
  assetIdMapByTenant: ReadonlyMap<string, ReadonlyMap<string, string>>,
  observedAt: Date,
}) => {
  const hops: Array<AttackPathHop> = [];
  let simulations = 0;
  let skipped = 0;
  for (const openaevTenantId of openaevTenantIds) {
    const assetIdMap = assetIdMapByTenant.get(openaevTenantId) ?? new Map<string, string>();
    let listed;
    try {
      listed = await client.listAttackPathSimulations(openaevTenantId);
    } catch (err) {
      logFromError(err, 'OpenAEV attack paths could not be listed: relations kept as they are for this tenant', { openaevTenantId });
      continue;
    }
    for (const { simulationId } of listed) {
      try {
        hops.push(...toAttackPathHops(await client.getAttackPathGraph(openaevTenantId, simulationId), simulationId, assetIdMap));
        simulations += 1;
      } catch (err) {
        skipped += 1;
        logFromError(err, 'OpenAEV attack path could not be read: simulation skipped', { openaevTenantId, simulationId });
      }
    }
  }
  const relations = mergeAttackPathHops(hops);
  if (relations.length === 0) {
    logTrace('OpenAEV attack paths read: no hop between two inventory assets', { simulations, skipped });
    return { simulations, skipped, written: 0, removed: 0 };
  }
  const result = await svc.supportingAssets.reconcileConnectorRelations({
    connectorId,
    kind: 'reachable_from',
    observedAt,
    relations,
    retiredIds: [],
  });
  logTrace('OpenAEV attack paths mirrored', { simulations, skipped, hops: relations.length, written: result.written });
  return { simulations, skipped, ...result };
};
