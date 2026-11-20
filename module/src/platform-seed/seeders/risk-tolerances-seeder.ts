import { organizationRiskTolerances } from '../../modules/organizations/schema';
import { riskScenarioRiskTolerances } from '../../modules/risk-scenarios/schema';
import { Organization_AcmeAsia, Organization_AcmeCorp, Organization_AcmeEurope, Organization_AcmeSubsidiary, RiskScenario_DataBreachRetailPos } from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('risk-tolerances', async ({ db }) => {
  await db.insert(organizationRiskTolerances).values([
    { id: Organization_AcmeCorp, organizationId: Organization_AcmeCorp, annualLoss: 20_000_000, maxExceedanceProbability: 0.013 },
    { id: Organization_AcmeEurope, organizationId: Organization_AcmeEurope, annualLoss: 400_000, maxExceedanceProbability: 0.05 },
    { id: Organization_AcmeSubsidiary, organizationId: Organization_AcmeSubsidiary, annualLoss: 2_500_000, maxExceedanceProbability: 0.05 },
    { id: Organization_AcmeAsia, organizationId: Organization_AcmeAsia, annualLoss: 1_000_000, maxExceedanceProbability: 0.02 },
  ]);
  await db.insert(riskScenarioRiskTolerances).values([
    { id: RiskScenario_DataBreachRetailPos, riskScenarioId: RiskScenario_DataBreachRetailPos, annualLoss: 50_000_000, maxExceedanceProbability: 0.1 },
  ]);
});
