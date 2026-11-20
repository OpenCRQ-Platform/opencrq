import type { OpenaevPostureTarget } from '@app/module';
import { createOpenaevClient } from './openaev-api-client';

/**
 * How long one live read of an asset's posture may take. The read sits behind a tile of the asset
 * page, so a slow OpenAEV dashboard engine must cost the page a missing tile, not a hung one; the
 * aggregation covers a handful of asset ids and answers in well under a second when healthy.
 */
export const POSTURE_READ_TIMEOUT_MS = 10_000;

export interface OpenaevConnection {
  url: string,
  token: string,
}

export interface PostureCounts {
  success: number,
  failed: number,
}

export interface ReadAssetPostureInput {
  /** The asset's OpenAEV sources, each with the OpenAEV tenant that serves it. */
  targets: Array<OpenaevPostureTarget>,
  /** The deployment's `connectors.openaev` block, keyed by OpenCRQ tenant id. */
  connections: Record<string, OpenaevConnection> | undefined,
  timeoutMs?: number,
}

/**
 * OpenAEV's raw SUCCESS/FAILED counts for one asset, read live and summed across its sources (a
 * merged asset can carry several, in one or several OpenAEV tenants). `null` when no source has a
 * counter: no target, no connection configured for its tenant, OpenAEV unreachable, slow or
 * failing, or an asset OpenAEV has never measured. Never throws on an OpenAEV failure.
 */
export const readAssetPosture = async ({
  targets,
  connections,
  timeoutMs = POSTURE_READ_TIMEOUT_MS,
}: ReadAssetPostureInput): Promise<PostureCounts | null> => {
  const idsByTenant = new Map<string, { connection: OpenaevConnection, openaevTenantId: string, sourceAssetIds: Array<string> }>();
  for (const { tenantId, openaevTenantId, sourceAssetId } of targets) {
    const connection = connections?.[tenantId];
    if (connection === undefined) {
      continue;
    }
    const key = `${tenantId}\u0000${openaevTenantId}`;
    const group = idsByTenant.get(key) ?? { connection, openaevTenantId, sourceAssetIds: [] };
    group.sourceAssetIds.push(sourceAssetId);
    idsByTenant.set(key, group);
  }
  if (idsByTenant.size === 0) {
    return null;
  }

  const signal = AbortSignal.timeout(timeoutMs);
  const answers = await Promise.all([...idsByTenant.values()].map(({ connection, openaevTenantId, sourceAssetIds }) =>
    createOpenaevClient(connection.url, connection.token, signal).fetchPostureCounters(openaevTenantId, sourceAssetIds)));

  const buckets = answers.flatMap((counters) => [...counters.values()]);
  if (buckets.length === 0) {
    return null;
  }
  return {
    success: buckets.reduce((total, bucket) => total + bucket.success, 0),
    failed: buckets.reduce((total, bucket) => total + bucket.failed, 0),
  };
};
