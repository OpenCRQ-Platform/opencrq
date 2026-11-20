import type { CrqRunProfile, EventOrigin } from '@app/module';
import { controlCapabilities, createSecuredSchema, crqBudgetReviewAnnualLosses, crqBudgetReviewResults, crqCveWhatIfResults, crqIndicatorRuns, crqIndicatorsRepository, crqPlanWhatIfResults, cve, PRICE_RUN_PROFILE, reviewFigureSlots } from '@app/module';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AttackRunScenarioOptions } from '../../helpers/attack-run-scenario';
import { EXPOSED_ESTATE, LOG4SHELL, MINOR_FLAW, runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * The CRQ service around the attack run engine: what a run persists, how it reads back, and what the
 * surfaces are entitled to find on it. The engine's own answers are exercised in
 * `attack-run-engine.test.ts`; this file is about the seams the screens read through.
 */
describe('CRQ Indicators Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;

  const run = (profile?: CrqRunProfile) => runAttackRun(services, adminOrigin, riskScenarioId, tenantId, profile);

  /** The seams hold at any world count, and the default thousand worlds is most of what a test here costs. */
  const freshScenario = async (options?: AttackRunScenarioOptions) => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 100 });
    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId, options));
  };

  beforeEach(async () => {
    await freshScenario();
  });

  /*
   * A treatment plan is priced on the run's own worlds, as one posture rather than as a sum of its
   * controls. The engine's own properties are asserted in `engine-run.test.ts`; what this covers
   * is the seam: that a plan of the tenant reaches the engine, that it gets one row per run, and
   * that no other tenant can read it.
   */
  describe('what a run says about a treatment plan', () => {
    const planMoving = async (capabilityId: string, targets: { rung: 'L3' | null, bucket: 'L3' | null }) => {
      const scoped = services.withOrigin(adminOrigin);
      const planId = await scoped.treatmentPlans.createTreatmentPlan({ organizationId, name: 'Harden the estate' });
      await scoped.treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: targets.rung, targetCoverageBucket: targets.bucket }]);
      return planId;
    };

    /*
     * A bare run row, for the tests that need nothing from a run but the parent of a foreign key.
     * Turning the engine to obtain one would couple a repository test to the whole simulation, and
     * every column below is a `not null` with no meaning to these assertions.
     */
    const bareRun = async (): Promise<string> => {
      const id = uuidv7();
      await db.insert(crqIndicatorRuns).values({
        id,
        riskScenarioId,
        iterations: 1,
        vulnerabilityP5: 0,
        vulnerabilityP50: 0,
        vulnerabilityP95: 0,
        techniqueCount: 0,
        coveredTechniqueCount: 0,
      });
      return id;
    };

    /** A capability of the catalogue this scenario's run does not carry, which no plan can move here. */
    const outOfScopeCapabilityId = async (inScopeIds: ReadonlySet<string>): Promise<string> => {
      const catalogue = await db.select({ id: controlCapabilities.id }).from(controlCapabilities);
      return catalogue.find((capability) => !inScopeIds.has(capability.id))!.id;
    };

    it('prices every plan that moves a control, once per run, and never below zero', async () => {
      // "In scope" is the run's own control set, so the first run is what names the capability the
      // plan then moves. A plan naming a capability outside it is the other case asserted here.
      const first = await run();
      const inScope = first.result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!;
      const outside = await outOfScopeCapabilityId(new Set(first.result.controlValues.map((value) => value.controlId)));

      const priced = await planMoving(inScope.controlId, { rung: 'L3', bucket: 'L3' });
      const elsewhere = await planMoving(outside, { rung: 'L3', bucket: null });
      const { runId } = await run();

      const rows = await db.select().from(crqPlanWhatIfResults).where(eq(crqPlanWhatIfResults.runId, runId));
      expect(rows).toHaveLength(2);
      const pricedRow = rows.find((row) => row.planId === priced)!;
      expect(pricedRow.aleReductionMean!).toBeGreaterThan(0);
      expect(pricedRow.aleReductionP10!).toBeGreaterThanOrEqual(0);
      expect(pricedRow.aleReductionP10!).toBeLessThanOrEqual(pricedRow.aleReductionP90!);

      const emptyRow = rows.find((row) => row.planId === elsewhere)!;
      expect(emptyRow.aleReductionMean).toBe(0);
    });

    /*
     * The list and the plan's own page answer one question, so they owe one answer. The page drops
     * a scenario whose inputs moved after its last run, that run describing a scenario that no
     * longer exists, and a list summing what the page drops gives the same plan two totals.
     */
    it('should report the same total on the list as on the plan page, priced and once gone stale', async () => {
      const first = await run();
      const inScope = first.result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!;
      const planId = await planMoving(inScope.controlId, { rung: 'L3', bucket: 'L3' });
      await run();
      const scoped = services.withOrigin(adminOrigin);

      const listed = (await scoped.treatmentPlans.getTreatmentPlans(organizationId)).find((plan) => plan.id === planId)!;
      expect(listed.totalAleReduction).toBeGreaterThan(0);
      expect(listed.totalAleReduction).toBe((await scoped.treatmentPlans.getTreatmentPlanProjection(planId))!.totalAleReduction);

      await scoped.crqIndicators.upsertTefInput({ riskScenarioId, min: 1, likely: 2, max: 5 });

      const stale = (await scoped.treatmentPlans.getTreatmentPlans(organizationId)).find((plan) => plan.id === planId)!;
      expect(stale.totalAleReduction).toBeNull();
      expect((await scoped.treatmentPlans.getTreatmentPlanProjection(planId))!.totalAleReduction).toBeNull();
    });

    it('should owe a re-simulation to a scenario until a run prices the moves on file', async () => {
      const first = await run();
      const inScope = first.result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!;
      const planId = await planMoving(inScope.controlId, { rung: 'L3', bucket: 'L3' });
      const scoped = services.withOrigin(adminOrigin);
      expect((await scoped.treatmentPlans.getTreatmentPlanSimulationScope(planId))!.toReprice).toEqual([riskScenarioId]);

      await run();
      expect(await scoped.treatmentPlans.getTreatmentPlanSimulationScope(planId)).toEqual({ riskScenarioIds: [riskScenarioId], toReprice: [] });

      await scoped.treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId: inScope.controlId, targetStrengthRung: 'L3', targetCoverageBucket: null }]);
      expect((await scoped.treatmentPlans.getTreatmentPlanSimulationScope(planId))!.toReprice).toEqual([riskScenarioId]);
    });

    it('should owe no re-simulation to a plan without a move, which no run prices', async () => {
      await run();
      const planId = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Nothing yet' });

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanSimulationScope(planId)).toEqual({ riskScenarioIds: [], toReprice: [] });
    });

    it('should not read the re-simulation scope of a plan of another tenant', async () => {
      const first = await run();
      const planId = await planMoving(first.result.controlValues[0].controlId, { rung: 'L3', bucket: null });
      const otherTenantId = await createTenant(services, adminUserId);
      const other: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      await expect(services.withOrigin(other).treatmentPlans.getTreatmentPlanSimulationScope(planId)).resolves.toBeUndefined();
    });

    it('adds no dimension to the persisted per-control lever list', async () => {
      const first = await run();
      const inScope = first.result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!;
      await planMoving(inScope.controlId, { rung: 'L3', bucket: null });
      await run();

      const whatIfs = await services.withOrigin(adminOrigin).crqIndicators.getWhatIfResults(riskScenarioId);
      expect([...new Set(whatIfs.map((row) => row.dimension))].sort())
        .toEqual(['coverage', 'deploy', 'strength']);
    });

    /*
     * A run prices the plans of its own scope and nothing else. A plan of another scope priced here
     * would answer what its controls do against a risk it does not claim to treat, and the screens
     * read the figure back filtered on the scope, so the row would be written and never read.
     *
     * The plans holding no move interleaved here are the point: creating a plan and then adding its
     * moves is the ordinary order, so a planning session leaves that state behind on its own, and a
     * move-less plan carries no row.
     */
    it('prices every plan of the scenario\'s own scope, and no plan of another', async () => {
      const first = await run();
      const inScope = first.result.controlValues[0].controlId;
      const scoped = services.withOrigin(adminOrigin);

      const foreignOrganizationId = uuidv7();
      await scoped.organizations.createOrganizations([{ id: foreignOrganizationId, name: 'Acme Overseas' }]);
      const foreignPlanId = await scoped.treatmentPlans.createTreatmentPlan({
        organizationId: foreignOrganizationId,
        name: 'Harden the other estate',
      });
      await scoped.treatmentPlans.addTreatmentPlanMoves(foreignPlanId, [{ capabilityId: inScope, targetStrengthRung: 'L3', targetCoverageBucket: null }]);

      const withMoves: Array<string> = [];
      for (let index = 0; index < 12; index += 1) {
        if (index % 3 === 0) {
          await scoped.treatmentPlans.createTreatmentPlan({ organizationId, name: `Not scoped yet ${index}` });
        }
        withMoves.push(await planMoving(inScope, { rung: 'L3', bucket: null }));
      }
      const { runId } = await run();

      const rows = await db.select().from(crqPlanWhatIfResults).where(eq(crqPlanWhatIfResults.runId, runId));
      expect(new Set(rows.map((row) => row.planId))).toEqual(new Set(withMoves));
    });

    /*
     * A figure is priced against one set of moves, and a plan's moves change under it. Deleting the
     * rows on a move mutation would not be enough on its own: a run that read the targets before
     * the edit still writes its row after it, so the row names the version it read and a reader
     * compares the two.
     */
    it('stamps each row with the scope version the run read', async () => {
      const first = await run();
      const [moved, second] = first.result.controlValues;
      const planId = await planMoving(moved.controlId, { rung: 'L3', bucket: null });
      const { runId } = await run();

      const [row] = await db.select().from(crqPlanWhatIfResults).where(eq(crqPlanWhatIfResults.runId, runId));
      const before = (await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId))!;
      expect(row.planScopeVersion).toBe(before.scopeVersion);

      // The same row, now priced against a posture the plan no longer asks for, is identifiable as
      // such without re-reading the moves.
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId: second.controlId, targetStrengthRung: 'L3', targetCoverageBucket: null }]);
      const after = (await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId))!;
      expect(after.scopeVersion).toBeGreaterThan(row.planScopeVersion);
    });

    /*
     * The write is the last statement of the transaction that stores a run, beside the run row and
     * six sibling tables, and `plan_id` carries a foreign key. A plan deleted while the run was
     * turning would therefore roll all of it back, so deleting one plan would destroy an unrelated
     * scenario's simulation. The batch drops what no longer exists instead of raising.
     *
     * Driven through the repository rather than through a run, because getting a vanished plan into
     * a live run's batch needs the very race a test cannot establish.
     */
    it('drops a plan that vanished between the read and the write, and keeps the rest', async () => {
      const runId = await bareRun();
      const scoped = services.withOrigin(adminOrigin);
      const livePlanId = await scoped.treatmentPlans.createTreatmentPlan({ organizationId, name: 'Still here' });
      const gonePlanId = await scoped.treatmentPlans.createTreatmentPlan({ organizationId, name: 'Deleted mid-run' });
      await scoped.treatmentPlans.deleteTreatmentPlans([gonePlanId]);

      const context = repositoryContextOf(db, adminOrigin);
      const rowFor = (planId: string) => ({
        id: uuidv7(),
        runId,
        planId,
        planScopeVersion: 1,
        aleReductionMean: 1000,
        aleReductionP10: 600,
        aleReductionP90: 1800,
        zeroReason: null,
      });

      // Unguarded, the same batch takes the run down with it: this is the hazard, not a hypothesis.
      await expect(db.insert(crqPlanWhatIfResults).values([rowFor(gonePlanId)])).rejects.toThrow();

      await expect(crqIndicatorsRepository.insertPlanWhatIfResults(
        context,
        [rowFor(livePlanId), rowFor(gonePlanId)],
      )).resolves.toBeUndefined();

      const rows = await db.select().from(crqPlanWhatIfResults).where(eq(crqPlanWhatIfResults.runId, runId));
      expect(rows.map((row) => row.planId)).toEqual([livePlanId]);
    });

    /*
     * The same guard on the budget review figures, which also drops a review closed meanwhile: its
     * figures were stored at its closing, and a row written after it would be one more reading.
     */
    it('drops the figures of a review closed or deleted, or of a line deleted, between the read and the write', async () => {
      const scoped = services.withOrigin(adminOrigin);
      const periodStart = `${new Date().getUTCFullYear()}-01-01`;
      const liveReviewId = await scoped.budgetReviews.createBudgetReview({ organizationId, name: 'Open', periodStart });
      const liveLineId = await scoped.budgetReviews.createBudgetReviewLine(liveReviewId, { name: 'Kept', nature: 'run', amountSpent: 1, capabilityIds: [] });
      const goneLineId = await scoped.budgetReviews.createBudgetReviewLine(liveReviewId, { name: 'Deleted', nature: 'run', amountSpent: 1, capabilityIds: [] });
      await scoped.budgetReviews.deleteBudgetReviewLines([goneLineId]);
      const closedReviewId = await scoped.budgetReviews.createBudgetReview({ organizationId, name: 'Closed', periodStart });
      await scoped.budgetReviews.createBudgetReviewLine(closedReviewId, { name: 'Closed with it', nature: 'run', amountSpent: 1, capabilityIds: [] });
      // A review closes only once priced on its scenario's latest run, so this run precedes the one under test.
      const pricingRunId = await bareRun();
      const closedReview = (await scoped.budgetReviews.getBudgetReview(closedReviewId))!;
      await db.insert(crqBudgetReviewResults).values(reviewFigureSlots(closedReview.lines).map(({ basket, lineId }) => ({
        id: uuidv7(), runId: pricingRunId, reviewId: closedReviewId, reviewVersion: closedReview.version, basket, lineId,
        aleReductionMean: 0, aleReductionP10: 0, aleReductionP90: 0,
      })));
      await scoped.budgetReviews.closeBudgetReview(closedReviewId);
      const runId = await bareRun();
      const goneReviewId = await scoped.budgetReviews.createBudgetReview({ organizationId, name: 'Deleted', periodStart });
      await scoped.budgetReviews.deleteBudgetReviews([goneReviewId]);

      const context = repositoryContextOf(db, adminOrigin);
      const rowFor = (reviewId: string, basket: 'line' | 'ensemble', lineId: string | null) => ({
        id: uuidv7(),
        runId,
        reviewId,
        reviewVersion: 1,
        basket,
        lineId,
        aleReductionMean: 1000,
        aleReductionP10: 600,
        aleReductionP90: 1800,
      });

      await expect(crqIndicatorsRepository.insertBudgetReviewResults(context, [
        rowFor(liveReviewId, 'ensemble', null),
        rowFor(liveReviewId, 'line', liveLineId),
        rowFor(liveReviewId, 'line', goneLineId),
        rowFor(closedReviewId, 'ensemble', null),
        rowFor(goneReviewId, 'ensemble', null),
      ], [liveReviewId, closedReviewId, goneReviewId].map((reviewId) => ({
        id: uuidv7(),
        runId,
        reviewId,
        reviewVersion: 1,
        posture: 'reference' as const,
        years: 10,
        mean: 100,
        lossYearShare: 0.5,
        lossEventYearShare: 0.4,
        probabilities: [0.5, 0.9],
        losses: [0, 300],
      })))).resolves.toBeUndefined();

      const rows = await db.select().from(crqBudgetReviewResults).where(eq(crqBudgetReviewResults.runId, runId));
      expect(rows.map((row) => `${row.reviewId}:${row.lineId ?? ''}`).sort())
        .toEqual([`${liveReviewId}:`, `${liveReviewId}:${liveLineId}`].sort());
      const annualLosses = await db.select().from(crqBudgetReviewAnnualLosses).where(eq(crqBudgetReviewAnnualLosses.runId, runId));
      expect(annualLosses.map((row) => row.reviewId)).toEqual([liveReviewId]);
    });

    /*
     * The version is written from what the caller was handed, never re-read from the plan, which is
     * what makes a row priced against an old posture stay identifiable instead of silently reading
     * as current.
     */
    it('stores the version it is given rather than the one the plan now holds', async () => {
      const runId = await bareRun();
      const scoped = services.withOrigin(adminOrigin);
      const planId = await scoped.treatmentPlans.createTreatmentPlan({ organizationId, name: 'Edited after pricing' });
      const [capability] = await db.select({ id: controlCapabilities.id }).from(controlCapabilities).limit(1);
      await scoped.treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId: capability.id, targetStrengthRung: 'L3', targetCoverageBucket: null }]);
      const current = (await scoped.treatmentPlans.getTreatmentPlan(planId))!.scopeVersion;
      expect(current).toBeGreaterThan(1);

      const context = repositoryContextOf(db, adminOrigin);
      await crqIndicatorsRepository.insertPlanWhatIfResults(context, [{
        id: uuidv7(),
        runId,
        planId,
        planScopeVersion: 1,
        aleReductionMean: 1000,
        aleReductionP10: 600,
        aleReductionP90: 1800,
      }]);

      const [row] = await db.select().from(crqPlanWhatIfResults).where(eq(crqPlanWhatIfResults.planId, planId));
      expect(row.planScopeVersion).toBe(1);
      expect(row.planScopeVersion).toBeLessThan(current);
    });

    it('shows no plan row of another tenant', async () => {
      const first = await run();
      await planMoving(first.result.controlValues[0].controlId, { rung: 'L3', bucket: null });
      await run();

      const otherTenantId = await createTenant(services, adminUserId);
      const other: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const mine = await db.select().from(createSecuredSchema(db, adminOrigin).crqPlanWhatIfResults);
      const theirs = await db.select().from(createSecuredSchema(db, other).crqPlanWhatIfResults);
      expect(mine).toHaveLength(1);
      expect(theirs).toEqual([]);
    });
  });

  describe('what a run says about each flaw of the door', () => {
    const rowsOf = (runId: string) => db.select().from(crqCveWhatIfResults).where(eq(crqCveWhatIfResults.runId, runId));

    it('writes one row per flaw carrying a signal above silence, the listed one worth money, and none for a silent one', async () => {
      await freshScenario(EXPOSED_ESTATE);
      const { runId, result } = await run();

      const rows = await rowsOf(runId);
      expect(rows).toHaveLength(result.cveValues.length);
      const cveRowIdOf = async (externalId: string) => (await db.select({ id: cve.id }).from(cve)
        .where(and(eq(cve.tenantId, tenantId), eq(cve.cveId, externalId))))[0].id;
      const log4Shell = await cveRowIdOf(LOG4SHELL.cveId);
      expect(result.cveValues.map((value) => value.cveId)).toEqual([log4Shell]);
      expect(rows.map((row) => row.cveId)).not.toContain(await cveRowIdOf(MINOR_FLAW.cveId));
      const stored = new Map(rows.map((row) => [row.cveId, row]));
      for (const value of result.cveValues) {
        expect(stored.get(value.cveId)).toMatchObject({
          aleReductionMean: value.aleReductionMean,
          aleReductionP10: value.aleReductionP10,
          aleReductionP90: value.aleReductionP90,
        });
      }
      expect(stored.get(log4Shell)!.aleReductionMean!).toBeGreaterThan(0);
    });

    it('writes none for an estate that opens no entry technique', async () => {
      const { runId, result } = await run();

      expect(result.cveValues).toEqual([]);
      expect(await rowsOf(runId)).toEqual([]);
    });

    it('writes none on a price run, which computes no CVE what-if, and a full run after it writes them again', async () => {
      await freshScenario(EXPOSED_ESTATE);
      const full = await run();
      const price = await run(PRICE_RUN_PROFILE);

      expect(price.result.cveValues).toEqual([]);
      expect(await rowsOf(price.runId)).toEqual([]);
      expect((await rowsOf(full.runId)).length).toBeGreaterThan(0);
      expect((await db.select({ profile: crqIndicatorRuns.profile }).from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, price.runId)))[0].profile).toEqual([]);
    });

    it('is deleted with its run', async () => {
      await freshScenario(EXPOSED_ESTATE);
      const { runId } = await run();
      expect((await rowsOf(runId)).length).toBeGreaterThan(0);

      await db.delete(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));

      expect(await rowsOf(runId)).toEqual([]);
    });

    it('shows no flaw row of another tenant', async () => {
      await freshScenario(EXPOSED_ESTATE);
      await run();

      const otherTenantId = await createTenant(services, adminUserId);
      const other: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const mine = await db.select().from(createSecuredSchema(db, adminOrigin).crqCveWhatIfResults);
      const theirs = await db.select().from(createSecuredSchema(db, other).crqCveWhatIfResults);
      expect(mine.length).toBeGreaterThan(0);
      expect(theirs).toEqual([]);
    });
  });
});
