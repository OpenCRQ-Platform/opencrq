import type { JobCatalogueKind } from '../../modules/jobs/catalogue';
import type { SeedContext } from '../platform-seed-registry';
import { deriveSeedId } from '../../seed-ids';
import {
  LossDriver_CompetitiveAdvantageErosion,
  LossDriver_CrisisCommunications,
  LossDriver_ExtortionPayment,
  LossDriver_ForensicsIncidentManagement,
  LossDriver_HardwareReplacement,
  LossDriver_LostMarginFromDowntime,
  LossDriver_NotificationCallHandling,
  LossDriver_PaymentCardAssessments,
  LossDriver_RegulatoryFines,
} from '../../modules/loss-drivers/data';
import { scenarioLossEstimates } from '../../modules/scenario-loss-estimates/schema';
import {
  RiskScenario_BizInterruptionEcommerce,
  RiskScenario_CardDataBreachKestrelmoor,
  RiskScenario_DataBreachAmlExposure,
  RiskScenario_DataBreachCrm,
  RiskScenario_DataBreachRetailPos,
  RiskScenario_EspionageFirmware,
  RiskScenario_PhysicalDamageMfg,
  RiskScenario_RansomwareTradeFinance,
  ScenarioLossEstimate_AmlExposureNotification,
  ScenarioLossEstimate_CardBreachCardAssessments,
  ScenarioLossEstimate_CardBreachCrisis,
  ScenarioLossEstimate_CardBreachForensics,
  ScenarioLossEstimate_CrmCrisisPr,
  ScenarioLossEstimate_CrmForensics,
  ScenarioLossEstimate_CrmRegulatory,
  ScenarioLossEstimate_EcommerceCrisis,
  ScenarioLossEstimate_EcommerceDowntime,
  ScenarioLossEstimate_FirmwareInvestigation,
  ScenarioLossEstimate_FirmwareIpLoss,
  ScenarioLossEstimate_MfgDowntime,
  ScenarioLossEstimate_MfgForensics,
  ScenarioLossEstimate_MfgHardware,
  ScenarioLossEstimate_RetailPosForensics,
  ScenarioLossEstimate_RetailPosRegulatory,
  ScenarioLossEstimate_TradeFinanceDowntime,
  ScenarioLossEstimate_TradeFinanceExtortion,
  ScenarioLossEstimate_TradeFinanceNotification,
  Tenant_Acme,
  Tenant_Tarnwick,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

const acmeRecomputeOrigin = {
  type: 'job',
  tenantId: Tenant_Acme,
  jobKind: 'financial-estimates-recompute' satisfies JobCatalogueKind,
  interactive: false,
} as const;

/**
 * Writes the questionnaire-derived estimates of every Acme scenario with a financial profile, and
 * stamps them as current. Rows already derived are left untouched, so a later seeder adding a
 * profile can call it again without moving the figures an earlier seeded run priced.
 */
export const deriveAcmeQuestionnaireEstimates = async (services: SeedContext['services']): Promise<void> => {
  const { failedScenarios } = await services.withOrigin(acmeRecomputeOrigin).scenarioLossEstimates.recomputeQuestionnaireEstimates();
  if (failedScenarios > 0) {
    throw new Error(`[platform-seed] questionnaire-derived estimates failed for ${failedScenarios} scenario(s)`);
  }
};

registerPlatformSeed('scenario-loss-estimates', async ({ db, services, now }) => {
  // Acme estimates are backdated so they predate the seeded CRQ run history — the scenario
  // configuration accordion compares these timestamps against the latest run's createdAt.
  const acmeUpdatedAt = new Date(now.getTime() - 180 * 86_400_000);

  // Drivers come from the closed catalog, one derived row per tenant. Every estimate sits on a
  // driver the activation matrix recommends for its scenario, with the single deliberate exception
  // marked below, so no demonstration scenario prices at zero and the departure stays visible.
  const acmeDriver = (catalogId: string) => deriveSeedId(Tenant_Acme, catalogId);
  const tarnwickDriver = (catalogId: string) => deriveSeedId(Tenant_Tarnwick, catalogId);

  await db.insert(scenarioLossEstimates).values([
    {
      id: ScenarioLossEstimate_CrmForensics,
      riskScenarioId: RiskScenario_DataBreachCrm,
      lossDriverId: acmeDriver(LossDriver_ForensicsIncidentManagement),
      minValue: 150_000,
      likelyValue: 400_000,
      maxValue: 800_000,
      updatedAt: acmeUpdatedAt,
    },
    {
      id: ScenarioLossEstimate_CrmCrisisPr,
      riskScenarioId: RiskScenario_DataBreachCrm,
      lossDriverId: acmeDriver(LossDriver_CrisisCommunications),
      minValue: 50_000,
      likelyValue: 150_000,
      maxValue: 500_000,
      updatedAt: acmeUpdatedAt,
    },
    {
      id: ScenarioLossEstimate_CrmRegulatory,
      riskScenarioId: RiskScenario_DataBreachCrm,
      lossDriverId: acmeDriver(LossDriver_RegulatoryFines),
      minValue: 500_000,
      likelyValue: 2_000_000,
      maxValue: 10_000_000,
      updatedAt: acmeUpdatedAt,
    },
  ]);

  // Siblings of the estimate above, naming the same outcome: one priced, one left unsimulated.
  // A hand-recorded estimate does not depend on a simulation existing, so both carry one.
  await db.insert(scenarioLossEstimates).values([
    {
      id: ScenarioLossEstimate_RetailPosForensics,
      riskScenarioId: RiskScenario_DataBreachRetailPos,
      lossDriverId: acmeDriver(LossDriver_ForensicsIncidentManagement),
      minValue: 80_000,
      likelyValue: 250_000,
      maxValue: 600_000,
      updatedAt: acmeUpdatedAt,
    },
    {
      id: ScenarioLossEstimate_RetailPosRegulatory,
      riskScenarioId: RiskScenario_DataBreachRetailPos,
      lossDriverId: acmeDriver(LossDriver_RegulatoryFines),
      minValue: 200_000,
      likelyValue: 900_000,
      maxValue: 3_500_000,
      updatedAt: acmeUpdatedAt,
    },
    {
      id: ScenarioLossEstimate_AmlExposureNotification,
      riskScenarioId: RiskScenario_DataBreachAmlExposure,
      lossDriverId: acmeDriver(LossDriver_NotificationCallHandling),
      minValue: 40_000,
      likelyValue: 120_000,
      maxValue: 400_000,
      updatedAt: acmeUpdatedAt,
    },
  ]);

  await db.insert(scenarioLossEstimates).values([
    {
      id: ScenarioLossEstimate_EcommerceDowntime,
      riskScenarioId: RiskScenario_BizInterruptionEcommerce,
      lossDriverId: acmeDriver(LossDriver_LostMarginFromDowntime),
      minValue: 200_000,
      likelyValue: 750_000,
      maxValue: 3_000_000,
      updatedAt: acmeUpdatedAt,
    },
    {
      id: ScenarioLossEstimate_EcommerceCrisis,
      riskScenarioId: RiskScenario_BizInterruptionEcommerce,
      lossDriverId: acmeDriver(LossDriver_CrisisCommunications),
      minValue: 30_000,
      likelyValue: 100_000,
      maxValue: 300_000,
      updatedAt: acmeUpdatedAt,
    },
  ]);

  // The stolen-IP mechanism is competitive-advantage erosion, not a regulatory penalty.
  await db.insert(scenarioLossEstimates).values([
    {
      id: ScenarioLossEstimate_FirmwareInvestigation,
      riskScenarioId: RiskScenario_EspionageFirmware,
      lossDriverId: acmeDriver(LossDriver_ForensicsIncidentManagement),
      minValue: 100_000,
      likelyValue: 300_000,
      maxValue: 600_000,
      updatedAt: acmeUpdatedAt,
    },
    {
      id: ScenarioLossEstimate_FirmwareIpLoss,
      riskScenarioId: RiskScenario_EspionageFirmware,
      lossDriverId: acmeDriver(LossDriver_CompetitiveAdvantageErosion),
      minValue: 1_000_000,
      likelyValue: 5_000_000,
      maxValue: 20_000_000,
      updatedAt: acmeUpdatedAt,
    },
  ]);

  await db.insert(scenarioLossEstimates).values([
    {
      id: ScenarioLossEstimate_TradeFinanceDowntime,
      riskScenarioId: RiskScenario_RansomwareTradeFinance,
      lossDriverId: acmeDriver(LossDriver_LostMarginFromDowntime),
      minValue: 500_000,
      likelyValue: 2_500_000,
      maxValue: 12_000_000,
      updatedAt: acmeUpdatedAt,
    },
    {
      id: ScenarioLossEstimate_TradeFinanceExtortion,
      riskScenarioId: RiskScenario_RansomwareTradeFinance,
      lossDriverId: acmeDriver(LossDriver_ExtortionPayment),
      minValue: 100_000,
      likelyValue: 400_000,
      maxValue: 1_200_000,
      updatedAt: acmeUpdatedAt,
    },
    /*
     * The one deliberate departure from the activation matrix in the whole demonstration set, kept
     * so the "not recommended" section of the estimation surface is visible on real data. The
     * scenario's assets carry customer-facing delivery and client-entrusted confidential data, and
     * neither pairing calls for individual notification: the letters of credit are corporate
     * records, not personal data. An analyst pricing counterparty notification anyway is exactly
     * the case the section exists for.
     */
    {
      id: ScenarioLossEstimate_TradeFinanceNotification,
      riskScenarioId: RiskScenario_RansomwareTradeFinance,
      lossDriverId: acmeDriver(LossDriver_NotificationCallHandling),
      minValue: 20_000,
      likelyValue: 80_000,
      maxValue: 250_000,
      updatedAt: acmeUpdatedAt,
    },
  ]);

  // All card economics flow through the payment-card ecosystem assessments driver.
  await db.insert(scenarioLossEstimates).values([
    {
      id: ScenarioLossEstimate_CardBreachForensics,
      riskScenarioId: RiskScenario_CardDataBreachKestrelmoor,
      lossDriverId: acmeDriver(LossDriver_ForensicsIncidentManagement),
      minValue: 250_000,
      likelyValue: 700_000,
      maxValue: 1_800_000,
      updatedAt: acmeUpdatedAt,
    },
    {
      id: ScenarioLossEstimate_CardBreachCardAssessments,
      riskScenarioId: RiskScenario_CardDataBreachKestrelmoor,
      lossDriverId: acmeDriver(LossDriver_PaymentCardAssessments),
      minValue: 1_000_000,
      likelyValue: 4_000_000,
      maxValue: 15_000_000,
      updatedAt: acmeUpdatedAt,
    },
    {
      id: ScenarioLossEstimate_CardBreachCrisis,
      riskScenarioId: RiskScenario_CardDataBreachKestrelmoor,
      lossDriverId: acmeDriver(LossDriver_CrisisCommunications),
      minValue: 300_000,
      likelyValue: 1_500_000,
      maxValue: 6_000_000,
      updatedAt: acmeUpdatedAt,
    },
  ]);

  // Irreversible damage: the rebuild and the destroyed equipment carry the loss, with no
  // monetization channel for the attacker.
  await db.insert(scenarioLossEstimates).values([
    {
      id: ScenarioLossEstimate_MfgForensics,
      riskScenarioId: RiskScenario_PhysicalDamageMfg,
      lossDriverId: tarnwickDriver(LossDriver_ForensicsIncidentManagement),
      minValue: 200_000,
      likelyValue: 600_000,
      maxValue: 1_500_000,
    },
    {
      id: ScenarioLossEstimate_MfgHardware,
      riskScenarioId: RiskScenario_PhysicalDamageMfg,
      lossDriverId: tarnwickDriver(LossDriver_HardwareReplacement),
      minValue: 1_500_000,
      likelyValue: 6_000_000,
      maxValue: 20_000_000,
    },
    {
      id: ScenarioLossEstimate_MfgDowntime,
      riskScenarioId: RiskScenario_PhysicalDamageMfg,
      lossDriverId: tarnwickDriver(LossDriver_LostMarginFromDowntime),
      minValue: 800_000,
      likelyValue: 3_000_000,
      maxValue: 9_000_000,
    },
  ]);

  // Derived here, before `crq-simulations`, so the seeded runs price them and the boot backfill
  // finds nothing left to write.
  await deriveAcmeQuestionnaireEstimates(services);
});
