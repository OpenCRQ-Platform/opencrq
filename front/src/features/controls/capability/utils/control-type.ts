import type { CapabilityEdge } from '../types/capability';

export type ControlType = 'preventive' | 'detective' | 'preventive-and-detective';

/**
 * The control's type, read off its effective coverage rather than declared anywhere: a control
 * that only prevents is preventive, one that only detects is detective, one that does both is
 * both. Type semantics live in the edge functions, so this follows the tenant's own additions
 * and removals with no second source of truth to keep in sync.
 *
 * A removed edge covers nothing and therefore contributes no type. A control the tenant has
 * emptied entirely has no type at all, which is why this returns null rather than a default.
 */
export const deriveControlType = (edges: ReadonlyArray<CapabilityEdge>): ControlType | null => {
  const active = edges.filter((edge) => edge.state !== 'removed');
  const prevents = active.some((edge) => edge.function === 'prevent');
  const detects = active.some((edge) => edge.function === 'detect');

  if (prevents && detects) {
    return 'preventive-and-detective';
  }
  if (prevents) {
    return 'preventive';
  }
  if (detects) {
    return 'detective';
  }
  return null;
};
