import type { AssetCategory } from '@app/module/client';

/**
 * Where a reported asset opens in its own connector's UI, given that connector's base URL
 * (`connectors.listConnectors`'s own `url`, resolved per tenant server-side). `null` whenever the
 * connector is not configured on the platform or the source has no known deep link — never a dead
 * link.
 */
export const sourceExternalUrl = (
  source: string | null,
  sourceAssetId: string,
  connectorUrl: string | null,
  categoryId: AssetCategory,
): string | null => {
  if (connectorUrl === null || source === null) {
    return null;
  }
  // The base URL carries its trailing slash inconsistently across connectors (Defender's does,
  // OpenAEV's does not), so every path below is written against a base normalised to carry one.
  const base = connectorUrl.endsWith('/') ? connectorUrl : `${connectorUrl}/`;
  switch (source) {
    case 'microsoft_graph':
      if (categoryId !== 'identity') {
        return `${base}machines/v2/${sourceAssetId}/overview`;
      }
      // A directory record is keyed by its Entra object id; an account only Active Directory knows is
      // keyed `sid:…`, and Defender opens that one by its SID instead.
      return sourceAssetId.startsWith('sid:')
        ? `${base}user?sid=${encodeURIComponent(sourceAssetId.slice('sid:'.length))}&tab=overview`
        : `${base}user?aad=${encodeURIComponent(sourceAssetId)}&tab=overview`;
    case 'openaev':
      return `${base}admin/assets/${sourceAssetId}`;
    default:
      return null;
  }
};
