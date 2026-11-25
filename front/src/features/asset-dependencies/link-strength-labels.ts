import type { PrimaryToPrimaryLinkStrength } from '@app/module/client';
import { t } from '@lingui/core/macro';

export const getLinkStrengthLabel = (strength: PrimaryToPrimaryLinkStrength): string => {
  const labels: Record<PrimaryToPrimaryLinkStrength, string> = {
    critical: t({ message: 'Critical', context: 'strength of a dependency' }),
    important: t({ message: 'Important', context: 'strength of a dependency' }),
    minor: t({ message: 'Minor', context: 'strength of a dependency' }),
    unknown: t({ message: 'Unknown', context: 'strength of a dependency' }),
  };
  return labels[strength];
};
