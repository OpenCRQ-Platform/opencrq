import type { CriterionInheritance, SecurityCriterion, SupportToPrimaryLinkRole } from '@app/module/client';
import { t } from '@lingui/core/macro';

export const getLinkRoleLabel = (role: SupportToPrimaryLinkRole): string => {
  const labels: Record<SupportToPrimaryLinkRole, string> = {
    stores: t`Stores`,
    processes: t`Processes`,
    reads: t`Reads / renders`,
    transmits: t`Transmits`,
    administers: t`Controls / administers`,
    monitors: t`Logs / monitors`,
    supports_availability: t`Supports availability`,
    performs: t`Performs / executes`,
    unknown: t({ message: 'Unknown', context: 'role of a dependency' }),
  };
  return labels[role];
};

/** The role as a verb whose object is the primary asset: "Power BI Workspace reads Card Transaction Data". */
export const getLinkRoleVerb = (role: SupportToPrimaryLinkRole): string => {
  const verbs: Record<SupportToPrimaryLinkRole, string> = {
    stores: t({ message: 'stores', context: 'a supporting asset ... a primary asset' }),
    processes: t({ message: 'processes', context: 'a supporting asset ... a primary asset' }),
    reads: t({ message: 'reads', context: 'a supporting asset ... a primary asset' }),
    transmits: t({ message: 'transmits', context: 'a supporting asset ... a primary asset' }),
    administers: t({ message: 'administers', context: 'a supporting asset ... a primary asset' }),
    monitors: t({ message: 'monitors', context: 'a supporting asset ... a primary asset' }),
    supports_availability: t({ message: 'keeps available', context: 'a supporting asset ... a primary asset' }),
    performs: t({ message: 'performs', context: 'a supporting asset ... a primary asset' }),
    unknown: t({ message: 'supports', context: 'a supporting asset ... a primary asset' }),
  };
  return verbs[role];
};

export const getSecurityCriterionLabel =(criterion: SecurityCriterion): string => {
  const labels: Record<SecurityCriterion, string> = {
    availability: t`Availability`,
    integrity: t`Integrity`,
    confidentiality: t`Confidentiality`,
    traceability: t`Traceability`,
  };
  return labels[criterion];
};

export const getSecurityCriterionLetter = (criterion: SecurityCriterion): string => {
  const letters: Record<SecurityCriterion, string> = {
    availability: t({ message: 'A', context: 'initial of Availability' }),
    integrity: t({ message: 'I', context: 'initial of Integrity' }),
    confidentiality: t({ message: 'C', context: 'initial of Confidentiality' }),
    traceability: t({ message: 'T', context: 'initial of Traceability' }),
  };
  return letters[criterion];
};

export const getCriterionInheritanceHint = (criterion: SecurityCriterion, inheritance: CriterionInheritance): string => {
  const name = getSecurityCriterionLabel(criterion);
  const labels: Record<CriterionInheritance, string> = {
    full: t`${name}: inherited`,
    lower: t`${name}: one notch lower`,
    none: t`${name}: not inherited`,
  };
  return labels[inheritance];
};

export const getCriterionInheritanceWord = (inheritance: CriterionInheritance): string => {
  const labels: Record<CriterionInheritance, string> = {
    full: t`inherited`,
    lower: t`one notch lower`,
    none: t`not inherited`,
  };
  return labels[inheritance];
};

export const getCriterionReachWord = (reach: CriterionInheritance): string => {
  const labels: Record<CriterionInheritance, string> = {
    full: t({ message: 'reached', context: 'security criterion an attack outcome reaches' }),
    lower: t({ message: 'partly reached', context: 'security criterion an attack outcome reaches' }),
    none: t({ message: 'not reached', context: 'security criterion an attack outcome reaches' }),
  };
  return labels[reach];
};

export const getReachedCriterionChipLabel = (criterion: SecurityCriterion, reach: CriterionInheritance): string => {
  const name = getSecurityCriterionLabel(criterion);
  const labels: Record<CriterionInheritance, string> = {
    full: t`${name} reached`,
    lower: t`${name} partly reached`,
    none: t`${name} not reached`,
  };
  return labels[reach];
};

export const getInheritedCriterionChipLabel =(criterion: SecurityCriterion, inheritance: CriterionInheritance): string => {
  const name = getSecurityCriterionLabel(criterion);
  const labels: Record<CriterionInheritance, string> = {
    full: name,
    lower: t`${name}, one notch lower`,
    none: t`${name}, not inherited`,
  };
  return labels[inheritance];
};
