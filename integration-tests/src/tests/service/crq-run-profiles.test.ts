import type { CrqRunProfile, EventOrigin } from '@app/module';
import {
  crqControlWhatIfResults,
  crqIndicatorRuns,
  crqPlanWhatIfResults,
  crqTechniqueWhatIfResults,
  PRICE_RUN_PROFILE,
  scenarioLossEstimates,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttackRunScenarioOptions } from '../../helpers/attack-run-scenario';
import { runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('CRQ run profiles', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;
  let attackOutcomeId: string;

  const scoped = () => services.withOrigin(adminOrigin);
  const run = (profile?: CrqRunProfile) => runAttackRun(services, adminOrigin, riskScenarioId, tenantId, profile);

  const freshScenario = async (options?: AttackRunScenarioOptions) => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    await scoped().crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 100 });
    ({ organizationId, riskScenarioId, attackOutcomeId } = await seedAttackRunScenario(services, adminOrigin, tenantId, options));
  };

  const planMoving = async (capabilityId: string) => {
    const planId = await scoped().treatmentPlans.createTreatmentPlan({ organizationId, name: `Raise ${capabilityId}` });
    await scoped().treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }]);
    return planId;
  };

  const storedRows = async (runId: string) => ({
    levers: await db.select().from(crqControlWhatIfResults).where(eq(crqControlWhatIfResults.runId, runId)),
    techniques: await db.select().from(crqTechniqueWhatIfResults).where(eq(crqTechniqueWhatIfResults.runId, runId)),
    plans: await db.select().from(crqPlanWhatIfResults).where(eq(crqPlanWhatIfResults.runId, runId)),
  });

  const storedRun = async (runId: string) => (await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId)))[0];

  beforeEach(async () => {
    await freshScenario();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('what a run stores', () => {
    it('records the profile it computed', async () => {
      const full = await run();
      const price = await run(PRICE_RUN_PROFILE);
      const levers = await run({ techniques: false, cves: false, levers: [full.result.controlValues[0].controlId], plans: [] });

      expect((await storedRun(full.runId)).profile).toEqual(['techniques', 'cves', 'levers', 'plans']);
      expect((await storedRun(price.runId)).profile).toEqual([]);
      expect((await storedRun(levers.runId)).profile).toEqual([`levers:${full.result.controlValues[0].controlId}`]);
    });

    it('answers a price profile with the headline of a full run, and writes none of its what-if rows', async () => {
      // The actor mixture decays against the day, so the clock is held for the two runs not to straddle midnight.
      vi.useFakeTimers({ toFake: ['Date'] });
      const full = await run();
      await planMoving(full.result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!.controlId);
      const reference = await run();
      const price = await run(PRICE_RUN_PROFILE);

      expect(Object.is(price.result.ale.mean, reference.result.ale.mean)).toBe(true);
      expect(price.result.ale).toStrictEqual(reference.result.ale);
      expect(price.result.annualLoss).toStrictEqual(reference.result.annualLoss);
      expect(price.result.calibration.memorylessAle).toBe(reference.result.calibration.memorylessAle);

      const { id: _priceId, createdAt: _priceAt, profile: _priceProfile, inputsFingerprint: _priceInputs, ...priceRow } = await storedRun(price.runId);
      const { id: _fullId, createdAt: _fullAt, profile: _fullProfile, inputsFingerprint: _fullInputs, ...fullRow } = await storedRun(reference.runId);
      expect(priceRow).toStrictEqual(fullRow);
      expect(await storedRows(price.runId)).toEqual({ levers: [], techniques: [], plans: [] });
      const fullRows = await storedRows(reference.runId);
      expect(fullRows.levers.length).toBeGreaterThan(0);
      expect(fullRows.techniques.length).toBeGreaterThan(0);
      expect(fullRows.plans).toHaveLength(1);
    });

    it('writes the levers of the controls it names and nothing else', async () => {
      const full = await run();
      const named = full.result.controlValues[1].controlId;

      const levers = await run({ techniques: false, cves: false, levers: [named], plans: [] });

      const rows = await storedRows(levers.runId);
      expect(rows.levers.length).toBeGreaterThan(0);
      expect(new Set(rows.levers.map((row) => row.controlId))).toEqual(new Set([named]));
      expect(rows.techniques).toEqual([]);
      expect(rows.plans).toEqual([]);
    });

    it('counts the techniques it scored on a run that computes none of their values', async () => {
      const full = await run();
      const price = await run(PRICE_RUN_PROFILE);

      expect((await storedRun(price.runId)).techniqueCount).toBe((await storedRun(full.runId)).techniqueCount);
      expect((await storedRun(price.runId)).coveredTechniqueCount).toBe((await storedRun(full.runId)).coveredTechniqueCount);
    });

    /*
     * A run that cannot price writes every family at null whatever it was booked for, with the rows
     * and the zero reasons a priced run of the same scenario writes, so no older run's euros stay
     * on screen beside a headline that has none.
     */
    const shapeOf = async (runId: string) => {
      const rows = await storedRows(runId);
      return {
        levers: rows.levers.map((row) => `${row.controlId}|${row.dimension}|${row.zeroReason}`).toSorted(),
        techniques: rows.techniques.map((row) => row.mitreTechniqueId).toSorted(),
        plans: rows.plans.map((row) => row.planId).toSorted(),
      };
    };

    const expectUnpricedLikePriced = async (unpricedRunId: string, pricedRunId: string) => {
      expect((await storedRun(unpricedRunId)).profile).toEqual(['techniques', 'cves', 'levers', 'plans']);
      expect((await storedRun(unpricedRunId)).aleMean).toBeNull();
      expect(await shapeOf(unpricedRunId)).toEqual(await shapeOf(pricedRunId));
      const rows = await storedRows(unpricedRunId);
      expect(rows.plans).toHaveLength(1);
      expect(rows.levers.every((row) => row.aleReductionMean === null)).toBe(true);
      expect(rows.techniques.every((row) => row.preventValueMean === null && row.detectValueMean === null)).toBe(true);
      expect(rows.plans.every((row) => row.aleReductionMean === null)).toBe(true);
      expect((await storedRun(unpricedRunId)).techniqueCount).toBe(rows.techniques.length);
    };

    it('writes every family at null on a price run without a loss estimate, as a priced run of the scenario does', async () => {
      const first = await run();
      await planMoving(first.result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!.controlId);
      const priced = await run();
      await db.delete(scenarioLossEstimates).where(eq(scenarioLossEstimates.riskScenarioId, riskScenarioId));

      const unpriced = await run(PRICE_RUN_PROFILE);

      await expectUnpricedLikePriced(unpriced.runId, priced.runId);
      const levers = await scoped().crqIndicators.getWhatIfResults(riskScenarioId);
      expect(levers.length).toBeGreaterThan(0);
      expect(levers.every((row) => row.runId === unpriced.runId && row.aleReductionMean === null)).toBe(true);
    });

    it('writes every family at null on a price run without a TEF, as a priced run of the scenario does', async () => {
      await freshScenario({ tef: false });
      const first = await run(PRICE_RUN_PROFILE);
      await planMoving(first.result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!.controlId);

      const unpriced = await run(PRICE_RUN_PROFILE);
      await scoped().crqIndicators.upsertTefInput({ riskScenarioId, min: 0.5, likely: 1, max: 3 });
      const priced = await run();

      await expectUnpricedLikePriced(unpriced.runId, priced.runId);
    });
  });

  describe('reading each family from the latest run that computed it', () => {
    it('reads every family a price run did not compute from the full run before it', async () => {
      const first = await run();
      const planId = await planMoving(first.result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!.controlId);
      const full = await run();

      const read = async (runId: string) => {
        const detail = (await scoped().crqIndicators.getRunWithScores(runId))!;
        return {
          levers: await scoped().crqIndicators.getWhatIfResults(riskScenarioId),
          techniques: detail.techniqueWhatIfResults,
          techniqueSource: detail.techniqueSource,
          outcomeControls: (await scoped().crqIndicators.getCrqSummaryForOutcome({ attackOutcomeId, organizationId })).topControls,
          topControls: await scoped().dashboard.getTopControls(organizationId),
          topControlMoves: await scoped().dashboard.getTopControlMoves(organizationId),
          techniqueGains: await scoped().dashboard.getTechniqueGains(organizationId),
          flowTechniques: (await scoped().dashboard.getExposureFlow(organizationId)).scenarios.map((scenario) => scenario.techniques),
          riskTreatmentMoves: (await scoped().dashboard.getRiskTreatment({ organizationId })).map((card) => card.topControlMoves),
          plan: (await scoped().treatmentPlans.getTreatmentPlanProjection(planId))!.scenarios
            .map(({ olderThanHeadline: _olderThanHeadline, ...scenario }) => scenario),
          planTotal: (await scoped().treatmentPlans.getTreatmentPlans(organizationId)).find((plan) => plan.id === planId)!.totalAleReduction,
          candidates: await scoped().treatmentPlans.getTreatmentPlanCandidates(planId),
        };
      };
      const before = await read(full.runId);
      expect(before.levers.length).toBeGreaterThan(0);
      expect(before.techniques.length).toBeGreaterThan(0);
      expect(before.techniqueSource).toEqual(await storedRun(full.runId));
      expect(before.planTotal).not.toBeNull();
      expect(before.riskTreatmentMoves.flat().length).toBeGreaterThan(0);
      expect(before.topControls.length).toBeGreaterThan(0);
      expect(before.outcomeControls.length).toBeGreaterThan(0);
      expect(before.flowTechniques.flat().length).toBeGreaterThan(0);

      const price = await run(PRICE_RUN_PROFILE);

      expect((await scoped().crqIndicators.getLatestRun(riskScenarioId)).id).toBe(price.runId);
      expect(await read(price.runId)).toStrictEqual(before);
      expect((await scoped().treatmentPlans.getTreatmentPlanProjection(planId))!.scenarios.map((scenario) => scenario.olderThanHeadline))
        .toEqual([true]);
    });

    it('reads a named control\'s levers from the partial run, and every other control\'s from the full run', async () => {
      const full = await run();
      const named = full.result.controlValues[1].controlId;

      const levers = await run({ techniques: false, cves: false, levers: [named], plans: [] });

      const rows = await scoped().crqIndicators.getWhatIfResults(riskScenarioId);
      const fullRows = await storedRows(full.runId);
      expect(rows).toHaveLength(fullRows.levers.length);
      expect(rows.filter((row) => row.controlId === named).every((row) => row.runId === levers.runId)).toBe(true);
      expect(rows.filter((row) => row.controlId !== named).every((row) => row.runId === full.runId)).toBe(true);
    });

    it('reads a named plan from the partial run, with that run\'s own ALE, and every other plan from the full run', async () => {
      const first = await run();
      const [one, other] = first.result.controlValues.filter((value) => value.declaredStrengthRung === 'L2');
      const namedPlan = await planMoving(one.controlId);
      const otherPlan = await planMoving(other.controlId);
      const full = await run();

      const plan = await run({ techniques: false, cves: false, levers: [], plans: [namedPlan] });

      const [named] = (await scoped().treatmentPlans.getTreatmentPlanProjection(namedPlan))!.scenarios;
      expect(named).toMatchObject({ state: 'priced', runId: plan.runId, aleMean: plan.result.ale.mean });
      const [unnamed] = (await scoped().treatmentPlans.getTreatmentPlanProjection(otherPlan))!.scenarios;
      expect(unnamed).toMatchObject({ state: 'priced', runId: full.runId, aleMean: full.result.ale.mean });
      const listed = await scoped().treatmentPlans.getTreatmentPlans(organizationId);
      expect(listed.find((row) => row.id === namedPlan)!.totalAleReduction).toBe(named.aleReductionMean);
      expect(listed.find((row) => row.id === otherPlan)!.totalAleReduction).toBe(unnamed.aleReductionMean);
    });

    it('stops reading a control from an older run once a newer full run no longer carries it', async () => {
      const full = await run();
      const named = full.result.controlValues[1].controlId;
      await run({ techniques: false, cves: false, levers: [named], plans: [] });
      const newer = await run();
      await db.delete(crqControlWhatIfResults).where(eq(crqControlWhatIfResults.runId, newer.runId));

      expect(await scoped().crqIndicators.getWhatIfResults(riskScenarioId)).toEqual([]);
    });

    it('reads nothing of a family no run has computed yet', async () => {
      const { runId } = await run(PRICE_RUN_PROFILE);

      expect(await scoped().crqIndicators.getWhatIfResults(riskScenarioId)).toEqual([]);
      expect(await scoped().dashboard.getTopControls(organizationId)).toEqual([]);
      expect((await scoped().crqIndicators.getRunWithScores(runId))!.techniqueWhatIfResults).toEqual([]);
      expect((await scoped().crqIndicators.getRunWithScores(runId))!.techniqueSource).toBeNull();
    });
  });
});
