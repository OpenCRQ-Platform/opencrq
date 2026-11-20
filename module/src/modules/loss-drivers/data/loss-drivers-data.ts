import type { DwellSensitivity, ScalingVariable } from './loss-drivers-constants';
import type { LossCategoryId } from './loss-drivers-ids';
import {
  LossCategory_AffectedPartyNotification,
  LossCategory_BusinessInterruption,
  LossCategory_DirectFinancialTheft,
  LossCategory_Extortion,
  LossCategory_FutureRevenueLoss,
  LossCategory_LegalRegulatoryContractual,
  LossCategory_ResponseInvestigation,
  LossCategory_RestorationRebuild,
  LossDriver_CompetitiveAdvantageErosion,
  LossDriver_ContractualPenalties,
  LossDriver_CrisisCommunications,
  LossDriver_CustomerAttritionWinBack,
  LossDriver_ExtortionPayment,
  LossDriver_ForensicsIncidentManagement,
  LossDriver_HardwareReplacement,
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
} from './loss-drivers-ids';

/**
 * The loss-driver catalog, the single source reseeded into every tenant on boot.
 *
 * The ids live in `loss-drivers-ids.ts` and must never be regenerated.
 *
 * `name` is a label only: it can be edited freely and reseeded, nothing anywhere resolves a row by
 * it.
 *
 * User-facing estimation guidance belongs in the frontend translation catalogs, not here, because
 * the backend never translates.
 */

export interface LossCategoryReference {
  id: string,
  name: string,
  description: string,
  displayOrder: number,
}

export interface LossDriverReference {
  id: string,
  name: string,
  description: string,
  lossCategoryId: LossCategoryId,
  /** Rank of the driver inside its loss category; the catalog carries the curated order. */
  displayOrder: number,
  dwellSensitivity: DwellSensitivity,
  scalingVariable: ScalingVariable,
}

/** The loss categories, the reporting level above the drivers. */
export const LOSS_CATEGORIES: ReadonlyArray<LossCategoryReference> = [
  {
    id: LossCategory_ResponseInvestigation,
    name: 'Response & Investigation',
    description: 'Investigating, managing and communicating the incident while it is being handled.',
    displayOrder: 1,
  },
  {
    id: LossCategory_RestorationRebuild,
    name: 'Restoration & Rebuild',
    description: 'Restoring systems and data, and replacing equipment that cannot be trusted again.',
    displayOrder: 2,
  },
  {
    id: LossCategory_BusinessInterruption,
    name: 'Business Interruption (own operations)',
    description: 'Margin and extra operating cost incurred while the organization runs degraded or not at all.',
    displayOrder: 3,
  },
  {
    id: LossCategory_Extortion,
    name: 'Extortion',
    description: 'Amounts actually paid to the attacker to end the extortion.',
    displayOrder: 4,
  },
  {
    id: LossCategory_DirectFinancialTheft,
    name: 'Direct Financial Theft',
    description: 'Funds taken by the attacker and never recovered.',
    displayOrder: 5,
  },
  {
    id: LossCategory_AffectedPartyNotification,
    name: 'Affected-Party Notification & Protection',
    description: 'Informing the individuals affected and protecting them afterwards.',
    displayOrder: 6,
  },
  {
    id: LossCategory_LegalRegulatoryContractual,
    name: 'Legal, Regulatory & Contractual Consequences',
    description: 'Defense, settlements, fines, card-brand assessments and contractual penalties following the incident.',
    displayOrder: 7,
  },
  {
    id: LossCategory_FutureRevenueLoss,
    name: 'Future Revenue Loss',
    description: 'Revenue and margin lost after restoration, through customer attrition or eroded competitive advantage.',
    displayOrder: 8,
  },
];

