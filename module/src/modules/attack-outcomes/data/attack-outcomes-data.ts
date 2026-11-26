import type { CriterionInheritance, SecurityCriterion } from '../../asset-dependencies/link-roles';
import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_DataTheftExtortion,
  AttackOutcome_DestructiveAttack,
  AttackOutcome_Espionage,
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_Ransomware,
  AttackOutcome_ServiceDisruption,
} from './attack-outcomes-ids';

/**
 * The attack-outcome catalog, the single source reseeded into every tenant on boot.
 *
 * `name` is a label only: it can be edited freely and reseeded, nothing anywhere resolves a row by
 * it. The ids live in `attack-outcomes-ids.ts` and must never be regenerated.
 *
 * User-facing estimation guidance belongs in the frontend translation catalogs, not here, because
 * the backend never translates.
 */

/**
 * The single tactic whose success realizes an outcome. Data outcomes end on exfiltration (gathered
 * data required), disruption outcomes on impact (deep access suffices). Adding an outcome means
 * declaring its terminal here, never editing the walk's prerequisites table.
 */
export type TerminalTacticExternalId = 'TA0010' | 'TA0040';

export type CriteriaReached = Record<SecurityCriterion, CriterionInheritance>;

export interface AttackOutcomeReference {
  id: string,
  name: string,
  description: string,
  /** Reference dwell, in days: shown on the attack outcome's overview page, read by no engine. */
  referenceDwellDays: number,
  /**
   * `full` when the loss cannot happen without breaching the criterion on the primary asset, `lower`
   * when the breach adds a secondary share, `none` when no loss driver depends on it. At least one
   * criterion is above `none`, since the share of the attack a link transmits divides by their sum.
   */
  criteriaReached: CriteriaReached,
  terminalTacticExternalId: TerminalTacticExternalId,
  signatureTechniqueExternalIds: ReadonlyArray<string>,
  relatedTechniqueExternalIds: ReadonlyArray<string>,
}

/**
 * The attack outcomes, each carrying the dwell time used as the median of its distribution.
 *
 * Reference dwell is expressed in days, while an organization's reaction time is stored in hours;
 * the two meet only in the kernel, which owns the conversion.
 *
 * Curated technique identifiers must resolve to a non-revoked entry of the vendored MITRE dataset:
 * an unknown or revoked identifier is silently skipped when the junction rows are built, so the
 * association is simply lost. Credential-access techniques are deliberately attached to no outcome:
 * stealing a credential is a step on the attack path, not an end state.
 */
export const ATTACK_OUTCOMES: ReadonlyArray<AttackOutcomeReference> = [
  {
    id: AttackOutcome_Ransomware,
    terminalTacticExternalId: 'TA0040',
    name: 'Ransomware',
    description: 'Encryption-led extortion monetized by ransom, with exfiltration usually riding along.',
    referenceDwellDays: 3,
    criteriaReached: { availability: 'full', integrity: 'lower', confidentiality: 'full', traceability: 'none' },
    signatureTechniqueExternalIds: ['T1486', 'T1490', 'T1489', 'T1657'],
    relatedTechniqueExternalIds: ['T1048', 'T1567'],
  },
  {
    id: AttackOutcome_DataTheftExtortion,
    terminalTacticExternalId: 'TA0010',
    name: 'Data Theft Extortion',
    description: 'Data copied and monetized through publication or suppression pressure, without encryption.',
    referenceDwellDays: 5,
    criteriaReached: { availability: 'none', integrity: 'none', confidentiality: 'full', traceability: 'none' },
    signatureTechniqueExternalIds: ['T1657', 'T1567', 'T1048', 'T1530', 'T1020'],
    relatedTechniqueExternalIds: ['T1560', 'T1074', 'T1029', 'T1030'],
  },
  {
    id: AttackOutcome_DataBreachResale,
    terminalTacticExternalId: 'TA0010',
    name: 'Data Breach & Resale',
    description: 'Data copied and monetized away from the victim, learned through disclosure or downstream fraud.',
    referenceDwellDays: 21,
    criteriaReached: { availability: 'none', integrity: 'none', confidentiality: 'full', traceability: 'none' },
    signatureTechniqueExternalIds: ['T1041', 'T1048', 'T1567', 'T1005', 'T1213', 'T1530'],
    relatedTechniqueExternalIds: ['T1560', 'T1074', 'T1029', 'T1030', 'T1040'],
  },
  {
    id: AttackOutcome_FinancialFraudFundsTheft,
    terminalTacticExternalId: 'TA0040',
    name: 'Financial Fraud & Funds Theft',
    description: 'Money obtained directly through business email compromise, payment diversion, payroll fraud and payment-infrastructure raids.',
    referenceDwellDays: 5,
    criteriaReached: { availability: 'none', integrity: 'full', confidentiality: 'none', traceability: 'lower' },
    signatureTechniqueExternalIds: ['T1657', 'T1534', 'T1114.003', 'T1565'],
    relatedTechniqueExternalIds: ['T1566', 'T1078', 'T1114'],
  },
  {
    id: AttackOutcome_Espionage,
    terminalTacticExternalId: 'TA0010',
    name: 'Espionage',
    description: 'Sustained covert collection of strategic information.',
    referenceDwellDays: 122,
    criteriaReached: { availability: 'none', integrity: 'none', confidentiality: 'full', traceability: 'none' },
    signatureTechniqueExternalIds: ['T1114', 'T1213', 'T1039', 'T1005', 'T1040', 'T1020'],
    relatedTechniqueExternalIds: ['T1014', 'T1070', 'T1542', 'T1133', 'T1685', 'T1113', 'T1056'],
  },
  {
    id: AttackOutcome_ServiceDisruption,
    terminalTacticExternalId: 'TA0040',
    name: 'Service Disruption',
    description: 'Interruption of a service as the end state itself.',
    referenceDwellDays: 1,
    criteriaReached: { availability: 'full', integrity: 'none', confidentiality: 'none', traceability: 'none' },
    signatureTechniqueExternalIds: ['T1498', 'T1499', 'T1489', 'T1529', 'T1565'],
    relatedTechniqueExternalIds: ['T1490', 'T1531'],
  },
  {
    id: AttackOutcome_DestructiveAttack,
    terminalTacticExternalId: 'TA0040',
    name: 'Destructive Attack',
    description: 'Irreversible damage with no monetization channel.',
    referenceDwellDays: 30,
    criteriaReached: { availability: 'full', integrity: 'full', confidentiality: 'none', traceability: 'none' },
    signatureTechniqueExternalIds: ['T1485', 'T1561', 'T1495', 'T1490', 'T1529'],
    relatedTechniqueExternalIds: ['T1542'],
  },
];
