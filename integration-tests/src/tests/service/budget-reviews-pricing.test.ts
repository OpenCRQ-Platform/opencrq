import type { EventOrigin, ScenarioPricingPassOptions } from '@app/module';
import {
  budgetReviewClosedTolerances,
  BudgetReviewOutdatedError,
  controlCapabilityAssessmentEvents,
  crqBudgetReviewAnnualLosses,
  crqBudgetReviewResults,
  crqIndicatorRuns,
  deriveSeedId,
  LossDriver_LostMarginFromDowntime,
} from '@app/module';
import { buildExceedanceCurve, readExceedance } from '@app/module/client';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { EXPOSED_ESTATE, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const THIS_YEAR = new Date().getUTCFullYear();
const LAST_YEAR = THIS_YEAR - 1;
const THIS_YEAR_START = `${THIS_YEAR}-01-01`;
const LAST_YEAR_START = `${LAST_YEAR}-01-01`;

/** Within the current calendar year and before now, whatever today's date. */
const earlierThisYear = (): Date => {
  const yearStart = Date.UTC(THIS_YEAR, 0, 1);
  return new Date(yearStart + (Date.now() - yearStart) / 2);
};

/**
 * A budget review priced inside the CRQ run, on a real scenario. The engine's own arithmetic is
 * asserted in `engine-run.test.ts`; what this covers is the seam: the postures the review reads
 * from the history, the figures a run stores, their freshness and the closing.
 */
describe('Budget review pricing', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;
  let primaryAssetId: string;
  /** Two controls the scenario's run carries, both declared at L2 / L2. */
  let moving: string;
  let steady: string;

  const scoped = () => services.withOrigin(adminOrigin);

  const run = async (priceBudgetReviews = true) => {
    const outcome = await scoped().crqIndicators.runAttackRunEngine(riskScenarioId, tenantId, undefined, undefined, undefined, { priceBudgetReviews });
    if (outcome === null || 'skipped' in outcome) {
      throw new Error('the attack run engine priced nothing');
    }
    return outcome;
  };

  /** The `crq-price-recompute` pass, which stores no review figure. */
  const pricePass = async (scenarioCount: number, options: ScenarioPricingPassOptions = {}) => {
    expect(await scoped().crqIndicators.priceAllScenarios(tenantId, undefined, undefined, options)).toMatchObject({ priced: scenarioCount, refused: [] });
    const [latest] = await db.select().from(crqIndicatorRuns)
      .where(eq(crqIndicatorRuns.riskScenarioId, riskScenarioId))
      .orderBy(desc(crqIndicatorRuns.createdAt), desc(crqIndicatorRuns.id))
      .limit(1);
    expect(await db.select().from(crqBudgetReviewResults).where(eq(crqBudgetReviewResults.runId, latest.id))).toEqual([]);
    return latest;
  };

  /** Raises the scenario's downtime loss, an input of the model that moves its ALE. */
  const raiseDowntimeLoss = async () => {
    const current = await scoped().scenarioLossEstimates.getScenarioLossEstimates(riskScenarioId);
    await scoped().scenarioLossEstimates.upsertScenarioLossEstimates(riskScenarioId, [
      { lossDriverId: deriveSeedId(tenantId, LossDriver_LostMarginFromDowntime), action: 'set', minValue: 100_000, likelyValue: 900_000, maxValue: 3_000_000 },
    ], {
      maxUpdatedAt: current.reduce<Date | null>((latest, row) => (latest === null || row.updatedAt > latest ? row.updatedAt : latest), null),
      rowCount: current.length,
    });
  };

  const aleMeanOf = async (runId: string) => {
    const [row] = await db.select({ aleMean: crqIndicatorRuns.aleMean }).from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    return row.aleMean;
  };

  const figuresOf = async (reviewId: string) => (await scoped().budgetReviews.getBudgetReviewFigures(reviewId))!;
  const figure = (figures: Awaited<ReturnType<typeof figuresOf>>, basket: string, lineId: string | null = null) =>
    figures.figures.find((entry) => entry.basket === basket && entry.lineId === lineId)!;

  /** Each mover went from L1 / L1 to L2 / L2 at `movedAt`; every other line predates both periods. */
  const writeHistory = async (movedAt: Date, movers: Array<string> = [moving]) => {
    await db.update(controlCapabilityAssessmentEvents)
      .set({ createdAt: new Date(Date.UTC(LAST_YEAR - 1, 0, 15)) })
      .where(isNull(controlCapabilityAssessmentEvents.organizationId));
    for (const capabilityId of movers) {
      await db.update(controlCapabilityAssessmentEvents)
        .set({ newStrength: 'L1', newCoverage: 'L1' })
        .where(eq(controlCapabilityAssessmentEvents.capabilityId, capabilityId));
      await db.insert(controlCapabilityAssessmentEvents).values({
        id: uuidv7(),
        capabilityId,
        tenantId,
        type: 'assessment_change',
        oldStrength: 'L1',
        newStrength: 'L2',
        oldCoverage: 'L1',
        newCoverage: 'L2',
        createdAt: movedAt,
      });
    }
  };

  const reviewWith = async (periodStart: string, lines: Array<{ nature: 'build' | 'run', capabilityIds: Array<string> }>) => {
    const reviewId = await scoped().budgetReviews.createBudgetReview({ organizationId, name: `Exercice ${periodStart}`, periodStart });
    const lineIds: Array<string> = [];
    for (const [index, line] of lines.entries()) {
      lineIds.push(await scoped().budgetReviews.createBudgetReviewLine(reviewId, { name: `Line ${index}`, amountSpent: 10_000, ...line }));
    }
    return { reviewId, lineIds };
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    // Every invariant asserted here holds world by world, so a handful of worlds proves as much as a thousand.
    await scoped().crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 30 });
    ({ organizationId, riskScenarioId, primaryAssetId } = await seedAttackRunScenario(services, adminOrigin, tenantId, EXPOSED_ESTATE));
    const first = await run(false);
    // Which capabilities the seed declares moves with the catalogue, and one that barely bites on this estate leaves a build line no trace on 30 worlds.
    const weight = (value: (typeof first.result.controlValues)[number]) => value.levers.reduce((sum, lever) => sum + lever.aleReduction.mean, 0);
    const declared = first.result.controlValues
      .filter((value) => value.declaredStrengthRung === 'L2')
      .toSorted((left, right) => weight(right) - weight(left))
      .map((value) => value.controlId);
    [moving, steady] = declared;
  });

  it('should price nothing for a review while the feature is off', async () => {
    await writeHistory(earlierThisYear());
    await reviewWith(THIS_YEAR_START, [{ nature: 'run', capabilityIds: [steady] }]);

    const { runId } = await run(false);

    expect(await db.select().from(crqBudgetReviewResults).where(eq(crqBudgetReviewResults.runId, runId))).toEqual([]);
  });

  it('should price a build line at exactly zero when none of its controls moved during the period', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId, lineIds: [buildLine, runLine] } = await reviewWith(THIS_YEAR_START, [
      { nature: 'build', capabilityIds: [steady] },
      { nature: 'run', capabilityIds: [steady] },
    ]);

    await run();

    const figures = await figuresOf(reviewId);
    expect(figure(figures, 'line', buildLine)).toMatchObject({ state: 'priced', aleReductionMean: 0, aleReductionP10: 0, aleReductionP90: 0 });
    expect(figure(figures, 'line', runLine).aleReductionMean!).toBeGreaterThan(0);
  });

  /*
   * A control upgraded during the period and funded by both natures is worth its start level
   * against absent in the run line, plus the period's upgrade in the build line: together, that
   * control from its end level to absent, which for a review funding nothing else is the
   * ensemble figure.
   */
  it('should sum a control\'s build and run figures to that control from its period-end level to absent', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId, lineIds: [buildLine, runLine] } = await reviewWith(THIS_YEAR_START, [
      { nature: 'build', capabilityIds: [moving] },
      { nature: 'run', capabilityIds: [moving] },
    ]);

    await run();

    const figures = await figuresOf(reviewId);
    const build = figure(figures, 'line', buildLine).aleReductionMean!;
    const runValue = figure(figures, 'line', runLine).aleReductionMean!;
    const whole = figure(figures, 'ensemble').aleReductionMean!;
    expect(build).toBeGreaterThan(0);
    expect(runValue).toBeGreaterThan(0);
    expect(Math.abs(build + runValue - whole) / whole).toBeLessThan(1e-9);
  });

  it('should price the ensemble as one basket rather than as the sum of the build and run totals', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(THIS_YEAR_START, [
      { nature: 'build', capabilityIds: [moving] },
      { nature: 'run', capabilityIds: [steady] },
    ]);

    await run();

    const figures = await figuresOf(reviewId);
    const sum = figure(figures, 'build').aleReductionMean! + figure(figures, 'run').aleReductionMean!;
    const ensemble = figure(figures, 'ensemble').aleReductionMean!;
    expect(ensemble).toBeGreaterThan(0);
    expect(Math.abs(ensemble - sum) / ensemble).toBeGreaterThan(1e-6);
  });

  it('should return the same figures for a past period after a posture change following its end', async () => {
    await writeHistory(new Date(Date.UTC(LAST_YEAR, 5, 1)));
    const { reviewId } = await reviewWith(LAST_YEAR_START, [
      { nature: 'build', capabilityIds: [moving] },
      { nature: 'run', capabilityIds: [moving, steady] },
    ]);
    await run();
    const before = await figuresOf(reviewId);
    expect(figure(before, 'build').aleReductionMean!).toBeGreaterThan(0);

    await scoped().controlCapabilities.upsertAssessment(moving, 'L3', 'L3', null);
    await scoped().controlCapabilities.upsertAssessment(steady, 'L1', 'L1', null);
    await run();

    const after = await figuresOf(reviewId);
    for (const entry of before.figures) {
      const again = figure(after, entry.basket, entry.lineId);
      expect(again.state).toBe('priced');
      expect(Math.abs(again.aleReductionMean! - entry.aleReductionMean!), `${entry.basket} ${entry.lineId}`)
        .toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(entry.aleReductionMean!)));
    }
  });

  it('should mark the figures expired when a line is edited, until the scenarios are simulated again', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId, lineIds: [runLine] } = await reviewWith(THIS_YEAR_START, [{ nature: 'run', capabilityIds: [steady] }]);
    await run();
    expect(figure(await figuresOf(reviewId), 'ensemble').state).toBe('priced');

    await scoped().budgetReviews.updateBudgetReviewLine(runLine, { capabilityIds: [steady, moving] });

    const stale = await figuresOf(reviewId);
    expect(figure(stale, 'ensemble').state).toBe('expired');
    expect(stale.toReprice).toEqual([riskScenarioId]);
    expect((await scoped().budgetReviews.getBudgetReviewSimulationScope(reviewId))!.toReprice).toEqual([riskScenarioId]);

    await run();
    const fresh = await figuresOf(reviewId);
    expect(fresh.figures.every((entry) => entry.state === 'priced')).toBe(true);
    expect(fresh.toReprice).toEqual([]);
  });

  /** The pass that follows a full simulation over unchanged inputs, which writes no run. */
  const passWritingNothing = async () => {
    expect(await scoped().crqIndicators.priceAllScenarios(tenantId)).toMatchObject({ priced: 0, unchanged: 1 });
  };

  it('should not flag a review\'s figures older after the price pass that follows the full simulation over unchanged inputs', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
    await run();

    await passWritingNothing();

    const figures = await figuresOf(reviewId);
    expect(figures.olderThanHeadline).toEqual([]);
    expect(figures.toReprice).toEqual([]);
    expect((await scoped().budgetReviews.getBudgetReviewSimulationScope(reviewId))!.toReprice).toEqual([]);
    await scoped().budgetReviews.closeBudgetReview(reviewId);
  });

  it('should flag a review\'s figures older after a release reprices the scenario, even at the same ALE', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
    const { runId } = await run();

    const latest = await pricePass(1, { appVersion: 'main-bbbbbbbb' });

    expect(latest.aleMean).toBe(await aleMeanOf(runId));
    expect((await figuresOf(reviewId)).olderThanHeadline).toEqual([riskScenarioId]);
    await expect(scoped().budgetReviews.closeBudgetReview(reviewId)).rejects.toBeInstanceOf(BudgetReviewOutdatedError);
  });

  it('should keep the figures of the run that priced the review once a price run is the scenario\'s latest, flag them older and reprice them, and expire them on a line edit', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId, lineIds: [, runLine] } = await reviewWith(THIS_YEAR_START, [
      { nature: 'build', capabilityIds: [moving] },
      { nature: 'run', capabilityIds: [steady] },
    ]);
    const { runId } = await run();
    const [priced] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    const before = await figuresOf(reviewId);
    const listedBefore = await scoped().budgetReviews.getBudgetReviews(organizationId);
    await raiseDowntimeLoss();

    const latest = await pricePass(1);

    expect(latest.id).not.toBe(runId);
    const after = await figuresOf(reviewId);
    expect(after.figures).toEqual(before.figures);
    expect(after.scopeScenarioCount).toBe(before.scopeScenarioCount);
    expect(after.figures.every((entry) => entry.state === 'priced' && entry.pricedAt?.getTime() === priced.createdAt.getTime())).toBe(true);
    expect(before.olderThanHeadline).toEqual([]);
    expect(after.olderThanHeadline).toEqual([riskScenarioId]);
    expect(after.olderThanHeadlineNames).toEqual(['Ransomware on the customer estate']);
    expect(after.toReprice).toEqual([riskScenarioId]);
    expect(await scoped().budgetReviews.getBudgetReviews(organizationId)).toEqual(listedBefore);
    expect((await scoped().budgetReviews.getBudgetReviewSimulationScope(reviewId))!.toReprice).toEqual([riskScenarioId]);

    await scoped().budgetReviews.updateBudgetReviewLine(runLine, { capabilityIds: [steady, moving] });

    const stale = await figuresOf(reviewId);
    expect(figure(stale, 'ensemble')).toMatchObject({ state: 'expired', aleReductionMean: figure(before, 'ensemble').aleReductionMean });
    expect(stale.toReprice).toEqual([riskScenarioId]);
  });

  it('should refuse to close a review whose figures are older than a scenario\'s latest run, and close it once the scenario is simulated again', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
    await run();
    await raiseDowntimeLoss();
    await pricePass(1);

    await expect(scoped().budgetReviews.closeBudgetReview(reviewId)).rejects.toBeInstanceOf(BudgetReviewOutdatedError);

    const { runId } = await run();
    await passWritingNothing();
    const [second] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    await scoped().budgetReviews.closeBudgetReview(reviewId);

    expect(figure(await figuresOf(reviewId), 'ensemble').pricedAt?.getTime()).toBe(second.createdAt.getTime());
  });

  it('should step the build gap on each day a build line\'s control moved, the first one priced on that day\'s posture', async () => {
    const firstMove = new Date(Date.UTC(LAST_YEAR, 2, 15, 9));
    const secondMove = new Date(Date.UTC(LAST_YEAR, 5, 10, 9));
    await writeHistory(firstMove, [moving, steady]);
    await db.update(controlCapabilityAssessmentEvents)
      .set({ createdAt: secondMove })
      .where(and(eq(controlCapabilityAssessmentEvents.capabilityId, steady), eq(controlCapabilityAssessmentEvents.createdAt, firstMove)));
    const { reviewId, lineIds: [line] } = await reviewWith(LAST_YEAR_START, [{ nature: 'build', capabilityIds: [moving, steady] }]);
    const { runId } = await run();

    const [firstDay, secondDay] = [firstMove, secondMove].map((at) => at.toISOString().slice(0, 10));
    const stored = await db.select().from(crqBudgetReviewResults).where(eq(crqBudgetReviewResults.runId, runId));
    const meanOf = (basket: string, stepOn: string | null = null) =>
      stored.find((row) => row.basket === basket && row.stepOn === stepOn)!.aleReductionMean!;
    const [reference] = await db.select().from(crqBudgetReviewAnnualLosses)
      .where(and(eq(crqBudgetReviewAnnualLosses.runId, runId), eq(crqBudgetReviewAnnualLosses.posture, 'reference')));
    // On 15 March the line's second control still stood at its period start, below its end.
    expect(meanOf('step-level', firstDay)).toBeGreaterThan(0);
    expect(stored.filter((row) => row.basket === 'step')).toEqual([expect.objectContaining({ lineId: null, stepOn: firstDay })]);

    // The series holds a point on the days a reading exists: one run per step day, copied from the priced one.
    const [priced] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    for (const move of [firstMove, secondMove]) {
      await db.insert(crqIndicatorRuns).values({ ...priced, id: uuidv7(), createdAt: new Date(move.getTime() + 3_600_000) });
    }
    const { points, moves, pricedAt } = (await scoped().budgetReviews.getBudgetReviewRiskSeries(reviewId))!;
    const gapOn = (point: (typeof points)[number]) => point.without! / point.ale - 1;
    expect(moves).toEqual([
      { date: firstDay, lines: [{ lineId: line, capabilityIds: [moving], finished: false }] },
      { date: secondDay, lines: [{ lineId: line, capabilityIds: [steady], finished: true }] },
    ]);
    expect(pricedAt).toEqual(priced.createdAt);
    expect(points.map((point) => point.date)).toEqual([firstDay, secondDay]);
    expect(gapOn(points[0])).toBeGreaterThan(0);
    expect(gapOn(points[0]))
      .toBeCloseTo(meanOf('step', firstDay) / (reference.mean + meanOf('step-level', firstDay)), 12);
    expect(gapOn(points[1])).toBeCloseTo(meanOf('build') / reference.mean, 12);

    await scoped().budgetReviews.updateBudgetReviewLine(line, { nature: 'run' });
    const withoutBuild = (await scoped().budgetReviews.getBudgetReviewRiskSeries(reviewId))!;
    expect(withoutBuild.points.map((point) => point.without)).toEqual([null, null]);
    expect(withoutBuild.moves).toEqual([]);
    expect(withoutBuild.pricedAt).toBeNull();
  });

  it('should sum the scope\'s ALE and its build-free counterpart into one point per day, as the history steps it', async () => {
    const movedAt = earlierThisYear();
    await writeHistory(movedAt);
    const { reviewId, lineIds: [line] } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
    const { runId } = await run();

    const { points, moves, pricedAt } = (await scoped().budgetReviews.getBudgetReviewRiskSeries(reviewId))!;
    const [priced] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    const stored = await db.select().from(crqBudgetReviewResults).where(eq(crqBudgetReviewResults.runId, runId));
    const [reference] = await db.select().from(crqBudgetReviewAnnualLosses)
      .where(and(eq(crqBudgetReviewAnnualLosses.runId, runId), eq(crqBudgetReviewAnnualLosses.posture, 'reference')));
    const buildMean = stored.find((row) => row.basket === 'build' && row.stepOn === null)!.aleReductionMean!;
    const ale = priced.aleMean!;

    expect(points.map((point) => point.date)).toEqual([new Date().toISOString().slice(0, 10)]);
    expect(points[0].ale).toBe(ale);
    expect(points[0].without).toBeCloseTo(ale * (1 + buildMean / reference.mean), 6);
    expect(moves).toEqual([{ date: movedAt.toISOString().slice(0, 10), lines: [{ lineId: line, capabilityIds: [moving], finished: true }] }]);
    expect(pricedAt).toEqual(priced.createdAt);
  });

  it('should draw no scope curve for a review whose period ended before any simulation', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(LAST_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
    await run();

    expect((await scoped().budgetReviews.getBudgetReviewRiskSeries(reviewId))!.points).toEqual([]);
    expect(await scoped().budgetReviews.getBudgetReviewRiskSeries(uuidv7())).toBeUndefined();
  });

  it('should list an open priced review with its ensemble and build figures, and a review without build lines with a build priced at zero', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(THIS_YEAR_START, [
      { nature: 'build', capabilityIds: [moving] },
      { nature: 'run', capabilityIds: [steady] },
    ]);
    const { reviewId: runOnlyId } = await reviewWith(LAST_YEAR_START, [{ nature: 'run', capabilityIds: [steady] }]);
    await run();

    const listed = await scoped().budgetReviews.getBudgetReviews(organizationId);

    const figures = await figuresOf(reviewId);
    const ensemble = figure(figures, 'ensemble');
    const build = figure(figures, 'build');
    const row = listed.find((entry) => entry.id === reviewId)!;
    expect(row).toMatchObject({
      status: 'open',
      spent: 20_000,
      state: 'priced',
      aleReductionMean: ensemble.aleReductionMean,
      aleReductionP10: ensemble.aleReductionP10,
      aleReductionP90: ensemble.aleReductionP90,
      returnPercent: ensemble.returnPercent,
      pricedAt: ensemble.pricedAt,
      build: {
        spent: 10_000,
        state: 'priced',
        aleReductionMean: build.aleReductionMean,
        aleReductionP10: build.aleReductionP10,
        aleReductionP90: build.aleReductionP90,
        returnPercent: build.returnPercent,
      },
    });
    expect(row.aleReductionP10!).toBeLessThanOrEqual(row.aleReductionMean!);
    expect(row.aleReductionP90!).toBeGreaterThanOrEqual(row.aleReductionMean!);
    expect(row.build.aleReductionMean!).toBeGreaterThan(0);

    const runOnly = listed.find((entry) => entry.id === runOnlyId)!;
    expect(runOnly.build).toEqual({
      spent: 0,
      state: 'priced',
      aleReductionMean: 0,
      aleReductionP10: 0,
      aleReductionP90: 0,
      returnPercent: null,
    });
  });

  it('should list a closed review with the ensemble and build figures stored at its closing', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(THIS_YEAR_START, [
      { nature: 'build', capabilityIds: [moving] },
      { nature: 'run', capabilityIds: [steady] },
    ]);
    await run();
    await scoped().budgetReviews.closeBudgetReview(reviewId);
    const closed = await figuresOf(reviewId);
    const ensemble = figure(closed, 'ensemble');
    const build = figure(closed, 'build');

    await scoped().controlCapabilities.upsertAssessment(steady, 'L3', 'L3', null);
    await run();

    const row = (await scoped().budgetReviews.getBudgetReviews(organizationId)).find((entry) => entry.id === reviewId)!;
    expect(row).toMatchObject({
      status: 'closed',
      state: 'priced',
      spent: ensemble.spent,
      aleReductionMean: ensemble.aleReductionMean,
      aleReductionP10: ensemble.aleReductionP10,
      aleReductionP90: ensemble.aleReductionP90,
      returnPercent: ensemble.returnPercent,
      pricedAt: ensemble.pricedAt,
      build: {
        spent: 10_000,
        state: 'priced',
        aleReductionMean: build.aleReductionMean,
        aleReductionP10: build.aleReductionP10,
        aleReductionP90: build.aleReductionP90,
        returnPercent: build.returnPercent,
      },
    });
    expect(row.build.aleReductionMean!).toBeGreaterThan(0);
  });

  it('should never price a closed review again, and keep its stored figures', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(THIS_YEAR_START, [
      { nature: 'build', capabilityIds: [moving] },
      { nature: 'run', capabilityIds: [steady] },
    ]);
    await run();
    await scoped().budgetReviews.closeBudgetReview(reviewId);
    const closed = await figuresOf(reviewId);
    expect(closed.status).toBe('closed');
    expect(figure(closed, 'ensemble').state).toBe('priced');

    await scoped().controlCapabilities.upsertAssessment(steady, 'L3', 'L3', null);
    const { runId } = await run();

    expect(await db.select().from(crqBudgetReviewResults).where(and(
      eq(crqBudgetReviewResults.runId, runId),
      eq(crqBudgetReviewResults.reviewId, reviewId),
    ))).toEqual([]);
    expect(await figuresOf(reviewId)).toEqual(closed);
    expect((await scoped().budgetReviews.getBudgetReviewSimulationScope(reviewId))!.toReprice).toEqual([]);
  });

  it('should read a reopened review\'s figures expired until its scenarios are simulated again', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'run', capabilityIds: [steady] }]);
    await run();
    await scoped().budgetReviews.closeBudgetReview(reviewId);

    await scoped().budgetReviews.reopenBudgetReview(reviewId);

    const reopened = await figuresOf(reviewId);
    expect(reopened.status).toBe('open');
    expect(figure(reopened, 'ensemble').state).toBe('expired');
    expect((await scoped().budgetReviews.getBudgetReviewSimulationScope(reviewId))!.toReprice).toEqual([riskScenarioId]);

    await run();
    expect((await figuresOf(reviewId)).figures.every((entry) => entry.state === 'priced')).toBe(true);
  });

  it('should read the figures expired when an open review\'s period moves', async () => {
    await writeHistory(earlierThisYear());
    const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'run', capabilityIds: [steady] }]);
    await run();

    await scoped().budgetReviews.updateBudgetReview(reviewId, { periodStart: LAST_YEAR_START });

    expect(figure(await figuresOf(reviewId), 'ensemble').state).toBe('expired');
  });

  describe('risk tolerance', () => {
    const SCOPE_TOLERANCE = { annualLoss: 500_000, maxExceedanceProbability: 0.1 };
    const OWN_TOLERANCE = { annualLoss: 2_000_000, maxExceedanceProbability: 0.02 };

    const toleranceOf = async (reviewId: string) => (await scoped().budgetReviews.getBudgetReviewTolerance(reviewId))!;

    /** A second scenario of the same scope, priced like the first. */
    const addScenario = async () => {
      const first = (await scoped().riskScenarios.getRiskScenario(riskScenarioId))!;
      const id = uuidv7();
      await scoped().riskScenarios.createRiskScenario({
        id, organizationId, name: 'Data theft', description: null, attackOutcomeId: first.attackOutcomeId, primaryAssetIds: [primaryAssetId],
      });
      await scoped().riskScenarios.setTefMode(id, 'manual');
      await scoped().crqIndicators.upsertTefInput({ riskScenarioId: id, min: 0.5, likely: 1.5, max: 4 });
      await scoped().scenarioLossEstimates.upsertScenarioLossEstimates(id, [
        { lossDriverId: deriveSeedId(tenantId, LossDriver_LostMarginFromDowntime), action: 'set', minValue: 100_000, likelyValue: 600_000, maxValue: 3_000_000 },
      ], { maxUpdatedAt: null, rowCount: 0 });
      return id;
    };

    it('should read an open review today against each scenario\'s own tolerance first, then its scope\'s, on the run\'s own curve', async () => {
      await writeHistory(earlierThisYear());
      const otherId = await addScenario();
      await scoped().organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      await scoped().riskScenarios.setRiskTolerance(otherId, OWN_TOLERANCE);
      const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
      const { runId } = await run();
      const other = await scoped().crqIndicators.runAttackRunEngine(otherId, tenantId, undefined, undefined, undefined, { priceBudgetReviews: true });
      expect(other !== null && !('skipped' in other)).toBe(true);

      const tolerance = await toleranceOf(reviewId);

      expect(tolerance).toMatchObject({ reference: 'today', state: 'priced' });
      const firstRead = tolerance.scenarios.find((scenario) => scenario.scenarioId === riskScenarioId)!;
      const otherRead = tolerance.scenarios.find((scenario) => scenario.scenarioId === otherId)!;
      expect(firstRead.tolerance).toEqual({ ...SCOPE_TOLERANCE, source: 'scope' });
      expect(otherRead.tolerance).toEqual({ ...OWN_TOLERANCE, source: 'scenario' });
      const ownCurve = buildExceedanceCurve((await scoped().crqIndicators.getRunWithScores(runId))!.annualLoss!);
      expect(firstRead.reference).toEqual({ ...readExceedance(ownCurve, SCOPE_TOLERANCE.annualLoss), curve: ownCurve });
      expect(firstRead.withoutBuild!.curve).not.toEqual(ownCurve);
      expect(firstRead.withoutBuild!.probability).toBe(readExceedance(firstRead.withoutBuild!.curve, SCOPE_TOLERANCE.annualLoss).probability);
      expect(otherRead.reference!.probability).toBe(readExceedance(otherRead.reference!.curve, OWN_TOLERANCE.annualLoss).probability);
    });

    it('should read a past period at its end', async () => {
      await writeHistory(new Date(Date.UTC(LAST_YEAR, 5, 1)));
      await scoped().controlCapabilities.upsertAssessment(moving, 'L3', 'L3', null);
      const { reviewId } = await reviewWith(LAST_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
      const { runId, result } = await run();
      const pricing = await scoped().budgetReviews.getBudgetReviewPricing(organizationId);
      const [exceedance] = pricing.exceedances;

      const tolerance = await toleranceOf(reviewId);

      expect(tolerance).toMatchObject({ reference: 'period-end', state: 'priced' });
      expect(pricing.baskets.find((basket) => basket.basketId === exceedance.referenceBasketId)!.moves)
        .toEqual([{ controlId: moving, targetStrengthRung: 'L2', targetCoverageBucket: 'L2' }]);
      const periodEnd = result.basketAnnualLosses.find((entry) => entry.basketId === exceedance.referenceBasketId)!.annualLoss;
      const [stored] = await db.select().from(crqBudgetReviewAnnualLosses).where(and(
        eq(crqBudgetReviewAnnualLosses.runId, runId),
        eq(crqBudgetReviewAnnualLosses.reviewId, reviewId),
        eq(crqBudgetReviewAnnualLosses.posture, 'reference'),
      ));
      expect(stored).toMatchObject({
        lossYearShare: periodEnd.lossYearShare,
        losses: periodEnd.quantiles.map((quantile) => quantile.loss),
      });
      const [scenario] = tolerance.scenarios;
      expect(scenario.tolerance).toBeNull();
      expect(scenario.reference).toEqual({ probability: null, beyondTail: null, curve: buildExceedanceCurve(periodEnd) });
    });

    it('should read an edited tolerance on the stored curves without simulating again', async () => {
      await writeHistory(earlierThisYear());
      const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
      await run();
      const before = await toleranceOf(reviewId);
      expect(before.scenarios).toMatchObject([{ scenarioId: riskScenarioId, tolerance: null, reference: { probability: null, beyondTail: null } }]);

      await scoped().organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      const fromScope = await toleranceOf(reviewId);
      await scoped().riskScenarios.setRiskTolerance(riskScenarioId, OWN_TOLERANCE);
      const fromOwn = await toleranceOf(reviewId);

      const [{ reference, withoutBuild }] = before.scenarios;
      expect(fromScope.scenarios[0]).toMatchObject({
        tolerance: { ...SCOPE_TOLERANCE, source: 'scope' },
        reference: { ...readExceedance(reference!.curve, SCOPE_TOLERANCE.annualLoss), curve: reference!.curve },
        withoutBuild: { ...readExceedance(withoutBuild!.curve, SCOPE_TOLERANCE.annualLoss), curve: withoutBuild!.curve },
      });
      expect(fromOwn.scenarios[0]).toMatchObject({
        tolerance: { ...OWN_TOLERANCE, source: 'scenario' },
        reference: { ...readExceedance(reference!.curve, OWN_TOLERANCE.annualLoss), curve: reference!.curve },
      });
    });

    it('should list a scenario not priced for the review\'s current version with no reading', async () => {
      await writeHistory(earlierThisYear());
      const { reviewId, lineIds: [buildLine] } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
      await run();

      await scoped().budgetReviews.updateBudgetReviewLine(buildLine, { capabilityIds: [moving, steady] });

      expect(await toleranceOf(reviewId)).toMatchObject({
        state: 'expired',
        scenarios: [{ scenarioId: riskScenarioId, reference: null, withoutBuild: null }],
      });
    });

    it('should keep the curves of the run that priced the review once a price run is the scenario\'s latest, and read a scenario only a price run reached as not priced', async () => {
      await writeHistory(earlierThisYear());
      await scoped().organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
      await run();
      const before = await toleranceOf(reviewId);
      expect(before.scenarios[0].reference).not.toBeNull();
      const unpricedId = await addScenario();
      await raiseDowntimeLoss();

      await pricePass(2);

      const after = await toleranceOf(reviewId);
      expect(after.state).toBe('not-priced');
      expect(after.scenarios.find((scenario) => scenario.scenarioId === riskScenarioId)).toEqual({ ...before.scenarios[0], olderThanHeadline: true });
      expect(after.scenarios.find((scenario) => scenario.scenarioId === unpricedId)).toMatchObject({ reference: null, withoutBuild: null });
      const figures = await figuresOf(reviewId);
      expect(figure(figures, 'ensemble')).toMatchObject({ state: 'not-priced', pricedScenarioCount: 1 });
      expect(figures.toReprice).toEqual(expect.arrayContaining([riskScenarioId, unpricedId]));
      expect(figures.toReprice).toHaveLength(2);
    });

    it('should answer a closed review with the curves and the tolerance applied at its closing', async () => {
      await writeHistory(earlierThisYear());
      await scoped().organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
      await run();
      const open = await toleranceOf(reviewId);
      await scoped().budgetReviews.closeBudgetReview(reviewId);

      await scoped().riskScenarios.setRiskTolerance(riskScenarioId, OWN_TOLERANCE);
      await scoped().controlCapabilities.upsertAssessment(steady, 'L3', 'L3', null);
      await run();

      expect(await toleranceOf(reviewId)).toEqual({ ...open, reference: 'closing' });
    });

    it('should keep a scenario deleted after the closing, with the name and curves it was closed with', async () => {
      await writeHistory(earlierThisYear());
      await scoped().organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
      await run();
      await scoped().budgetReviews.closeBudgetReview(reviewId);
      const closed = await toleranceOf(reviewId);
      expect(closed.scenarios).toMatchObject([{ scenarioId: riskScenarioId, name: 'Ransomware on the customer estate' }]);

      await scoped().riskScenarios.deleteRiskScenarios([riskScenarioId]);

      expect(await toleranceOf(reviewId)).toEqual({ ...closed, scenarios: [{ ...closed.scenarios[0], scenarioId: null }] });
    });

    it('should close a review with no reading for a scenario not priced, and answer as it did before the closing', async () => {
      await writeHistory(earlierThisYear());
      await scoped().organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
      await run();
      const unpricedId = await addScenario();
      const open = await toleranceOf(reviewId);
      expect(open.scenarios.find((scenario) => scenario.scenarioId === unpricedId))
        .toMatchObject({ tolerance: { ...SCOPE_TOLERANCE, source: 'scope' }, reference: null, withoutBuild: null });

      await scoped().budgetReviews.closeBudgetReview(reviewId);

      const [frozen] = await db.select().from(budgetReviewClosedTolerances).where(and(
        eq(budgetReviewClosedTolerances.reviewId, reviewId),
        eq(budgetReviewClosedTolerances.riskScenarioId, unpricedId),
      ));
      expect(frozen).toMatchObject({ referenceLosses: null, referenceProbabilities: null, withoutBuildLosses: null, withoutBuildProbabilities: null });
      expect(await toleranceOf(reviewId)).toEqual({ ...open, reference: 'closing' });
    });

    it('should drop the frozen reading when the review is reopened', async () => {
      await writeHistory(earlierThisYear());
      await scoped().organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
      const { reviewId } = await reviewWith(THIS_YEAR_START, [{ nature: 'build', capabilityIds: [moving] }]);
      await run();
      await scoped().budgetReviews.closeBudgetReview(reviewId);
      expect(await db.select().from(budgetReviewClosedTolerances).where(eq(budgetReviewClosedTolerances.reviewId, reviewId))).toHaveLength(1);

      await scoped().budgetReviews.reopenBudgetReview(reviewId);
      await scoped().riskScenarios.setRiskTolerance(riskScenarioId, OWN_TOLERANCE);

      expect(await db.select().from(budgetReviewClosedTolerances).where(eq(budgetReviewClosedTolerances.reviewId, reviewId))).toEqual([]);
      expect(await toleranceOf(reviewId)).toMatchObject({
        state: 'expired',
        scenarios: [{ tolerance: { ...OWN_TOLERANCE, source: 'scenario' }, reference: null, withoutBuild: null }],
      });
    });
  });
});
