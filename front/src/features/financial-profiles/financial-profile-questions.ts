import type { QuestionId, SectionKey } from '@app/module/client';
import {
  LOSS_DRIVERS,
  LossDriver_CompetitiveAdvantageErosion,
  LossDriver_ContractualPenalties,
  LossDriver_CrisisCommunications,
  LossDriver_CustomerAttritionWinBack,
  LossDriver_ExtortionPayment,
  LossDriver_ForensicsIncidentManagement,
  LossDriver_IdentityCreditProtection,
  LossDriver_IncidentLegalCounsel,
  LossDriver_IncrementalOperatingCost,
  LossDriver_InternalResponseSurgeLabor,
  LossDriver_LitigationDefense,
  LossDriver_LostMarginFromDowntime,
  LossDriver_NotificationCallHandling,
  LossDriver_PaymentCardAssessments,
  LossDriver_RegulatoryFines,
  LossDriver_SettlementsDamages,
  LossDriver_StolenFundsNetOfRecovery,
  LossDriver_SystemDataRestoration,
} from '@app/module/client';
import { t } from '@lingui/core/macro';

/** Evaluated at render time, never at module scope, so each label resolves after locale activation. */
export const SECTION_TITLES: Record<SectionKey, () => string> = {
  A: () => t`A · Revenue and margin`,
  B: () => t`B · Digital dependency`,
  C: () => t`C · Data held`,
  D: () => t`D · Regulatory`,
  E: () => t`E · Customers and contracts`,
  F: () => t`F · Funds and IP`,
  G: () => t`G · Extortion`,
  H: () => t`H · Loss history`,
};

export const SECTION_INTROS: Record<SectionKey, () => string> = {
  A: () => t`How much money the business makes, and how much of it is margin.`,
  B: () => t`What stops, how fast it hurts, and how long it takes to come back.`,
  C: () => t`Magnitudes, not categories: how many records, of what kind.`,
  D: () => t`Supervision raises both fine exposure and the legal effort of an incident.`,
  E: () => t`Who leaves after an incident, and what your contracts oblige you to pay.`,
  F: () => t`What an attacker can move out, and what your research is worth.`,
  G: () => t`One posture question. Not a likelihood.`,
  H: () => t`What has already happened, and what it has already cost.`,
};

export const QUESTION_LABELS: Record<QuestionId, () => string> = {
  Q1: () => t`Annual revenue`,
  Q2: () => t`Gross margin`,
  Q3: () => t`Operating days per year`,
  Q5: () => t`Share of turnover that stops when IT stops`,
  Q6: () => t`Maximum tolerable downtime (MTD)`,
  Q7: () => t`Recovery time objective (RTO)`,
  Q8: () => t`Revenue recapture after the outage`,
  Q16: () => t`Restore test recency`,
  Q9a: () => t`Personal data held`,
  Q9b: () => t`Payment-card transactions`,
  Q9c: () => t`Sensitive records`,
  Q20: () => t`Largest single repository`,
  Q10: () => t`Regulatory regime`,
  Q11a: () => t`Customer base and B2C mix`,
  Q11b: () => t`Recurring revenue share`,
  Q12: () => t`Revenue under SLA or breach-liability clauses`,
  Q19: () => t`Contractual liability cap`,
  Q13: () => t`Outbound payment flows`,
  Q14: () => t`R&D and intellectual property value`,
  Q15: () => t`Ransom payment posture`,
  Q18: () => t`Revealed loss history`,
};

/** The catalog's own id → name lookup, kept single so a renamed row can never drift the two apart. */
export const DRIVER_NAME_BY_ID = new Map(LOSS_DRIVERS.map(({ id, name }) => [id, name]));

/**
 * Labels come from the seeded catalogue, so a chip names a driver exactly as the Loss Driver tab
 * does. An id the catalogue does not hold is dropped rather than shown raw.
 */
const names = (...ids: ReadonlyArray<string>): ReadonlyArray<string> => ids.flatMap((id) => DRIVER_NAME_BY_ID.get(id) ?? []);

/**
 * The seven drivers scaled on the restore band. Two cards reach exactly these, for one reason:
 * an untested restore and an outage that overran the target both cast doubt on the same duration,
 * so they widen the same maxes and must not drift apart in what they promise the reader.
 */
const RESTORE_DOUBT_DRIVERS = names(
  LossDriver_ForensicsIncidentManagement,
  LossDriver_InternalResponseSurgeLabor,
  LossDriver_SystemDataRestoration,
  LossDriver_LostMarginFromDowntime,
  LossDriver_IncrementalOperatingCost,
  LossDriver_ContractualPenalties,
  LossDriver_CustomerAttritionWinBack,
);

/**
 * The loss drivers each answer reaches, shown as chips on the card and on the read-only profile:
 * the reader can see what a blank costs before deciding to leave it blank.
 */
export const QUESTION_INFORMS: Record<QuestionId, () => ReadonlyArray<string>> = {
  // Revenue scales almost the whole catalogue; naming thirteen drivers here would say less than this.
  Q1: () => [t`All revenue-scaled drivers`],
  Q2: () => names(LossDriver_LostMarginFromDowntime, LossDriver_CustomerAttritionWinBack),
  Q3: () => names(LossDriver_LostMarginFromDowntime),
  Q5: () => names(LossDriver_LostMarginFromDowntime),
  Q6: () => names(LossDriver_LostMarginFromDowntime),
  Q7: () => names(LossDriver_LostMarginFromDowntime, LossDriver_IncrementalOperatingCost, LossDriver_SystemDataRestoration),
  Q8: () => names(LossDriver_LostMarginFromDowntime),
  Q16: () => RESTORE_DOUBT_DRIVERS,
  Q9a: () => names(LossDriver_NotificationCallHandling, LossDriver_IdentityCreditProtection, LossDriver_LitigationDefense, LossDriver_SettlementsDamages, LossDriver_RegulatoryFines),
  Q9b: () => names(LossDriver_PaymentCardAssessments),
  Q9c: () => names(LossDriver_NotificationCallHandling, LossDriver_RegulatoryFines),
  Q20: () => names(LossDriver_NotificationCallHandling, LossDriver_IdentityCreditProtection, LossDriver_SettlementsDamages),
  Q10: () => names(LossDriver_RegulatoryFines, LossDriver_IncidentLegalCounsel),
  Q11a: () => names(LossDriver_CrisisCommunications, LossDriver_LitigationDefense),
  Q11b: () => names(LossDriver_CustomerAttritionWinBack),
  Q12: () => names(LossDriver_ContractualPenalties, LossDriver_SettlementsDamages),
  Q19: () => names(LossDriver_SettlementsDamages, LossDriver_ContractualPenalties),
  Q13: () => names(LossDriver_StolenFundsNetOfRecovery),
  Q14: () => names(LossDriver_CompetitiveAdvantageErosion),
  Q15: () => names(LossDriver_ExtortionPayment),
  Q18: () => RESTORE_DOUBT_DRIVERS,
};
