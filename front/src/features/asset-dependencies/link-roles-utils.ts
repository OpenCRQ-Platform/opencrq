import type { SecurityCriterion, SupportToPrimaryLinkRole } from '@app/module/client';
import { canonicalLinkRoles, SECURITY_CRITERIA, UNKNOWN_LINK_ROLE } from '@app/module/client';

const CIA_ORDER: ReadonlyArray<SecurityCriterion> = ['confidentiality', 'integrity', 'availability', 'traceability'];

/** French readers expect the DICT order, English ones the CIA triad of ISO/IEC 27000. */
export const securityCriteriaOrder = (locale: string): ReadonlyArray<SecurityCriterion> =>
  (locale.startsWith('fr') ? SECURITY_CRITERIA : CIA_ORDER);

/**
 * The selection after one role is clicked: picking a role drops `unknown`, picking `unknown` drops
 * every other role, and clearing the last role falls back to `unknown`.
 */
export const toggleLinkRole = (
  selection: ReadonlyArray<SupportToPrimaryLinkRole>,
  role: SupportToPrimaryLinkRole,
): Array<SupportToPrimaryLinkRole> => {
  if (role === UNKNOWN_LINK_ROLE) {
    return [UNKNOWN_LINK_ROLE];
  }
  const known = selection.filter((selected) => selected !== UNKNOWN_LINK_ROLE);
  const next = known.includes(role) ? known.filter((selected) => selected !== role) : [...known, role];
  return next.length === 0 ? [UNKNOWN_LINK_ROLE] : canonicalLinkRoles(next);
};
