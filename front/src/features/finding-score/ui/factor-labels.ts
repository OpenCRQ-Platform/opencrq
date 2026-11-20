import { t } from '@lingui/core/macro';
import type { ScorePart } from '@app/module/client';

export const scorePartLabel = (part: ScorePart): string => {
  switch (part) {
    case 'exploitability': return t`Exploitability`;
    case 'impact': return t`Impact`;
  }
};
