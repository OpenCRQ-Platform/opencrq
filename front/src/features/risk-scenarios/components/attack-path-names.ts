import { t } from '@lingui/core/macro';
import type { AttackPathKey } from '../attack-paths-utils';

export const attackPathNames = (): Record<AttackPathKey, string> => ({
  outside_perimeter: t`Outside the perimeter`,
  access_held_or_outside_perimeter: t`Access held or outside the perimeter`,
});
