import type { CrqRunProfile, EventOrigin } from '@app/module';
import {
  AttackOutcome_DataBreachResale, createSecuredSchema, crqIndicatorRunAnnualLosses, crqIndicatorRuns, deriveSeedId,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttackRunScenarioOptions } from '../../helpers/attack-run-scenario';
import { EXPOSED_ESTATE, runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

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
  let attackOutcomeId: string;

  const run = (profile?: CrqRunProfile) => runAttackRun(services, adminOrigin, riskScenarioId, tenantId, profile);

  /** The seams hold at any world count, and the default thousand worlds is most of what a test here costs. */
  const freshScenario = async (options?: AttackRunScenarioOptions) => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 100 });
    ({ organizationId, riskScenarioId, attackOutcomeId } = await seedAttackRunScenario(services, adminOrigin, tenantId, options));
  };

  beforeEach(async () => {
    await freshScenario();
  });

  describe('what a run persists', () => {
    it('reads back whole through getRunWithScores: actors, technique values, reach gaps and unplayable obstacles', async () => {
      const { runId, result, reach } = await run();

      const detail = await services.withOrigin(adminOrigin).crqIndicators.getRunWithScores(runId);
      expect(detail).toBeDefined();
      expect(detail!.groupScores).toHaveLength(2);
      for (const actor of detail!.groupScores) {
        expect(actor.groupKey).not.toBeNull();
        expect(actor.actorClass).not.toBeNull();
        expect(actor.attackRunDays).toBeGreaterThan(0);
        expect(actor.aleMean).not.toBeNull();
        expect(actor.reactionTimeExceededShare).not.toBeNull();
      }
      expect(detail!.groupScores.reduce((sum, actor) => sum + actor.share, 0)).toBeCloseTo(1, 10);

      expect(detail!.techniqueWhatIfResults).toHaveLength(new Set(result.techniqueValues.map((value) => value.techniqueExternalId)).size);
      const totals = detail!.techniqueWhatIfResults.map((row) => row.preventValueMean! + row.detectValueMean!);
      for (let index = 1; index < totals.length; index += 1) {
        expect(totals[index - 1]).toBeGreaterThanOrEqual(totals[index]);
      }
      expect(detail!.techniqueWhatIfResults.every((row) => /^T\d{4}$/.test(row.externalId) && row.name.length > 0)).toBe(true);
      expect(detail!.techniqueWhatIfResults.every((row) => row.preventValueMean! >= 0 && row.detectValueMean! >= 0)).toBe(true);

      const estateGaps = detail!.reachGaps.filter((gap) => gap.gap === 'estate');
      const catalogueGaps = detail!.reachGaps.filter((gap) => gap.gap === 'catalogue');
      expect(estateGaps).toHaveLength(reach.uncontestedByEstate.length);
      expect(catalogueGaps).toHaveLength(reach.uncontestableByCatalogue.length);
      expect(detail!.uncontestedPairCount).toBe(estateGaps.length);
      expect(detail!.uncontestablePairCount).toBe(catalogueGaps.length);
      expect(new Set(catalogueGaps.map((gap) => `${gap.externalId}|${gap.family}`)))
        .toEqual(new Set(reach.uncontestableByCatalogue.map((pair) => `${pair.techniqueExternalId}|${pair.family}`)));

      const unplayable = result.actors.flatMap((actor) => actor.unplayableObstacleKeys.map((key) => `${actor.actorClass}|${key}`));
      const classByRowKey = new Map(detail!.groupScores.map((actor) => [actor.groupKey, actor.actorClass]));
      expect(new Set(detail!.unplayableObstacles.map((row) => `${classByRowKey.get(row.groupKey)}|${row.obstacleKey}`))).toEqual(new Set(unplayable));
    });

    it('should run a simulation a service account booked on the tenant’s settings, as one a member booked', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'xtm-one', description: null });
      const serviceAccountOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId };

      const { runId } = await runAttackRun(services, serviceAccountOrigin, riskScenarioId, tenantId);

      const [stored] = await db.select({ iterations: crqIndicatorRuns.iterations }).from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
      expect(stored.iterations).toBe(100);
    });

    it('should store the mean and the p10 to p90 band of the LEF and the ALE the engine computed', async () => {
      // The default estate exposes nothing, so most worlds lose nothing and the band has no width.
      await freshScenario(EXPOSED_ESTATE);
      const { runId, result } = await run();

      const stored = await services.withOrigin(adminOrigin).crqIndicators.getRunWithScores(runId);
      expect(stored).toMatchObject({
        lefMean: result.lef.mean,
        lefP10: result.lef.p10,
        lefP90: result.lef.p90,
        aleMean: result.ale.mean,
        aleP10: result.ale.p10,
        aleP90: result.ale.p90,
      });
      expect(stored!.aleP10!).toBeLessThan(stored!.aleP90!);
      expect(stored!.lefP10!).toBeLessThan(stored!.lefP90!);
    });

    it('offers only the levers that can move the answer, each with its spread and its zero reason', async () => {
      await run();

      const whatIfs = await services.withOrigin(adminOrigin).crqIndicators.getWhatIfResults(riskScenarioId);
      expect(whatIfs.length).toBeGreaterThan(0);
      const byControl = new Map<string, Array<typeof whatIfs[number]>>();
      for (const row of whatIfs) {
        byControl.set(row.controlId, [...(byControl.get(row.controlId) ?? []), row]);
      }
      for (const rows of byControl.values()) {
        const dimensions = rows.map((row) => row.dimension).sort();
        const declared = rows[0];
        if (declared.currentStrength === 'L0' && declared.currentCoverage === 'L0') {
          // A control at the anchor is asked the joint step and nothing else.
          expect(dimensions).toEqual(['deploy']);
        } else {
          expect(dimensions).not.toContain('deploy');
        }
        for (const row of rows) {
          expect(row.aleReductionMean).not.toBeNull();
          expect(row.aleReductionP10!).toBeLessThanOrEqual(row.aleReductionP90!);
        }
      }
      expect(whatIfs.some((row) => row.aleReductionMean! > 0)).toBe(true);
    });

    it('prices nothing without a TEF, and still answers the reach and the outcome split', async () => {
      await freshScenario({ tef: false, losses: false });

      const { runId } = await run();
      const stored = await services.withOrigin(adminOrigin).crqIndicators.getRunWithScores(runId);
      expect(stored).toMatchObject({ lefMean: null, lefP10: null, lefP90: null, aleMean: null, aleP10: null, aleP90: null });
      expect(stored!.aleAtMemorylessDetection).toBeNull();
      expect(stored!.tefLikely).toBeNull();
      expect(stored!.magnitudeMean).toBeNull();
      expect(stored!.magnitudeP10).toBeNull();
      expect(stored!.magnitudeP90).toBeNull();
      expect(stored!.outcomeBlocked).not.toBeNull();
      expect(stored!.uncontestedPairCount).not.toBeNull();
      expect(stored!.techniqueWhatIfResults.length).toBeGreaterThan(0);
      expect(stored!.techniqueWhatIfResults.every((row) => row.preventValueMean === null && row.detectValueMean === null)).toBe(true);
      const whatIfs = await services.withOrigin(adminOrigin).crqIndicators.getWhatIfResults(riskScenarioId);
      expect(whatIfs.length).toBeGreaterThan(0);
      expect(whatIfs.every((row) => row.aleReductionMean === null)).toBe(true);
      expect(whatIfs.every((row) => row.aleReductionP10 === null && row.aleReductionP90 === null)).toBe(true);
      expect(stored!.annualLoss).toBeNull();
    });

    it('stores the loss magnitude without a TEF when the losses are estimated, and prices nothing', async () => {
      await freshScenario({ tef: false });

      const { runId, result } = await run();
      const stored = await services.withOrigin(adminOrigin).crqIndicators.getRunWithScores(runId);
      expect(stored).toMatchObject({ lefMean: null, lefP10: null, lefP90: null, aleMean: null, aleP10: null, aleP90: null });
      expect(stored!.tefLikely).toBeNull();
      expect(result.magnitude.mean).toBeGreaterThan(0);
      expect(stored!.magnitudeMean).toBeCloseTo(result.magnitude.mean, 10);
      expect(stored!.magnitudeP10).toBeCloseTo(result.magnitude.p10, 10);
      expect(stored!.magnitudeP90).toBeCloseTo(result.magnitude.p90, 10);
    });

    it('should store the annual loss quantiles the engine sampled', async () => {
      const { runId, result } = await run();

      const stored = await services.withOrigin(adminOrigin).crqIndicators.getRunWithScores(runId);
      expect(result.annualLoss.mean).toBeGreaterThan(0);
      expect(stored!.annualLoss).toEqual(result.annualLoss);
    });

    it('should read a run stored without an annual loss as having none, without error', async () => {
      const { runId } = await run();
      await db.delete(crqIndicatorRunAnnualLosses).where(eq(crqIndicatorRunAnnualLosses.runId, runId));

      const stored = await services.withOrigin(adminOrigin).crqIndicators.getRunWithScores(runId);
      expect(stored!.aleMean).not.toBeNull();
      expect(stored!.annualLoss).toBeNull();
    });

    it('should drop the annual loss with its run', async () => {
      const { runId } = await run();
      await db.delete(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));

      await expect(db.select().from(crqIndicatorRunAnnualLosses)).resolves.toEqual([]);
    });

    it('should show no annual loss of another tenant', async () => {
      await run();

      const otherTenantId = await createTenant(services, adminUserId);
      const other: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const mine = await db.select().from(createSecuredSchema(db, adminOrigin).crqIndicatorRunAnnualLosses);
      const theirs = await db.select().from(createSecuredSchema(db, other).crqIndicatorRunAnnualLosses);
      expect(mine).toHaveLength(1);
      expect(theirs).toEqual([]);
    });

    it('draws the frequency from the auto TEF estimate when the scenario is in auto mode', async () => {
      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(riskScenarioId, 'auto', tenantId);
      const estimate = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);

      const { runId } = await run();
      const stored = await services.withOrigin(adminOrigin).crqIndicators.getLatestRun(riskScenarioId);
      expect(stored.id).toBe(runId);
      expect(stored.tefMin).toBe(estimate.min);
      expect(stored.tefLikely).toBe(estimate.likely);
      expect(stored.tefMax).toBe(estimate.max);
    });

    it('is deterministic on the scenario id as seed', async () => {
      /*
       * The attacker mixture decays its evidence against the wall clock, so two runs separated by
       * real milliseconds normalise slightly different shares and the answer moves in the last ulp.
       * Holding the clock leaves the seed as the only thing the second run could disagree on.
       */
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const first = await run();
        const second = await run();
        expect(second.result.ale.mean).toBe(first.result.ale.mean);
        expect(second.result.outcomes).toEqual(first.result.outcomes);
        const stored = await Promise.all([first, second].map(({ runId }) =>
          services.withOrigin(adminOrigin).crqIndicators.getRunWithScores(runId)));
        expect(stored[1]!.annualLoss!.quantiles).toEqual(stored[0]!.annualLoss!.quantiles);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('reading runs', () => {
    it('returns undefined and an empty history before any run', async () => {
      await expect(services.withOrigin(adminOrigin).crqIndicators.getLatestRun(riskScenarioId)).resolves.toBeUndefined();
      await expect(services.withOrigin(adminOrigin).crqIndicators.getRunHistory(riskScenarioId)).resolves.toEqual([]);
      await expect(services.withOrigin(adminOrigin).crqIndicators.getRunWithScores(uuidv7())).resolves.toBeUndefined();
      await expect(services.withOrigin(adminOrigin).crqIndicators.getWhatIfResults(riskScenarioId)).resolves.toEqual([]);
    });

    it('lists the history newest first and the latest run on top', async () => {
      const first = await run();
      const second = await run();

      const history = await services.withOrigin(adminOrigin).crqIndicators.getRunHistory(riskScenarioId);
      expect(history.map((row) => row.id)).toEqual([second.runId, first.runId]);
      const latest = await services.withOrigin(adminOrigin).crqIndicators.getLatestRun(riskScenarioId);
      expect(latest.id).toBe(second.runId);
    });

    it('carries the cost of one attack that lands in the history', async () => {
      const { runId, result } = await run();

      const history = await services.withOrigin(adminOrigin).crqIndicators.getRunHistory(riskScenarioId);
      expect(history.find((row) => row.id === runId)!.magnitudeMean).toBeCloseTo(result.magnitude.mean, 10);
      const stored = await services.withOrigin(adminOrigin).crqIndicators.getLatestRun(riskScenarioId);
      expect(stored.magnitudeP10).toBeCloseTo(result.magnitude.p10, 10);
      expect(stored.magnitudeP90).toBeCloseTo(result.magnitude.p90, 10);
    });

    it('pages the history newest first and counts every run of the scenario', async () => {
      const first = await run();
      const second = await run();
      const third = await run();
      const crq = services.withOrigin(adminOrigin).crqIndicators;

      const head = await crq.listRunHistory(riskScenarioId, { page: 1, limit: 2, sortDesc: true });
      const tail = await crq.listRunHistory(riskScenarioId, { page: 2, limit: 2, sortDesc: true });

      expect(head.items.map((row) => row.id)).toEqual([third.runId, second.runId]);
      expect(tail.items.map((row) => row.id)).toEqual([first.runId]);
      expect(head.total).toBe(3);
      expect(tail.total).toBe(3);
    });

    it('pages the history oldest first when asked', async () => {
      const first = await run();
      const second = await run();
      await run();

      const head = await services.withOrigin(adminOrigin).crqIndicators.listRunHistory(riskScenarioId, { page: 1, limit: 2, sortDesc: false });

      expect(head.items.map((row) => row.id)).toEqual([first.runId, second.runId]);
    });

    it('returns the newest 500 runs to a caller that cannot page, and counts them all for the pager', async () => {
      const DAY_MS = 86_400_000;
      const newest = Date.UTC(2026, 9, 1);
      const ids = Array.from({ length: 501 }, () => uuidv7());
      await db.insert(crqIndicatorRuns).values(ids.map((id, index) => ({
        id,
        riskScenarioId,
        createdAt: new Date(newest - index * DAY_MS),
        iterations: 100,
        vulnerabilityP5: 0.1,
        vulnerabilityP50: 0.2,
        vulnerabilityP95: 0.3,
        tefMin: 1,
        tefLikely: 4,
        tefMax: 7,
        techniqueCount: 40,
        coveredTechniqueCount: 30,
        outcomeBlocked: 0.4,
        outcomeEvicted: 0.3,
        outcomeImpactDetected: 0.2,
        outcomeImpactUndetected: 0.1,
        magnitudeMean: 2_000_000,
        calibrationVintage: '2026.09',
        catalogueVintage: 'attack-enterprise-18',
        uncontestedPairCount: 0,
        uncontestablePairCount: 0,
      })));
      const crq = services.withOrigin(adminOrigin).crqIndicators;

      const history = await crq.getRunHistory(riskScenarioId);
      const lastPage = await crq.listRunHistory(riskScenarioId, { page: 6, limit: 100, sortDesc: true });

      expect(history.map((row) => row.id)).toEqual(ids.slice(0, 500));
      expect(lastPage.total).toBe(501);
      expect(lastPage.items.map((row) => row.id)).toEqual([ids[500]]);
    });

    it('does not expose runs from another tenant', async () => {
      const { runId } = await run();
      // The same platform admin, acting inside a second tenant it also belongs to.
      const otherTenantId = await createTenant(services, adminUserId);
      const other: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      await expect(services.withOrigin(other).crqIndicators.getLatestRun(riskScenarioId)).resolves.toBeUndefined();
      await expect(services.withOrigin(other).crqIndicators.getRunWithScores(runId)).resolves.toBeUndefined();
      await expect(services.withOrigin(other).crqIndicators.getRunHistory(riskScenarioId)).resolves.toEqual([]);
      await expect(services.withOrigin(other).crqIndicators.listRunHistory(riskScenarioId, { page: 1, limit: 10, sortDesc: true })).resolves.toEqual({ items: [], total: 0 });
      await expect(services.withOrigin(other).crqIndicators.getWhatIfResults(riskScenarioId)).resolves.toEqual([]);
    });
  });

  describe('getRunTimeline', () => {
    const DAY_MS = 86_400_000;
    const MINUTE_MS = 60_000;

    /** Bare rows dated in the past: the engine stamps `created_at` with the clock, which a history needs to escape. */
    const runsAt = async (runs: Array<{ msAgo: number, aleMean: number | null }>): Promise<Array<string>> => {
      const now = Date.now();
      const rows = runs.map(({ msAgo, aleMean }) => ({
        id: uuidv7(),
        riskScenarioId,
        createdAt: new Date(now - msAgo),
        aleMean,
        iterations: 1,
        vulnerabilityP5: 0,
        vulnerabilityP50: 0,
        vulnerabilityP95: 0,
        techniqueCount: 0,
        coveredTechniqueCount: 0,
      }));
      await db.insert(crqIndicatorRuns).values(rows);
      return rows.map((row) => row.id);
    };

    it('should place a burst of runs in the last hour on one point, whatever its size', async () => {
      const history = await runsAt([60, 40, 20].map((days) => ({ msAgo: days * DAY_MS, aleMean: days })));
      await runsAt(Array.from({ length: 500 }, (_, index) => ({ msAgo: (index + 1) * 6000, aleMean: 1 })));

      const { points } = await services.withOrigin(adminOrigin).crqIndicators.getRunTimeline(riskScenarioId, 90);

      expect(points.slice(0, 3).map((point) => point.id)).toEqual(history);
      expect(points).toHaveLength(4);
      expect(Date.now() - points[3].createdAt.getTime()).toBeLessThan(60 * MINUTE_MS);
    });

    it('should start at the first quantified run of the period and skip unquantified ones', async () => {
      const [, firstInPeriod] = await runsAt([
        { msAgo: 100 * DAY_MS, aleMean: 1 },
        { msAgo: 80 * DAY_MS, aleMean: 2 },
        { msAgo: 10 * DAY_MS, aleMean: null },
      ]);

      const quarter = await services.withOrigin(adminOrigin).crqIndicators.getRunTimeline(riskScenarioId, 90);
      expect(quarter.points.map((point) => point.id)).toEqual([firstInPeriod]);
      const halfYear = await services.withOrigin(adminOrigin).crqIndicators.getRunTimeline(riskScenarioId, 183);
      expect(halfYear.points.map((point) => point.aleMean)).toEqual([1, 2]);
    });

    it('should read the latest two runs, newest first, quantified or not', async () => {
      const [, previous, latest] = await runsAt([
        { msAgo: 3 * DAY_MS, aleMean: 1 },
        { msAgo: 2 * DAY_MS, aleMean: 2 },
        { msAgo: DAY_MS, aleMean: null },
      ]);

      const timeline = await services.withOrigin(adminOrigin).crqIndicators.getRunTimeline(riskScenarioId, 90);
      expect(timeline.latest.map((row) => row.id)).toEqual([latest, previous]);
    });

    it('should not expose runs from another tenant', async () => {
      await runsAt([{ msAgo: DAY_MS, aleMean: 1 }]);
      const otherTenantId = await createTenant(services, adminUserId);
      const other: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      const timeline = await services.withOrigin(other).crqIndicators.getRunTimeline(riskScenarioId, 90);
      expect(timeline.latest).toEqual([]);
      expect(timeline.points).toEqual([]);
    });
  });

  describe('getTefInput / upsertTefInput', () => {
    it('persists, retrieves and overwrites the declared triplet', async () => {
      await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({ riskScenarioId, min: 1, likely: 2, max: 4 });
      expect(await services.withOrigin(adminOrigin).crqIndicators.getTefInput(riskScenarioId)).toMatchObject({ min: 1, likely: 2, max: 4 });

      await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({ riskScenarioId, min: 2, likely: 3, max: 5 });
      expect(await services.withOrigin(adminOrigin).crqIndicators.getTefInput(riskScenarioId)).toMatchObject({ min: 2, likely: 3, max: 5 });
    });

    // The auto-mode CRQ tab mirrors the estimate into this row on every visit, and the timestamp is
    // what a scenario's freshness is read against.
    it('moves updated_at only when the triplet it writes differs from the stored one', async () => {
      await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({ riskScenarioId, min: 1, likely: 2, max: 4 });
      const stored = await services.withOrigin(adminOrigin).crqIndicators.getTefInput(riskScenarioId);

      await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({ riskScenarioId, min: 1, likely: 2, max: 4 });
      const afterIdentical = await services.withOrigin(adminOrigin).crqIndicators.getTefInput(riskScenarioId);
      expect(afterIdentical.updatedAt).toEqual(stored.updatedAt);

      await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({ riskScenarioId, min: 1, likely: 3, max: 4 });
      const afterChange = await services.withOrigin(adminOrigin).crqIndicators.getTefInput(riskScenarioId);
      expect(afterChange.updatedAt.getTime()).toBeGreaterThan(stored.updatedAt.getTime());
    });

    it('leaves the declared inputs untouched by a run', async () => {
      const before = await services.withOrigin(adminOrigin).crqIndicators.getTefInput(riskScenarioId);
      await run();
      const after = await services.withOrigin(adminOrigin).crqIndicators.getTefInput(riskScenarioId);
      expect(after).toEqual(before);
    });
  });

  describe('getCrqSummaryForOutcome', () => {
    it('prices the outcome from the scenarios naming it and ranks the controls on the mean reduction', async () => {
      const { result } = await run();

      const summary = await services.withOrigin(adminOrigin).crqIndicators.getCrqSummaryForOutcome({ attackOutcomeId, organizationId });
      expect(summary.ledger.totalCount).toBe(1);
      expect(summary.ledger.pricedCount).toBe(1);
      expect(summary.ledger.totalAleMean).toBeCloseTo(result.ale.mean, 6);
      expect(summary.ledger.rows[0]).toMatchObject({ scenarioId: riskScenarioId });
      expect(summary.topControls.length).toBeGreaterThan(0);
      for (let index = 1; index < summary.topControls.length; index += 1) {
        expect(summary.topControls[index - 1].totalAleReduction).toBeGreaterThanOrEqual(summary.topControls[index].totalAleReduction);
      }
    });

    it('returns an empty summary for an outcome no scenario names', async () => {
      await run();
      const summary = await services.withOrigin(adminOrigin).crqIndicators.getCrqSummaryForOutcome({
        attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_DataBreachResale),
      });
      expect(summary).toEqual({ topControls: [], ledger: { rows: [], totalAleMean: null, pricedCount: 0, totalCount: 0 } });
    });
  });
});
