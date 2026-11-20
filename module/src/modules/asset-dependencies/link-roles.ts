/** A link carries one or more, and `unknown` only alone: the table's check constraints hold the same rule. */
export const SUPPORT_TO_PRIMARY_LINK_ROLES = [
  'stores',
  'processes',
  'reads',
  'transmits',
  'administers',
  'monitors',
  'supports_availability',
  'performs',
  'unknown',
] as const;
export type SupportToPrimaryLinkRole = (typeof SUPPORT_TO_PRIMARY_LINK_ROLES)[number];

export const UNKNOWN_LINK_ROLE = 'unknown' satisfies SupportToPrimaryLinkRole;

export const SECURITY_CRITERIA = ['availability', 'integrity', 'confidentiality', 'traceability'] as const;
export type SecurityCriterion = (typeof SECURITY_CRITERIA)[number];

/** Ordered weakest first, so the strongest of several is the one with the highest index. */
export const CRITERION_INHERITANCES = ['none', 'lower', 'full'] as const;
export type CriterionInheritance = (typeof CRITERION_INHERITANCES)[number];

export type InheritedCriteria = Record<SecurityCriterion, CriterionInheritance>;

/** `unknown` inherits every criterion in full, so an unqualified link never counts for less than a qualified one. */
export const LINK_ROLE_INHERITANCE: Record<SupportToPrimaryLinkRole, InheritedCriteria> = {
  stores: { availability: 'full', integrity: 'full', confidentiality: 'full', traceability: 'lower' },
  processes: { availability: 'full', integrity: 'full', confidentiality: 'full', traceability: 'lower' },
  reads: { availability: 'lower', integrity: 'lower', confidentiality: 'full', traceability: 'none' },
  transmits: { availability: 'full', integrity: 'full', confidentiality: 'full', traceability: 'none' },
  administers: { availability: 'full', integrity: 'full', confidentiality: 'full', traceability: 'full' },
  monitors: { availability: 'none', integrity: 'none', confidentiality: 'lower', traceability: 'full' },
  supports_availability: { availability: 'full', integrity: 'none', confidentiality: 'none', traceability: 'none' },
  performs: { availability: 'full', integrity: 'full', confidentiality: 'lower', traceability: 'lower' },
  unknown: { availability: 'full', integrity: 'full', confidentiality: 'full', traceability: 'full' },
};

const NOTHING_INHERITED: InheritedCriteria = { availability: 'none', integrity: 'none', confidentiality: 'none', traceability: 'none' };

const stronger = (a: CriterionInheritance, b: CriterionInheritance): CriterionInheritance =>
  (CRITERION_INHERITANCES.indexOf(a) >= CRITERION_INHERITANCES.indexOf(b) ? a : b);

/** An empty list inherits nothing. */
export const combineInheritedCriteria = (all: Array<InheritedCriteria>): InheritedCriteria =>
  all.reduce((acc, criteria) => ({
    availability: stronger(acc.availability, criteria.availability),
    integrity: stronger(acc.integrity, criteria.integrity),
    confidentiality: stronger(acc.confidentiality, criteria.confidentiality),
    traceability: stronger(acc.traceability, criteria.traceability),
  }), NOTHING_INHERITED);

export const inheritedCriteriaOfRoles = (roles: ReadonlyArray<SupportToPrimaryLinkRole>): InheritedCriteria =>
  combineInheritedCriteria(roles.map((role) => LINK_ROLE_INHERITANCE[role]));

/** At least one role, and `unknown` only alone. */
export const isStorableLinkRoleSet = (roles: ReadonlyArray<SupportToPrimaryLinkRole>): boolean =>
  roles.length > 0 && (!roles.includes(UNKNOWN_LINK_ROLE) || roles.every((role) => role === UNKNOWN_LINK_ROLE));

/** Duplicates dropped and the list's own order, so two equal selections store the same array. */
export const canonicalLinkRoles = (roles: ReadonlyArray<SupportToPrimaryLinkRole>): Array<SupportToPrimaryLinkRole> =>
  SUPPORT_TO_PRIMARY_LINK_ROLES.filter((role) => roles.includes(role));
