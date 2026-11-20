import { t } from '@lingui/core/macro';
import type { AssetCriticality } from '@app/module/client';

export const getAssetCriticalityLabel = (criticality: AssetCriticality): string => {
  const labels: Record<AssetCriticality, string> = {
    unknown: t`Unknown`,
    low: t`Low`,
    medium: t`Medium`,
    high: t`High`,
    very_high: t`Very High`,
  };
  return labels[criticality];
};
