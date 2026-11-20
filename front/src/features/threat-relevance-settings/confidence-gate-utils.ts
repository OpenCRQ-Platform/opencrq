import { t } from '@lingui/core/macro';

// Wording and order are part of the setting's contract: renaming or reordering a level changes
// what an already-stored value means to the user who chose it.
export const confidenceGateLevelLabel = (level: number): string => {
  switch (level) {
    case 100: return t`confirmed (100)`;
    case 80: return t`confirmed by other sources (80)`;
    case 60: return t`probably true (60)`;
    case 40: return t`possibly true (40)`;
    case 20: return t`doubtful (20)`;
    case 0: return t`improbable (0)`;
    // Off the six-level ladder (stored value predates it, or a future level): the number itself
    // is still the truth, unlike a wording that would claim a rung this value never sat on.
    default: return String(level);
  }
};
