import { t } from '@lingui/core/macro';
import type { SupportingAssetExposure } from '@app/module/client';

export const getAssetExposureLabel = (exposure: SupportingAssetExposure): string => {
  const labels: Record<SupportingAssetExposure, string> = {
    internet_facing: t`Internet-facing`,
    internal: t`Internal`,
    unknown: t`Unknown`,
  };
  return labels[exposure];
};
