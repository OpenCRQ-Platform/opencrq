import { t } from '@lingui/core/macro';
import type { AssetIdentityProvider } from '@app/module/client';

/**
 * Which directory the account lives in. A person states it; the connector derives it from the SID
 * it knew — a cloud SID means Entra, an on-premises one means Active Directory — so a provider it
 * never states is an account carrying neither rather than one of unknown provenance.
 */
export const getAssetIdentityProviderLabel = (provider: string): string => {
  const labels: Record<AssetIdentityProvider, string> = {
    entra: t`Microsoft Entra ID`,
    active_directory: t`Active Directory`,
  };
  return (labels as Record<string, string>)[provider] ?? provider;
};
