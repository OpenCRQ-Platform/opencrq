import type { CrqRunProfile, EventOrigin } from '@app/module';
import { crqIndicatorRuns, cvesRunProfile, leversRunProfile, planRunProfile, PRICE_RUN_PROFILE } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('recomputing a control\'s levers and a plan\'s reduction', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;
  let controlId: string;
  let controlIds: Array<string>;
  let fullRunId: string;

  const scoped = () => services.withOrigin(adminOrigin);
  const run = (profile?: CrqRunProfile) => runAttackRun(services, adminOrigin, riskScenarioId, tenantId, profile);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    await scoped().crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 100 });
    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId));
    const full = await run();
    fullRunId = full.runId;
    controlId = full.result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!.controlId;
    controlIds = full.result.controlValues.map((value) => value.controlId);
  });

  describe('a control whose posture moves', () => {
    it('reports the axes a declaration moved, and none when it moved nothing', async () => {
      expect(await scoped().controlCapabilities.upsertAssessment(controlId, 'L3', null, null)).toEqual([{ capabilityId: controlId, axes: ['strength'] }]);
      expect(await scoped().controlCapabilities.upsertAssessment(controlId, 'L3', 'L2', null)).toEqual([]);
    });

    it('leaves out a scope whose own declaration pins the axis that moved', async () => {
      await scoped().controlCapabilities.declareScopePosture(organizationId, controlId, { strengthRung: 'L1', coverageBucket: null, comment: null });

      expect(await scoped().crqIndicators.getScenariosRepricedByCrossings([{ capabilityId: controlId, axes: ['strength'] }], tenantId)).toEqual([]);
      expect(await scoped().crqIndicators.getScenariosRepricedByCrossings([{ capabilityId: controlId, axes: ['coverage'] }], tenantId))
        .toEqual([{ riskScenarioId, controlIds: [controlId] }]);
    });
  });

  describe('a plan whose moves change', () => {
    it('reads its reduction as no longer expired once the plan run lands', async () => {
      const planId = await scoped().treatmentPlans.createTreatmentPlan({ organizationId, name: 'Raise one control' });
      await scoped().treatmentPlans.setTreatmentPlanScope(planId, [{ capabilityId: controlId, targetStrengthRung: 'L3', targetCoverageBucket: null }]);
      await run();
      await scoped().treatmentPlans.setTreatmentPlanScope(planId, [{ capabilityId: controlId, targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }]);
      expect((await scoped().treatmentPlans.getTreatmentPlanProjection(planId))!.scenarios[0].state).toBe('expired');

      await run(planRunProfile(planId));

      expect((await scoped().treatmentPlans.getTreatmentPlanProjection(planId))!.scenarios[0])
        .toMatchObject({ state: 'priced', olderThanHeadline: false });
    });

    it('marks a current reduction read from a run older than the ALE, and offers to re-simulate it', async () => {
      const planId = await scoped().treatmentPlans.createTreatmentPlan({ organizationId, name: 'Raise one control' });
      await scoped().treatmentPlans.setTreatmentPlanScope(planId, [{ capabilityId: controlId, targetStrengthRung: 'L3', targetCoverageBucket: null }]);
      await run();
      expect((await scoped().treatmentPlans.getTreatmentPlanSimulationScope(planId))!.toReprice).toEqual([]);

      await run(PRICE_RUN_PROFILE);

      expect((await scoped().treatmentPlans.getTreatmentPlanProjection(planId))!.scenarios[0])
        .toMatchObject({ state: 'priced', olderThanHeadline: true });
      expect((await scoped().treatmentPlans.getTreatmentPlanSimulationScope(planId))!.toReprice).toEqual([riskScenarioId]);
    });
  });

  describe('dating each figure family against the headline', () => {
    it('dates no family as recent as the headline', async () => {
      const dates = await scoped().crqIndicators.getFigureFamilyDates(riskScenarioId);

      expect(dates!.levers!.olderThanHeadline).toBe(false);
      expect(dates!.techniques!.olderThanHeadline).toBe(false);
      expect(dates!.cves!.olderThanHeadline).toBe(false);
    });

    it('dates the CVE values by the last full run, and as older than the headline once a price run follows it', async () => {
      const full = await scoped().crqIndicators.getFigureFamilyDates(riskScenarioId);
      const [fullRun] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, fullRunId));
      expect(full!.cves).toEqual({ computedAt: fullRun.createdAt, olderThanHeadline: false });

      await run(PRICE_RUN_PROFILE);

      const afterPrice = await scoped().crqIndicators.getFigureFamilyDates(riskScenarioId);
      expect(afterPrice!.headlineAt.getTime()).toBeGreaterThan(full!.headlineAt.getTime());
      expect(afterPrice!.cves).toEqual({ computedAt: fullRun.createdAt, olderThanHeadline: true });
    });

    it('books a run of the CVE family alone under the profile \'cves\', and dates the CVE values by it', async () => {
      await run(PRICE_RUN_PROFILE);

      const { runId } = await run(cvesRunProfile);

      const [booked] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
      expect(booked.profile).toEqual(['cves']);
      const dates = await scoped().crqIndicators.getFigureFamilyDates(riskScenarioId);
      expect(dates!.cves).toEqual({ computedAt: booked.createdAt, olderThanHeadline: false });
      expect(dates!.levers!.olderThanHeadline).toBe(true);
    });

    it('dates the levers by their oldest run once one control\'s levers are recomputed alone', async () => {
      const before = await scoped().crqIndicators.getFigureFamilyDates(riskScenarioId);

      await run(leversRunProfile([controlId]));

      const after = await scoped().crqIndicators.getFigureFamilyDates(riskScenarioId);
      expect(after!.headlineAt.getTime()).toBeGreaterThan(before!.headlineAt.getTime());
      expect(after!.levers).toEqual({ computedAt: before!.levers!.computedAt, olderThanHeadline: true });
      expect(after!.techniques).toEqual({ computedAt: before!.techniques!.computedAt, olderThanHeadline: true });
    });

    it('stops dating the levers once runs naming every control supply them all', async () => {
      await run(PRICE_RUN_PROFILE);

      await run(leversRunProfile(controlIds));

      expect((await scoped().crqIndicators.getFigureFamilyDates(riskScenarioId))!.levers!.olderThanHeadline).toBe(false);
    });

    it('stops dating a family once a run recomputes it whole', async () => {
      await run(PRICE_RUN_PROFILE);

      await run(leversRunProfile('all'));

      const dates = await scoped().crqIndicators.getFigureFamilyDates(riskScenarioId);
      expect(dates!.levers!.olderThanHeadline).toBe(false);
      expect(dates!.techniques!.olderThanHeadline).toBe(true);
    });
  });
});