/**
 * The loss drivers, each attached to its loss category.
 *
 * Notification & call handling, identity & credit protection, settlements & damages and the
 * payment-card assessments share `affected_record_count` on purpose: the scaling variable carries
 * no sampling semantics today, but it is the key a later comonotone coupling uses to find exactly
 * that subset. Giving them distinct values would lose that.
 */
export const LOSS_DRIVERS: ReadonlyArray<LossDriverReference> = [
  {
    id: LossDriver_ForensicsIncidentManagement,
    name: 'Forensics & incident management',
    description: 'External DFIR fees: scoping, containment, eradication, reconstruction and negotiation support.',
    lossCategoryId: LossCategory_ResponseInvestigation,
    displayOrder: 1,
    dwellSensitivity: 'strong',
    scalingVariable: 'systems_in_scope',
  },
  {
    id: LossDriver_IncidentLegalCounsel,
    name: 'Incident legal counsel',
    description: 'Outside counsel under privilege, up to the point where claims are asserted.',
    lossCategoryId: LossCategory_ResponseInvestigation,
    displayOrder: 2,
    dwellSensitivity: 'weak',
    scalingVariable: 'counsel_hours',
  },
  {
    id: LossDriver_CrisisCommunications,
    name: 'Crisis communications & PR',
    description: 'External communications support; the cost tracks the public-visibility tier of the incident.',
    lossCategoryId: LossCategory_ResponseInvestigation,
    displayOrder: 3,
    dwellSensitivity: 'none',
    scalingVariable: 'public_severity_tier',
  },
  {
    id: LossDriver_InternalResponseSurgeLabor,
    name: 'Internal response surge labor',
    description: 'Incremental internal response cost: overtime, backfill and diverted staff, never counted again as lost productivity.',
    lossCategoryId: LossCategory_ResponseInvestigation,
    displayOrder: 4,
    dwellSensitivity: 'strong',
    scalingVariable: 'response_headcount_days',
  },
  {
    id: LossDriver_SystemDataRestoration,
    name: 'System & data restoration',
    description: 'Rebuild, reimage, restore, recreate data and revalidate, including the espionage-eviction rebuild.',
    lossCategoryId: LossCategory_RestorationRebuild,
    displayOrder: 1,
    dwellSensitivity: 'strong',
    scalingVariable: 'systems_in_scope',
  },
  {
    id: LossDriver_HardwareReplacement,
    name: 'Hardware & equipment replacement',
    description: 'Capital cost of physically destroyed or untrustable equipment; absorbs all replacement capex whenever it is active.',
    lossCategoryId: LossCategory_RestorationRebuild,
    displayOrder: 2,
    dwellSensitivity: 'strong',
    scalingVariable: 'destroyed_device_count',
  },
  {
    id: LossDriver_LostMarginFromDowntime,
    name: 'Lost margin from downtime',
    description: 'Contribution margin on revenue lost during the outage, net of recapture, stopping at restoration.',
    lossCategoryId: LossCategory_BusinessInterruption,
    displayOrder: 1,
    dwellSensitivity: 'none',
    scalingVariable: 'outage_days',
  },
  {
    id: LossDriver_IncrementalOperatingCost,
    name: 'Incremental operating cost during disruption',
    description: 'Extra expense to operate degraded: manual processing, temporary staffing and expediting.',
    lossCategoryId: LossCategory_BusinessInterruption,
    displayOrder: 2,
    dwellSensitivity: 'none',
    scalingVariable: 'outage_days',
  },
  {
    id: LossDriver_ExtortionPayment,
    name: 'Extortion payment',
    description: 'Amount actually paid for decryption, suppression or cessation, including transaction costs; never substituted with restoration.',
    lossCategoryId: LossCategory_Extortion,
    displayOrder: 1,
    dwellSensitivity: 'none',
    scalingVariable: 'revenue_band',
  },
  {
    id: LossDriver_StolenFundsNetOfRecovery,
    name: 'Stolen funds, net of recovery',
    description: 'Funds fraudulently transferred and not recovered; carries the principal the organization is out of pocket, absorbed or restituted.',
    lossCategoryId: LossCategory_DirectFinancialTheft,
    displayOrder: 1,
    dwellSensitivity: 'strong',
    scalingVariable: 'payment_flow_value',
  },
  {
    id: LossDriver_NotificationCallHandling,
    name: 'Notification & call handling',
    description: 'Determining and executing the notification of affected individuals, plus the call-centre surge.',
    lossCategoryId: LossCategory_AffectedPartyNotification,
    displayOrder: 1,
    dwellSensitivity: 'none',
    scalingVariable: 'affected_record_count',
  },
  {
    id: LossDriver_IdentityCreditProtection,
    name: 'Identity & credit protection',
    description: 'Monitoring and restoration offered to affected individuals, where the exposed data reaches adversary hands.',
    lossCategoryId: LossCategory_AffectedPartyNotification,
    displayOrder: 2,
    dwellSensitivity: 'none',
    scalingVariable: 'affected_record_count',
  },
  {
    id: LossDriver_LitigationDefense,
    name: 'Litigation & proceedings defense',
    description: 'Defense-side fees once claims are asserted.',
    lossCategoryId: LossCategory_LegalRegulatoryContractual,
    displayOrder: 1,
    dwellSensitivity: 'none',
    scalingVariable: 'claim_and_jurisdiction_count',
  },
  {
    id: LossDriver_SettlementsDamages,
    name: 'Settlements & damages',
    description: 'Amounts paid to claimants, beyond-principal only on funds categories, including litigated business damages.',
    lossCategoryId: LossCategory_LegalRegulatoryContractual,
    displayOrder: 2,
    dwellSensitivity: 'none',
    scalingVariable: 'affected_record_count',
  },
  {
    id: LossDriver_RegulatoryFines,
    name: 'Regulatory fines',
    description: 'Statutory penalties imposed by regulators, bounded by the applicable statutory caps.',
    lossCategoryId: LossCategory_LegalRegulatoryContractual,
    displayOrder: 3,
    dwellSensitivity: 'none',
    scalingVariable: 'regulated_revenue',
  },
  {
    id: LossDriver_PaymentCardAssessments,
    name: 'Payment-card ecosystem assessments',
    description: 'Card-brand program assessments through acquirers: reissuance, fraud recovery, forensic investigation and non-compliance. All card economics flow here.',
    lossCategoryId: LossCategory_LegalRegulatoryContractual,
    displayOrder: 4,
    dwellSensitivity: 'none',
    scalingVariable: 'affected_record_count',
  },
  {
    id: LossDriver_ContractualPenalties,
    name: 'Contractual penalties & service credits',
    description: 'Service credits, delivery-failure penalties and unlitigated liquidated damages under security-breach clauses; litigated damages sit in settlements.',
    lossCategoryId: LossCategory_LegalRegulatoryContractual,
    displayOrder: 5,
    dwellSensitivity: 'none',
    scalingVariable: 'contracted_revenue',
  },
  {
    id: LossDriver_CustomerAttritionWinBack,
    name: 'Customer attrition & win-back',
    description: 'Margin on customers lost after restoration, plus win-back spend. All reputation cash lives here, starting where lost downtime margin stops.',
    lossCategoryId: LossCategory_FutureRevenueLoss,
    displayOrder: 1,
    dwellSensitivity: 'none',
    scalingVariable: 'recurring_revenue_margin',
  },
  {
    id: LossDriver_CompetitiveAdvantageErosion,
    name: 'Competitive-advantage erosion',
    description: 'Future margin lost because strategic assets are in adversary hands; a stolen-IP mechanism, distinct from eroded trust.',
    lossCategoryId: LossCategory_FutureRevenueLoss,
    displayOrder: 2,
    dwellSensitivity: 'strong',
    scalingVariable: 'rd_investment',
  },
];
