import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

/** The service-level reading is covered in `budget-reviews-pricing.test.ts`; this covers what the boundary lets through. */
describe('Budget review tolerance endpoint (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let origin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());
    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    origin = { type: 'client', userId: adminId, tenantId };
  });

  it('should return every scenario of a priced review with its tolerance and both curves', async () => {
    const scoped = services.withOrigin(origin);
    await scoped.crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 30 });
    const { organizationId, riskScenarioId } = await seedAttackRunScenario(services, origin, tenantId);
    await scoped.organizations.setRiskTolerance(organizationId, { annualLoss: 500_000, maxExceedanceProbability: 0.1 });
    const reviewId = await scoped.budgetReviews.createBudgetReview({ organizationId, name: 'Exercice', periodStart: `${new Date().getUTCFullYear()}-01-01` });
    await scoped.budgetReviews.createBudgetReviewLine(reviewId, { name: 'Licences', nature: 'run', amountSpent: 1000, capabilityIds: [] });
    await scoped.crqIndicators.runAttackRunEngine(riskScenarioId, tenantId, undefined, undefined, undefined, { priceBudgetReviews: true });

    const response = await client.query('budgetReviews.getBudgetReviewTolerance', { reviewId }, { tenantId });

    expect(response.status).toBe(200);
    const data = response.json.result.data;
    expect(data).toMatchObject({
      reference: 'today',
      state: 'priced',
      scenarios: [{
        scenarioId: riskScenarioId,
        name: 'Ransomware on the customer estate',
        tolerance: { annualLoss: 500_000, maxExceedanceProbability: 0.1, source: 'scope' },
        reference: { beyondTail: expect.any(Boolean), probability: expect.any(Number) },
        withoutBuild: { beyondTail: expect.any(Boolean), probability: expect.any(Number) },
      }],
    });
    expect(data.scenarios[0].reference.curve[0]).toEqual({ loss: 0, probability: expect.any(Number) });
    expect(data.scenarios[0].withoutBuild).toEqual(data.scenarios[0].reference);
  });

  it('should answer null for a review the caller cannot read', async () => {
    const response = await client.query('budgetReviews.getBudgetReviewTolerance', { reviewId: uuidv7() }, { tenantId });

    expect(response.status).toBe(200);
    expect(response.json.result.data).toBeNull();
  });
});
