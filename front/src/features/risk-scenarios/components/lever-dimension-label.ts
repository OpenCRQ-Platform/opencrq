import type { CrqControlWhatIfDimension } from '@app/module/client';
import { t } from '@lingui/core/macro';

export const leverDimensionLabel = (dimension: CrqControlWhatIfDimension): string => {
  switch (dimension) {
    case 'strength': return t`Strength`;
    case 'coverage': return t`Coverage`;
    case 'deploy': return t`Deployment`;
  }
};
