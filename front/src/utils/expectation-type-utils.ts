import { t } from '@lingui/core/macro';
import type { ExpectationType } from '@app/module/client';

export const getExpectationTypeLabel = (expectationType: ExpectationType): string => {
  if (expectationType === 'detection') {
    return t`Detection`;
  }
  return t`Prevention`;
};
