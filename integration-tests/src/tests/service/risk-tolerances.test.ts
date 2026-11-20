import type { EventOrigin } from '@app/module';
import { organizationRiskTolerances, riskScenarioRiskTolerances } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { FULLY_ANSWERED_PROFILE_ANSWERS } from '../../helpers/financial-profile-answers';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const SCOPE_TOLERANCE = { annualLoss: 1_000_000, maxExceedanceProbability: 0.1 };
const OWN_TOLERANCE = { annualLoss: 500_000, maxExceedanceProbability: 0.05 };

describe('Risk tolerances', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let organizationId: string;
  let riskScenarioId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;

    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
    const [outcome] = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
    riskScenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Scenario',
      description: null,
      attackOutcomeId: outcome.id,
      primaryAssetIds: [],
    });
  });

  describe('on a risk scope', () => {
    const readTolerance = async (origin: EventOrigin) => (await services.withOrigin(origin).organizations.getRiskTolerance(organizationId)).tolerance;

    it('should read none on a new scope', async () => {
      await expect(readTolerance(adminOrigin)).resolves.toBeNull();
    });

    it('should count the scope scenarios and those setting their own threshold', async () => {
      const [outcome] = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: uuidv7(),
        organizationId,
        name: 'Second scenario',
        description: null,
        attackOutcomeId: outcome.id,
        primaryAssetIds: [],
      });
      await services.withOrigin(adminOrigin).riskScenarios.setRiskTolerance(riskScenarioId, OWN_TOLERANCE);

      await expect(services.withOrigin(adminOrigin).organizations.getRiskTolerance(organizationId))
        .resolves.toEqual({ tolerance: null, scenarioCount: 2, ownThresholdCount: 1 });
    });

    it('should store the tolerance, then replace it', async () => {
      await services.withOrigin(adminOrigin).organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      await services.withOrigin(adminOrigin).organizations.setRiskTolerance(organizationId, { annualLoss: 2_000_000, maxExceedanceProbability: 0.2 });

      await expect(readTolerance(adminOrigin)).resolves.toEqual({ annualLoss: 2_000_000, maxExceedanceProbability: 0.2 });
    });

    it('should leave the scenarios answers current and the financial profile undated', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, FULLY_ANSWERED_PROFILE_ANSWERS);
      await db.execute(sql`update risk_scenarios set derived_answers_updated_at = (select updated_at from financial_profiles where organization_id = ${organizationId}) where id = ${riskScenarioId}`);
      const profileBefore = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      await expect(services.withOrigin(adminOrigin).riskScenarios.isEstimatesRecomputePending(riskScenarioId)).resolves.toBe(false);

      await services.withOrigin(adminOrigin).organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      await services.withOrigin(adminOrigin).riskScenarios.setRiskTolerance(riskScenarioId, OWN_TOLERANCE);

      const profileAfter = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(profileAfter?.updatedAt).toEqual(profileBefore?.updatedAt);
      await expect(services.withOrigin(adminOrigin).riskScenarios.isEstimatesRecomputePending(riskScenarioId)).resolves.toBe(false);
    });

    it('should refuse an amount at zero or a probability out of 0.1% to 100% in the database too', async () => {
      await expect(db.insert(organizationRiskTolerances).values({ id: organizationId, organizationId, annualLoss: 0, maxExceedanceProbability: 0.1 })).rejects.toThrow();
      await expect(db.insert(organizationRiskTolerances).values({ id: organizationId, organizationId, annualLoss: 1, maxExceedanceProbability: 0.0009 })).rejects.toThrow();
      await expect(db.insert(organizationRiskTolerances).values({ id: organizationId, organizationId, annualLoss: 1, maxExceedanceProbability: 1.01 })).rejects.toThrow();
    });

    it('should neither read nor write another tenant scope tolerance', async () => {
      await services.withOrigin(adminOrigin).organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      const tenant2Id = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenant2Id };

      await expect(services.withOrigin(otherOrigin).organizations.getRiskTolerance(organizationId))
        .resolves.toEqual({ tolerance: null, scenarioCount: 0, ownThresholdCount: 0 });
      await expect(services.withOrigin(otherOrigin).organizations.setRiskTolerance(organizationId, OWN_TOLERANCE)).rejects.toThrow();
      await expect(readTolerance(adminOrigin)).resolves.toEqual(SCOPE_TOLERANCE);
    });
  });

  describe('on a risk scenario', () => {
    const ownRows = () => db.select().from(riskScenarioRiskTolerances).where(eq(riskScenarioRiskTolerances.riskScenarioId, riskScenarioId));

    it('should store the scenario own threshold, and drop it when it follows its scope again', async () => {
      await services.withOrigin(adminOrigin).riskScenarios.setRiskTolerance(riskScenarioId, OWN_TOLERANCE);
      expect(await ownRows()).toHaveLength(1);

      await expect(services.withOrigin(adminOrigin).riskScenarios.setRiskTolerance(riskScenarioId, null)).resolves.toBe(true);
      expect(await ownRows()).toEqual([]);
    });

    it('should go with the scenario', async () => {
      await services.withOrigin(adminOrigin).riskScenarios.setRiskTolerance(riskScenarioId, OWN_TOLERANCE);

      await services.withOrigin(adminOrigin).riskScenarios.deleteRiskScenarios([riskScenarioId]);

      expect(await ownRows()).toEqual([]);
    });

    it('should report another tenant scenario as missing and write nothing', async () => {
      const tenant2Id = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenant2Id };

      await expect(services.withOrigin(otherOrigin).riskScenarios.setRiskTolerance(riskScenarioId, OWN_TOLERANCE)).resolves.toBe(false);
      expect(await ownRows()).toEqual([]);
    });
  });
});
