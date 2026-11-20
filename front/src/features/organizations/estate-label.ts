import type { EstateMode } from '@app/module/client';
import { plural, t } from '@lingui/core/macro';

export const estateLabel = (scope: { estateMode: EstateMode, mappedAssetCount: number }): string => (
  scope.estateMode === 'open'
    ? t`Whole estate`
    : plural(scope.mappedAssetCount, { one: '# mapped asset', other: '# mapped assets' })
);
