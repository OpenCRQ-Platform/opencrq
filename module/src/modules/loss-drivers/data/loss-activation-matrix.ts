import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_DataTheftExtortion,
  AttackOutcome_DestructiveAttack,
  AttackOutcome_Espionage,
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_Ransomware,
  AttackOutcome_ServiceDisruption,
} from '../../attack-outcomes/data/attack-outcomes-ids';
import {
  BusinessValueCategory_DataEntrustedByOthers,
  BusinessValueCategory_FundsAndAssetsHeldForOthers,
  BusinessValueCategory_OperationsAndServices,
  BusinessValueCategory_OwnFundsAndPaymentAuthority,
  BusinessValueCategory_PaymentCardData,
  BusinessValueCategory_PersonalData,
  BusinessValueCategory_PhysicalAssetsAndFacilities,
  BusinessValueCategory_ProprietaryInformation,
  BusinessValueCategory_RegulatedFunctionOrData,
  BusinessValueCategory_ServicesUnderCommitments,
} from '../../business-value-categories/data/business-value-categories-ids';
import {
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
 * A pairing of an attack outcome with a business resource, and the loss drivers that pairing
 * calls for.
 *
 * Membership is the whole content. There is no contingency tag, no probability, no rate and no
 * version field: a driver is either in the cell or it is not, and the earlier per-cell
 * certain/expected distinction was dropped by product decision because nothing consumed it.
 */
export interface LossActivationCell {
  attackOutcomeId: string,
  businessValueCategoryId: string,
  lossDriverIds: ReadonlyArray<string>,
}

/**
 * The activation matrix: 35 compatible cells over 255 activations.
 *
 * A cell can be wider than its resource alone would open: the columns were carried over from the
 * nine-entry model, where one industrial column fed both the physical and the commitments entry.
 *
 * Compatibility is never written down. A pairing absent from this list is one the model holds to be
 * unrealistic, and the 35 missing cells are exactly the complement of the 35 below.
 *
 * The matrix **recommends**, it never gates. Nothing built on it may refuse a save, delete an
 * amount or hide a driver: a scenario is always free to price any driver of the catalog, and one
 * whose outcome and resources share no cell is legal and simply recommends nothing.
 */
export const LOSS_ACTIVATION_MATRIX: ReadonlyArray<LossActivationCell> = [
  // --- Ransomware (RW) ---
  {
    attackOutcomeId: AttackOutcome_Ransomware,
    businessValueCategoryId: BusinessValueCategory_OperationsAndServices,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_LostMarginFromDowntime,
      LossDriver_IncrementalOperatingCost,
      LossDriver_ExtortionPayment,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_Ransomware,
    businessValueCategoryId: BusinessValueCategory_ServicesUnderCommitments,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_LostMarginFromDowntime,
      LossDriver_IncrementalOperatingCost,
      LossDriver_ExtortionPayment,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_Ransomware,
    businessValueCategoryId: BusinessValueCategory_PhysicalAssetsAndFacilities,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_LostMarginFromDowntime,
      LossDriver_IncrementalOperatingCost,
      LossDriver_ExtortionPayment,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_Ransomware,
    businessValueCategoryId: BusinessValueCategory_PersonalData,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_ExtortionPayment,
      LossDriver_NotificationCallHandling,
      LossDriver_IdentityCreditProtection,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_RegulatoryFines,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_Ransomware,
    businessValueCategoryId: BusinessValueCategory_PaymentCardData,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_ExtortionPayment,
      LossDriver_NotificationCallHandling,
      LossDriver_IdentityCreditProtection,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_RegulatoryFines,
      LossDriver_PaymentCardAssessments,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_Ransomware,
    businessValueCategoryId: BusinessValueCategory_DataEntrustedByOthers,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_ExtortionPayment,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_Ransomware,
    businessValueCategoryId: BusinessValueCategory_RegulatedFunctionOrData,
    lossDriverIds: [
      LossDriver_RegulatoryFines,
    ],
  },

  // --- Data theft & extortion (DTE) ---
  {
    attackOutcomeId: AttackOutcome_DataTheftExtortion,
    businessValueCategoryId: BusinessValueCategory_PersonalData,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_ExtortionPayment,
      LossDriver_NotificationCallHandling,
      LossDriver_IdentityCreditProtection,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_RegulatoryFines,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DataTheftExtortion,
    businessValueCategoryId: BusinessValueCategory_PaymentCardData,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_ExtortionPayment,
      LossDriver_NotificationCallHandling,
      LossDriver_IdentityCreditProtection,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_RegulatoryFines,
      LossDriver_PaymentCardAssessments,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DataTheftExtortion,
    businessValueCategoryId: BusinessValueCategory_ProprietaryInformation,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_ExtortionPayment,
      LossDriver_CompetitiveAdvantageErosion,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DataTheftExtortion,
    businessValueCategoryId: BusinessValueCategory_DataEntrustedByOthers,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_ExtortionPayment,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DataTheftExtortion,
    businessValueCategoryId: BusinessValueCategory_RegulatedFunctionOrData,
    lossDriverIds: [
      LossDriver_RegulatoryFines,
    ],
  },

  // --- Data breach & resale (DBR) ---
  {
    attackOutcomeId: AttackOutcome_DataBreachResale,
    businessValueCategoryId: BusinessValueCategory_PersonalData,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_NotificationCallHandling,
      LossDriver_IdentityCreditProtection,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_RegulatoryFines,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DataBreachResale,
    businessValueCategoryId: BusinessValueCategory_PaymentCardData,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_NotificationCallHandling,
      LossDriver_IdentityCreditProtection,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_RegulatoryFines,
      LossDriver_PaymentCardAssessments,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DataBreachResale,
    businessValueCategoryId: BusinessValueCategory_ProprietaryInformation,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_CompetitiveAdvantageErosion,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DataBreachResale,
    businessValueCategoryId: BusinessValueCategory_DataEntrustedByOthers,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DataBreachResale,
    businessValueCategoryId: BusinessValueCategory_RegulatedFunctionOrData,
    lossDriverIds: [
      LossDriver_RegulatoryFines,
    ],
  },

  // --- Financial fraud & funds theft (FFT) ---
  {
    attackOutcomeId: AttackOutcome_FinancialFraudFundsTheft,
    businessValueCategoryId: BusinessValueCategory_OwnFundsAndPaymentAuthority,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_StolenFundsNetOfRecovery,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_FinancialFraudFundsTheft,
    businessValueCategoryId: BusinessValueCategory_FundsAndAssetsHeldForOthers,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_StolenFundsNetOfRecovery,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_RegulatoryFines,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_FinancialFraudFundsTheft,
    businessValueCategoryId: BusinessValueCategory_RegulatedFunctionOrData,
    lossDriverIds: [
      LossDriver_RegulatoryFines,
    ],
  },

  // --- Espionage (ESP) ---
  {
    attackOutcomeId: AttackOutcome_Espionage,
    businessValueCategoryId: BusinessValueCategory_PersonalData,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_NotificationCallHandling,
      LossDriver_IdentityCreditProtection,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_RegulatoryFines,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_Espionage,
    businessValueCategoryId: BusinessValueCategory_ProprietaryInformation,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_CompetitiveAdvantageErosion,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_Espionage,
    businessValueCategoryId: BusinessValueCategory_DataEntrustedByOthers,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_Espionage,
    businessValueCategoryId: BusinessValueCategory_RegulatedFunctionOrData,
    lossDriverIds: [
      LossDriver_RegulatoryFines,
    ],
  },

  // --- Service disruption (SD) ---
  {
    attackOutcomeId: AttackOutcome_ServiceDisruption,
    businessValueCategoryId: BusinessValueCategory_OperationsAndServices,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_LostMarginFromDowntime,
      LossDriver_IncrementalOperatingCost,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_ServiceDisruption,
    businessValueCategoryId: BusinessValueCategory_ServicesUnderCommitments,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_LostMarginFromDowntime,
      LossDriver_IncrementalOperatingCost,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_ServiceDisruption,
    businessValueCategoryId: BusinessValueCategory_PhysicalAssetsAndFacilities,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_LostMarginFromDowntime,
      LossDriver_IncrementalOperatingCost,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    // A temporary loss of availability of personal data is a notification event, not an outage
    // event, which is why the smallest cell of the matrix carries no downtime driver.
    attackOutcomeId: AttackOutcome_ServiceDisruption,
    businessValueCategoryId: BusinessValueCategory_PersonalData,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_NotificationCallHandling,
      LossDriver_RegulatoryFines,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_ServiceDisruption,
    businessValueCategoryId: BusinessValueCategory_RegulatedFunctionOrData,
    lossDriverIds: [
      LossDriver_RegulatoryFines,
    ],
  },

  // --- Destructive attack (DA) ---
  {
    attackOutcomeId: AttackOutcome_DestructiveAttack,
    businessValueCategoryId: BusinessValueCategory_OperationsAndServices,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_LostMarginFromDowntime,
      LossDriver_IncrementalOperatingCost,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DestructiveAttack,
    businessValueCategoryId: BusinessValueCategory_ServicesUnderCommitments,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_HardwareReplacement,
      LossDriver_LostMarginFromDowntime,
      LossDriver_IncrementalOperatingCost,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DestructiveAttack,
    businessValueCategoryId: BusinessValueCategory_PhysicalAssetsAndFacilities,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_HardwareReplacement,
      LossDriver_LostMarginFromDowntime,
      LossDriver_IncrementalOperatingCost,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DestructiveAttack,
    businessValueCategoryId: BusinessValueCategory_PersonalData,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_NotificationCallHandling,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_RegulatoryFines,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DestructiveAttack,
    businessValueCategoryId: BusinessValueCategory_DataEntrustedByOthers,
    lossDriverIds: [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_IncidentLegalCounsel,
      LossDriver_CrisisCommunications,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_LitigationDefense,
      LossDriver_SettlementsDamages,
      LossDriver_CustomerAttritionWinBack,
    ],
  },
  {
    attackOutcomeId: AttackOutcome_DestructiveAttack,
    businessValueCategoryId: BusinessValueCategory_RegulatedFunctionOrData,
    lossDriverIds: [
      LossDriver_RegulatoryFines,
    ],
  },
];
