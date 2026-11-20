import type { RepositoryContext } from '../../registry';
import { eq, sql } from 'drizzle-orm';

/**
 * Whether each asset is enabled, as the door reads it: an identity is disabled only when every
 * observation that fills `is_enabled` says so, `bool_or` skipping the nulls, and an asset with no
 * such observation reads as enabled. Left-join `observedEnabled` and read `identityEnabled`.
 *
 * `onlyAssetId` bounds the aggregation to one asset, so reading a single asset's state does not
 * aggregate the tenant's identity observations.
 */
export const enabledIdentitiesOf = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  onlyAssetId?: string,
) => {
  const observedEnabled = db
    .select({
      supportingAssetId: views.supportingAssetSources.supportingAssetId,
      enabled: sql<boolean | null>`bool_or(${views.supportingAssetIdentityProperties.isEnabled})`.as('observed_enabled'),
    })
    .from(views.supportingAssetSources)
    .innerJoin(
      views.supportingAssetIdentityProperties,
      eq(views.supportingAssetIdentityProperties.supportingAssetSourceId, views.supportingAssetSources.id),
    )
    .where(onlyAssetId === undefined ? undefined : eq(views.supportingAssetSources.supportingAssetId, onlyAssetId))
    .groupBy(views.supportingAssetSources.supportingAssetId)
    .as('asset_observed_enabled');
  return { observedEnabled, identityEnabled: sql<boolean>`coalesce(${observedEnabled.enabled}, true)` };
};
