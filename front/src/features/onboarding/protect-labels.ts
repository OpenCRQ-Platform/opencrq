import { plural, t } from '@lingui/core/macro';
import type { ProtectTemplateKey } from './protect-utils';

export const protectTemplateName = (key: ProtectTemplateKey): string => {
  switch (key) {
    case 'customer-data': return t`Customer data`;
    case 'payments-and-treasury': return t`Payments and treasury`;
    case 'production-and-operations': return t`Production and operations`;
    case 'hr-data': return t`HR data`;
    case 'intellectual-property': return t`Intellectual property`;
    case 'email-and-collaboration': return t`Email and collaboration`;
  }
};

export const primaryAssetsCountLabel = (count: number): string => plural(count, { one: '# primary asset in this scope', other: '# primary assets in this scope' });
