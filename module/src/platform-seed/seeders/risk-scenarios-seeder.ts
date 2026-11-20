import { inArray } from 'drizzle-orm';
import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_DataTheftExtortion,
  AttackOutcome_DestructiveAttack,
  AttackOutcome_Espionage,
  AttackOutcome_Ransomware,
  AttackOutcome_ServiceDisruption,
} from '../../modules/attack-outcomes/data';
import { deriveSeedId } from '../../seed-ids';
import { primaryAssetBusinessValueCategories } from '../../modules/business-value-categories/schema';
import { riskScenarioBusinessValueCategories, riskScenarioPrimaryAssets, riskScenarios } from '../../modules/risk-scenarios/schema';
import {
  Organization_AcmeAsia,
  Organization_AcmeCorp,
  Organization_AcmeEurope,
  Organization_AcmeSubsidiary,
  Organization_PartnerCorp,
  Organization_Tarnwick,
  PrimaryAsset_AmlKycProcess,
  PrimaryAsset_CardTransactionData,
  PrimaryAsset_CreditDecisionProcess,
  PrimaryAsset_CustomerAccountData,
  PrimaryAsset_EuCustomerData,
  PrimaryAsset_InterbankPayment,
  PrimaryAsset_InvestmentPortfolio,
  PrimaryAsset_ManufacturingData,
  PrimaryAsset_ProductionPlanning,
  PrimaryAsset_SecuritiesTrading,
  PrimaryAsset_TradeFinance,
  RiskScenario_BizInterruptionEcommerce,
  RiskScenario_CardDataBreachKestrelmoor,
  RiskScenario_DataBreachAmlExposure,
  RiskScenario_DataBreachCrm,
  RiskScenario_DataBreachRetailPos,
  RiskScenario_EspionageFirmware,
  RiskScenario_PhysicalDamageMfg,
  RiskScenario_RansomwareTradeFinance,
  Tenant_Acme,
  Tenant_Tarnwick,
  User_Alice,
  User_Bob,
  User_Eve,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('risk-scenarios', async ({ db }) => {
  // Outcome row ids are derived from the closed catalog (permanent UUID -> tenant row id), never
  // resolved by name. Every outcome but Data Breach / Resale names exactly one scenario; that one
  // names three, so the attack outcome overview has an outcome with several priced scenarios and
  // one left unsimulated to exercise.
  const acmeDataBreachResale = deriveSeedId(Tenant_Acme, AttackOutcome_DataBreachResale);
  const acmeServiceDisruption = deriveSeedId(Tenant_Acme, AttackOutcome_ServiceDisruption);
  const acmeEspionage = deriveSeedId(Tenant_Acme, AttackOutcome_Espionage);
  const acmeRansomware = deriveSeedId(Tenant_Acme, AttackOutcome_Ransomware);
  const acmeDataTheftExtortion = deriveSeedId(Tenant_Acme, AttackOutcome_DataTheftExtortion);
  const tarnwickDestructiveAttack = deriveSeedId(Tenant_Tarnwick, AttackOutcome_DestructiveAttack);

  await db.insert(riskScenarios).values([
    {
      id: RiskScenario_DataBreachCrm,
      tenantId: Tenant_Acme,
      organizationId: Organization_AcmeCorp,
      ownerId: User_Alice,
      name: 'Data Breach / Exfiltration on Core Banking Database',
      description: 'Organized crime group targets the core banking database to exfiltrate 3M+ customer account records for identity fraud and dark market resale.',
      attackOutcomeId: acmeDataBreachResale,
      tefMode: 'auto',
    },
    {
      id: RiskScenario_DataBreachRetailPos,
      tenantId: Tenant_Acme,
      organizationId: Organization_AcmeCorp,
      ownerId: User_Bob,
      name: 'Data Breach on Retail Lending Platform',
      description: 'Access broker resells a foothold into the retail credit decision process, exposing applicant records gathered for scoring and underwriting.',
      attackOutcomeId: acmeDataBreachResale,
      // Pinned against the `auto` default: the demo needs one scenario on a hand-entered frequency.
      tefMode: 'manual',
    },
    {
      id: RiskScenario_DataBreachAmlExposure,
      tenantId: Tenant_Acme,
      organizationId: Organization_AcmeEurope,
      name: 'Data Breach on AML/KYC Screening Platform',
      description: 'Exposure of AML/KYC verification records for European customers, surfaced through a partner integration; not yet quantified.',
      attackOutcomeId: acmeDataBreachResale,
      // Pinned against the `auto` default: this one stays unquantified, with no frequency at all.
      tefMode: 'manual',
    },
    {
      id: RiskScenario_BizInterruptionEcommerce,
      tenantId: Tenant_Acme,
      organizationId: Organization_AcmeEurope,
      ownerId: User_Bob,
      name: 'Business Interruption on Internet Banking Platform',
      description: 'State-sponsored actor disrupts the European internet banking platform, halting 150k+ daily transactions across 12 countries and blocking SEPA payments.',
      attackOutcomeId: acmeServiceDisruption,
      tefMode: 'auto',
    },
    {
      id: RiskScenario_EspionageFirmware,
      tenantId: Tenant_Acme,
      organizationId: Organization_AcmeSubsidiary,
      ownerId: User_Alice,
      name: 'Espionage / Intellectual Property Loss on Proprietary Trading Algorithms',
      description: 'Covert agent infiltrates the wealth management subsidiary to steal proprietary algorithmic trading strategies worth 5 years of R&D.',
      attackOutcomeId: acmeEspionage,
      tefMode: 'auto',
    },
    {
      id: RiskScenario_RansomwareTradeFinance,
      tenantId: Tenant_Acme,
      organizationId: Organization_AcmeAsia,
      ownerId: User_Alice,
      name: 'Ransomware on Trade Finance Platform',
      description: 'Ransomware affiliate encrypts the APAC trade finance document platform after exfiltrating letters of credit, halting $800M+ monthly corridor flows and triggering counterparty penalties.',
      attackOutcomeId: acmeRansomware,
      tefMode: 'auto',
    },
    {
      id: RiskScenario_CardDataBreachKestrelmoor,
      tenantId: Tenant_Acme,
      organizationId: Organization_PartnerCorp,
      ownerId: User_Bob,
      name: 'Card Data Breach via Processing Partner',
      description: 'Attacker exfiltrates PCI-scoped cardholder data from the card processing joint venture covering 500k+ daily authorizations, then demands payment to suppress publication of the stolen records.',
      attackOutcomeId: acmeDataTheftExtortion,
      tefMode: 'auto',
    },
  ]);

  await db.insert(riskScenarios).values([
    {
      id: RiskScenario_PhysicalDamageMfg,
      tenantId: Tenant_Tarnwick,
      organizationId: Organization_Tarnwick,
      ownerId: User_Eve,
      name: 'Physical Damage / Safety Impact on Manufacturing Control System',
      description: 'Terrorist group targets SCADA/ICS system to cause physical damage to production lines and safety incidents.',
      attackOutcomeId: tarnwickDestructiveAttack,
      tefMode: 'auto',
    },
  ]);

  const scenarioAssetLinks = [
    { riskScenarioId: RiskScenario_DataBreachCrm, primaryAssetId: PrimaryAsset_CustomerAccountData },
    { riskScenarioId: RiskScenario_DataBreachCrm, primaryAssetId: PrimaryAsset_InterbankPayment },
    { riskScenarioId: RiskScenario_DataBreachRetailPos, primaryAssetId: PrimaryAsset_CreditDecisionProcess },
    { riskScenarioId: RiskScenario_DataBreachAmlExposure, primaryAssetId: PrimaryAsset_AmlKycProcess },
    { riskScenarioId: RiskScenario_BizInterruptionEcommerce, primaryAssetId: PrimaryAsset_EuCustomerData },
    { riskScenarioId: RiskScenario_EspionageFirmware, primaryAssetId: PrimaryAsset_InvestmentPortfolio },
    { riskScenarioId: RiskScenario_EspionageFirmware, primaryAssetId: PrimaryAsset_SecuritiesTrading },
    { riskScenarioId: RiskScenario_RansomwareTradeFinance, primaryAssetId: PrimaryAsset_TradeFinance },
    { riskScenarioId: RiskScenario_CardDataBreachKestrelmoor, primaryAssetId: PrimaryAsset_CardTransactionData },
    { riskScenarioId: RiskScenario_PhysicalDamageMfg, primaryAssetId: PrimaryAsset_ManufacturingData },
    { riskScenarioId: RiskScenario_PhysicalDamageMfg, primaryAssetId: PrimaryAsset_ProductionPlanning },
  ];

  await db.insert(riskScenarioPrimaryAssets).values(scenarioAssetLinks);

  // The loss scope is read from the assets rather than restated here, so retagging an asset in the
  // primary-assets seeder cannot leave a scenario pricing lines its assets no longer open.
  const assetResources = await db
    .select({
      primaryAssetId: primaryAssetBusinessValueCategories.primaryAssetId,
      businessValueCategoryId: primaryAssetBusinessValueCategories.businessValueCategoryId,
    })
    .from(primaryAssetBusinessValueCategories)
    .where(inArray(primaryAssetBusinessValueCategories.primaryAssetId, [...new Set(scenarioAssetLinks.map((link) => link.primaryAssetId))]));

  const resourcesByAsset = new Map<string, Array<string>>();
  for (const row of assetResources) {
    resourcesByAsset.set(row.primaryAssetId, [...resourcesByAsset.get(row.primaryAssetId) ?? [], row.businessValueCategoryId]);
  }

  const scenarioResources = new Map<string, Set<string>>();
  for (const link of scenarioAssetLinks) {
    const scope = scenarioResources.get(link.riskScenarioId) ?? new Set<string>();
    for (const categoryId of resourcesByAsset.get(link.primaryAssetId) ?? []) {
      scope.add(categoryId);
    }
    scenarioResources.set(link.riskScenarioId, scope);
  }

  await db.insert(riskScenarioBusinessValueCategories).values(
    [...scenarioResources].flatMap(([riskScenarioId, categoryIds]) =>
      [...categoryIds].map((businessValueCategoryId) => ({ riskScenarioId, businessValueCategoryId }))),
  );
});
