import type { DriverContext, DriverOutput } from './derive-estimates-drivers';
import type {
  ActivationSetInput,
  DerivationResult,
  DriverEstimate,
  FinancialProfileInput,
  OrganizationInput,
  SanityWarning,
} from './derive-estimates-types';
import { LOSS_ACTIVATION_MATRIX } from './data/loss-activation-matrix';
import {
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
} from './data/loss-drivers-ids';
import { COEFFICIENT_SET_V3 } from './derive-estimates-coefficients';
import {
  deriveD1_1,
  deriveD1_2,
  deriveD1_3,
  deriveD1_4,
  deriveD2_1,
  deriveD3_1,
  deriveD3_2,
  deriveD4_1,
  deriveD5_1,
  deriveD6_1,
  deriveD6_2,
  deriveD7_1,
  deriveD7_2,
  deriveD7_3,
  deriveD7_4,
  deriveD7_5,
  deriveD8_1,
  deriveD8_2,
} from './derive-estimates-drivers';
import { deriveSizeClass, evaluateSanityWarnings, resolveAnnualRevenueUsd, resolveLoadedDailyLabourCostUsd } from './derive-estimates-helpers';

/**
 * The eighteen derivable drivers, D2.2 Hardware & equipment replacement never among them: it has no
 * honest organization-level input and this kernel never calls a formula for
 * it, in any input configuration.
 */
export const DRIVER_FORMULAS: ReadonlyArray<{ lossDriverId: string, derive: (ctx: DriverContext) => DriverOutput }> = [
  { lossDriverId: LossDriver_ForensicsIncidentManagement, derive: deriveD1_1 },
  { lossDriverId: LossDriver_IncidentLegalCounsel, derive: deriveD1_2 },
  { lossDriverId: LossDriver_CrisisCommunications, derive: deriveD1_3 },
  { lossDriverId: LossDriver_InternalResponseSurgeLabor, derive: deriveD1_4 },
  { lossDriverId: LossDriver_SystemDataRestoration, derive: deriveD2_1 },
  { lossDriverId: LossDriver_LostMarginFromDowntime, derive: deriveD3_1 },
  { lossDriverId: LossDriver_IncrementalOperatingCost, derive: deriveD3_2 },
  { lossDriverId: LossDriver_ExtortionPayment, derive: deriveD4_1 },
  { lossDriverId: LossDriver_StolenFundsNetOfRecovery, derive: deriveD5_1 },
  { lossDriverId: LossDriver_NotificationCallHandling, derive: deriveD6_1 },
  { lossDriverId: LossDriver_IdentityCreditProtection, derive: deriveD6_2 },
  { lossDriverId: LossDriver_LitigationDefense, derive: deriveD7_1 },
  { lossDriverId: LossDriver_SettlementsDamages, derive: deriveD7_2 },
  { lossDriverId: LossDriver_RegulatoryFines, derive: deriveD7_3 },
  { lossDriverId: LossDriver_PaymentCardAssessments, derive: deriveD7_4 },
  { lossDriverId: LossDriver_ContractualPenalties, derive: deriveD7_5 },
  { lossDriverId: LossDriver_CustomerAttritionWinBack, derive: deriveD8_1 },
  { lossDriverId: LossDriver_CompetitiveAdvantageErosion, derive: deriveD8_2 },
];

const deriveActivatedSets = (activationSet: ActivationSetInput): { driverIds: ReadonlySet<string>, categoryIds: ReadonlySet<string> } => {
  const cellKeys = new Set(activationSet.map((cell) => `${cell.attackOutcomeCatalogId}/${cell.businessValueCategoryCatalogId}`));
  const driverIds = new Set<string>();
  for (const cell of LOSS_ACTIVATION_MATRIX) {
    if (cellKeys.has(`${cell.attackOutcomeId}/${cell.businessValueCategoryId}`)) {
      for (const driverId of cell.lossDriverIds) {
        driverIds.add(driverId);
      }
    }
  }
  const categoryIds = new Set(activationSet.map((cell) => cell.businessValueCategoryCatalogId));
  return { driverIds, categoryIds };
};

/**
 * The plausibility verdict on a total this kernel did not derive: the figures a scenario page
 * displays, an analyst's manual rows included. It shares the rule and both anchors with the
 * derivation's own gate, because the alternative is two rules disagreeing about one figure — and
 * a hand-entered figure is the one that most needs checking against the organization's scale.
 */
export const evaluateTotalSanity = (
  profile: Pick<FinancialProfileInput, 'annualRevenueUsd' | 'costliestIncidentBand'>,
  organization: OrganizationInput,
  expectedTotalUsd: number,
): ReadonlyArray<SanityWarning> => {
  const { annualRevenueUsd } = resolveAnnualRevenueUsd(profile, organization);
  return evaluateSanityWarnings(expectedTotalUsd, {
    annualRevenueUsd,
    sizeClass: deriveSizeClass(annualRevenueUsd ?? 0),
    costliestIncidentBand: profile.costliestIncidentBand,
  });
};

/**
 * Pure, deterministic and synchronous by construction: no database, i18n or clock import anywhere
 * in this file's dependency graph (see derive-estimates.test.ts's purity assertion). Reference dwell
 * is deliberately not a parameter: no driver formula takes a per-driver dwell input, so "triplets at
 * reference dwell" is a constraint on what this function must NOT do (apply a dwell shift), not a
 * value it consumes.
 */
export const deriveEstimates = (
  profile: FinancialProfileInput,
  organization: OrganizationInput,
  activationSet: ActivationSetInput,
  coefficientSet = COEFFICIENT_SET_V3,
): DerivationResult => {
  const { annualRevenueUsd, lowConfidence: revenueLowConfidence } = resolveAnnualRevenueUsd(profile, organization);
  const labourCost = resolveLoadedDailyLabourCostUsd(profile, organization);
  const sizeClass = deriveSizeClass(annualRevenueUsd ?? 0);
  const { driverIds: activatedDriverIds, categoryIds: activatedCategoryIds } = deriveActivatedSets(activationSet);

  const ctx: DriverContext = {
    profile,
    coefficients: coefficientSet,
    sizeClass,
    annualRevenueUsd,
    revenueLowConfidence,
    loadedDailyLabourCostUsd: labourCost.loadedDailyLabourCostUsd,
    labourCostLowConfidence: labourCost.lowConfidence,
    employeeCount: organization.employeeCount,
    activatedCategoryIds,
  };

  const estimates: Array<DriverEstimate> = [];
  for (const { lossDriverId, derive } of DRIVER_FORMULAS) {
    if (!activatedDriverIds.has(lossDriverId)) {
      continue;
    }
    const output = derive(ctx);
    if (output == null) {
      continue;
    }
    // Rounded here, once, rather than in eighteen formulas: these legs are stored as doubles and
    // then loaded straight into the analyst's editable min/max fields, so a float artefact of the
    // coefficient arithmetic — 4040123.4999999995 — is a number a human is asked to read and retype.
    estimates.push({
      ...output,
      lossDriverCatalogId: lossDriverId,
      min: Math.round(output.min),
      likely: Math.round(output.likely),
      max: Math.round(output.max),
    });
  }

  return {
    estimates,
    coefficientSetVersion: coefficientSet.version,
  };
};
