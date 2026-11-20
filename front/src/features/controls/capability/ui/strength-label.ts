import { t } from '@lingui/core/macro';

// User-facing strength-rung labels. The stored codes stay L0-L3 (catalogue source of truth).
export const strengthLabel = (rung: string): string => {
  switch (rung) {
    case 'L0': return t`Not deployed`;
    case 'L1': return t`Basic`;
    case 'L2': return t`Intermediate`;
    case 'L3': return t`Master`;
    default: return rung;
  }
};
