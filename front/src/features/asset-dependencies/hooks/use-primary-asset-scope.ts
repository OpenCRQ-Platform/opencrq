import { skipToken, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTRPC } from '../../../lib';

/**
 * The risk scope a primary asset's page lives under, which a page on the whole scope does not carry
 * in its address: the asset's own is read then, and is undefined until it arrives.
 */
export const usePrimaryAssetScope = (primaryAssetId: string | undefined): string | undefined => {
  const trpc = useTRPC();
  const { organizationId } = useParams({ strict: false });
  const { data } = useQuery(trpc.primaryAssets.getPrimaryAsset.queryOptions(
    organizationId !== undefined || primaryAssetId === undefined ? skipToken : { id: primaryAssetId },
  ));
  return organizationId ?? data?.organizationId;
};
