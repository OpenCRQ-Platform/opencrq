import type { CoverageBucket } from '@app/module/client';
import { t } from '@lingui/core/macro';

export const coverageLabel = (bucket: CoverageBucket): string => {
  switch (bucket) {
    case 'L0': return t`None`;
    case 'L1': return t`Partial`;
    case 'L2': return t`Broad`;
    case 'L3': return t`Full`;
    default: return bucket;
  }
};
