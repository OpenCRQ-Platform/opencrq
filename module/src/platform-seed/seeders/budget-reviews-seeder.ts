import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { BudgetLineNature, BudgetReviewStoredBasket } from '../../modules/budget-reviews/constants';
import type { CoverageBucket, StrengthRung } from '../../modules/controls/capability/constants';
import type { SeedContext } from '../platform-seed-registry';
import type { PostureStep } from '../data/budget-review-story';
import { buildReviewFigures } from '../../modules/budget-reviews/review-figures';
import { reviewPeriodBounds } from '../../modules/budget-reviews/review-period';
import { buildReviewTolerance, closedToleranceColumnsOf } from '../../modules/budget-reviews/review-tolerance';
import {
  budgetReviewClosedFigures,
  budgetReviewClosedPostures,
  budgetReviewClosedTolerances,
  budgetReviewLineControls,
  budgetReviewLines,
  budgetReviews,
} from '../../modules/budget-reviews/schema';
import { controlCapabilitiesData } from '../../modules/controls/capability/data/capabilities.generated';
import { buildExceedanceCurve, readLossAtProbability } from '../../modules/dashboard/loss-exceedance';
import { crqBudgetReviewAnnualLosses, crqBudgetReviewResults, crqIndicatorRunAnnualLosses, crqIndicatorRuns } from '../../modules/crq-indicators/schema';
import { organizationRiskTolerances } from '../../modules/organizations/schema';
import { riskScenarioRiskTolerances, riskScenarios } from '../../modules/risk-scenarios/schema';
import {
  periodStartColumn,
  postureStepsOf,
  previousPeriodStart,
  RUN_LINE_MULTIPLE,
  runningPeriodStart,
  stepProduct,
  withinRunningPeriod,
} from '../data/budget-review-story';
import {
  BudgetReview_AcmeCorpPreviousPeriod,
  BudgetReview_AcmeCorpRunningPeriod,
  BudgetReviewLine_DataLossProject,
  BudgetReviewLine_DetectionRun,
  BudgetReviewLine_IdentityUpgrades,
  BudgetReviewLine_PreviousDetectionRun,
  BudgetReviewLine_PrivilegedAccess,
  budgetReviewLineControlId,
  Organization_AcmeCorp,
  User_Alice,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';
import { bandInside, buildAnnualLossRow, magnitudeShape } from './crq-simulations-seeder';

type Db = SeedContext['db'];

interface LineSpec {
  readonly id: string,
  readonly name: string,
  readonly nature: BudgetLineNature,
  readonly amountSpent: number,
  readonly amortizationYears: number | null,
  readonly externalIds: ReadonlyArray<string>,
  /** For a build line, the indexes of the review's posture steps its controls moved at. */
  readonly steps?: ReadonlyArray<number>,
}

interface ReviewSpec {
  readonly id: string,
  readonly periodStart: Date,
  readonly createdAt: Date,
  readonly lines: ReadonlyArray<LineSpec>,
  /** Where the review's lines start in the line control id group, which both reviews share. */
  readonly firstLineIndex: number,
}

// The build lines take the controls the capability seeder moves during the period, at its four
// steps, identity on three of them and PAM through the scope's own override; the run line keeps EDR in
// both natures, the case the two figures chain on.
const RUNNING_LINES: ReadonlyArray<LineSpec> = [
  { id: BudgetReviewLine_IdentityUpgrades, name: 'Identity hardening project', nature: 'build', amountSpent: 900_000, amortizationYears: 3, externalIds: ['IDP', 'EDR'], steps: [0, 1, 3] },
  { id: BudgetReviewLine_PrivilegedAccess, name: 'Privileged access rollout', nature: 'build', amountSpent: 500_000, amortizationYears: 3, externalIds: ['PAM'], steps: [2] },
  { id: BudgetReviewLine_DetectionRun, name: 'SOC and endpoint licences', nature: 'run', amountSpent: 2_600_000, amortizationYears: null, externalIds: ['EDR', 'SIEM', 'NGFW'] },
];

const PREVIOUS_LINES: ReadonlyArray<LineSpec> = [
  { id: BudgetReviewLine_DataLossProject, name: 'Data loss prevention rollout', nature: 'build', amountSpent: 900_000, amortizationYears: 4, externalIds: ['DLP', 'IPS'], steps: [0] },
  { id: BudgetReviewLine_PreviousDetectionRun, name: 'SOC and endpoint licences', nature: 'run', amountSpent: 2_300_000, amortizationYears: null, externalIds: ['EDR', 'SIEM', 'NGFW'] },
];

interface PostureSpec {
  externalId: string,
  start: { strength: StrengthRung, coverage: CoverageBucket },
  end: { strength: StrengthRung, coverage: CoverageBucket },
}

/** The previous year as its closing read it: the data loss project deployed DLP and IPS from nothing. */
const PREVIOUS_POSTURES: ReadonlyArray<PostureSpec> = [
  { externalId: 'DLP', start: { strength: 'L0', coverage: 'L0' }, end: { strength: 'L1', coverage: 'L1' } },
  { externalId: 'IPS', start: { strength: 'L0', coverage: 'L0' }, end: { strength: 'L1', coverage: 'L1' } },
  { externalId: 'EDR', start: { strength: 'L1', coverage: 'L1' }, end: { strength: 'L1', coverage: 'L1' } },
  { externalId: 'SIEM', start: { strength: 'L1', coverage: 'L1' }, end: { strength: 'L1', coverage: 'L1' } },
  { externalId: 'NGFW', start: { strength: 'L2', coverage: 'L2' }, end: { strength: 'L2', coverage: 'L2' } },
];

const capabilityIdByExternalId = new Map(controlCapabilitiesData.map((capability) => [capability.externalId, capability.id]));

const capabilityIdOf = (externalId: string): string => {
  const capabilityId = capabilityIdByExternalId.get(externalId);
  if (!capabilityId) {
    throw new Error(`[platform-seed] Control capability "${externalId}" not found in the catalogue`);
  }
  return capabilityId;
};

const fiscalYearName = (start: Date): string =>
  `Exercice ${start.getUTCFullYear()}-${start.getUTCFullYear() + 1}`;

const insertReview = async (db: Db, spec: ReviewSpec, closedAt: Date | null): Promise<void> => {
  await db.insert(budgetReviews).values({
    id: spec.id,
    organizationId: Organization_AcmeCorp,
    name: fiscalYearName(spec.periodStart),
    ownerId: User_Alice,
    periodStart: periodStartColumn(spec.periodStart),
    context: 'Security budget of the payment platform, presented to the management review.',
    createdAt: spec.createdAt,
    updatedAt: spec.createdAt,
    ...(closedAt === null ? {} : { status: 'closed' as const, closedAt }),
  });
  for (const [lineOffset, line] of spec.lines.entries()) {
    await db.insert(budgetReviewLines).values({
      id: line.id, reviewId: spec.id, name: line.name, nature: line.nature, amountSpent: line.amountSpent, amortizationYears: line.amortizationYears,
    });
    await db.insert(budgetReviewLineControls).values(line.externalIds.map((externalId, controlIndex) => ({
      id: budgetReviewLineControlId(spec.firstLineIndex + lineOffset, controlIndex),
      lineId: line.id,
      reviewId: spec.id,
      capabilityId: capabilityIdOf(externalId),
    })));
  }
};

type ReviewResult = { basket: BudgetReviewStoredBasket, lineId: string | null, stepOn: string | null, aleReductionMean: number, aleReductionP10: number, aleReductionP90: number };

interface PricedScenario {
  scenarioId: string,
  name: string,
  run: typeof crqIndicatorRuns.$inferSelect,
  reference: typeof crqIndicatorRunAnnualLosses.$inferSelect,
  withoutBuild: NonNullable<ReturnType<typeof buildAnnualLossRow>>,
  results: Array<ReviewResult>,
}

const pricedFigure = (mean: number) => {
  const { p10, p90 } = bandInside(mean * 0.35, mean, mean * 2.1);
  return { aleReductionMean: mean, aleReductionP10: p10, aleReductionP90: p90 };
};

/** How much higher the loss would run without the build work landed by `at`, whole and per build line. */
const buildFactorsAt = (steps: ReadonlyArray<PostureStep>, at: Date) => {
  const landed = (step: PostureStep | undefined): boolean => step !== undefined && step.at <= at;
  return {
    build: stepProduct(steps.filter(landed)),
    line: (line: LineSpec): number => stepProduct((line.steps ?? []).flatMap((index) => (landed(steps[index]) ? [steps[index]] : []))),
  };
};

/**
 * What a run stores for one scenario of a review: each build line worth the loss its own step took
 * off, the build work worth all the steps landed by the run, the run line worth a multiple of the
 * loss, and the ensemble the build and run figures summed. Each step landed before the run's last one
 * also gets its curve step: on its day the later steps were still ahead, so the scope stood at their
 * product above today's loss, and that step and the earlier ones came on top of that.
 */
const resultsAt = (
  run: typeof crqIndicatorRuns.$inferSelect & { aleMean: number },
  scenarioId: string,
  steps: ReadonlyArray<PostureStep>,
  lines: ReadonlyArray<LineSpec>,
): Array<ReviewResult> => {
  const factors = buildFactorsAt(steps, run.createdAt);
  const build = pricedFigure(run.aleMean * (factors.build - 1));
  const runLine = pricedFigure(run.aleMean * RUN_LINE_MULTIPLE.get(scenarioId)!);
  const landed = steps.filter((step) => step.at <= run.createdAt);
  const curveSteps = landed.slice(0, -1).flatMap((step, index): Array<ReviewResult> => {
    const ahead = stepProduct(landed.slice(index + 1));
    const stepOn = step.at.toISOString().slice(0, 10);
    return [
      { basket: 'step', lineId: null, stepOn, ...pricedFigure(run.aleMean * ahead * (stepProduct(landed.slice(0, index + 1)) - 1)) },
      { basket: 'step-level', lineId: null, stepOn, ...pricedFigure(run.aleMean * (ahead - 1)) },
    ];
  });
  return [
    ...lines.map((line) => ({ basket: 'line' as const, lineId: line.id, stepOn: null, ...(line.nature === 'build' ? pricedFigure(run.aleMean * (factors.line(line) - 1)) : runLine) })),
    { basket: 'build', lineId: null, stepOn: null, ...build },
    { basket: 'run', lineId: null, stepOn: null, ...runLine },
    { basket: 'ensemble', lineId: null, stepOn: null, ...pricedFigure(build.aleReductionMean + runLine.aleReductionMean) },
    ...curveSteps,
  ];
};

/** The schema's floor for a tolerated probability. */
const MIN_TOLERATED_PROBABILITY = 0.001;

/**
 * The loss year share an engine-anchored curve without the build work keeps at least, so a tolerated
 * probability above the schema's floor lies under it and some amount can be exceeded past it.
 */
const MIN_WITHOUT_BUILD_SHARE = 4 * MIN_TOLERATED_PROBABILITY;

/**
 * The curve a run would store without the build work: the run's LEF and ALE raised by the build
 * factor and, when `minShare` is given, further until its loss years reach that share (a scenario the
 * engine prices at a very low LEF would otherwise draw almost no loss year without its build work).
 */
const withoutBuildRow = (
  run: typeof crqIndicatorRuns.$inferSelect & { aleMean: number, lefMean: number },
  buildFactor: number,
  minShare: number | null,
) => {
  let factor = buildFactor;
  let row = buildAnnualLossRow({ ...run, lefMean: run.lefMean * factor, aleMean: run.aleMean * factor }, magnitudeShape());
  for (let attempt = 0; minShare !== null && row !== null && row.lossYearShare < minShare && attempt < 4; attempt += 1) {
    factor *= row.lossYearShare > 0 ? (minShare / row.lossYearShare) * 1.2 : 10;
    row = buildAnnualLossRow({ ...run, lefMean: run.lefMean * factor, aleMean: run.aleMean * factor }, magnitudeShape());
  }
  return row;
};

/**
 * What a run would store for one scenario of a review on its latest run before `before`, the
 * absence of the build work drawn again on the run's own seeds at the attack rate it then had.
 */
const priceScenario = async (
  db: Db,
  scenario: { id: string, name: string },
  steps: ReadonlyArray<PostureStep>,
  lines: ReadonlyArray<LineSpec>,
  before: Date | null,
  minWithoutBuildShare: number | null,
): Promise<PricedScenario> => {
  const [run] = await db.select().from(crqIndicatorRuns)
    .where(and(eq(crqIndicatorRuns.riskScenarioId, scenario.id), before === null ? undefined : lt(crqIndicatorRuns.createdAt, before)))
    .orderBy(desc(crqIndicatorRuns.createdAt))
    .limit(1);
  const [reference] = run === undefined ? [] : await db.select().from(crqIndicatorRunAnnualLosses).where(eq(crqIndicatorRunAnnualLosses.runId, run.id));
  const buildFactor = run === undefined ? 1 : buildFactorsAt(steps, run.createdAt).build;
  const withoutBuild = run === undefined || run.aleMean === null || run.lefMean === null
    ? null
    : withoutBuildRow({ ...run, aleMean: run.aleMean, lefMean: run.lefMean }, buildFactor, minWithoutBuildShare);
  if (run === undefined || run.aleMean === null || reference === undefined || withoutBuild === null) {
    throw new Error(`[platform-seed] Budget review scenario ${scenario.id} has no priced run to read`);
  }
  return {
    scenarioId: scenario.id,
    name: scenario.name,
    run,
    reference,
    withoutBuild,
    results: resultsAt({ ...run, aleMean: run.aleMean }, scenario.id, steps, lines),
  };
};

const annualLossColumns = (row: PricedScenario['reference'] | PricedScenario['withoutBuild']) => ({
  years: row.years,
  mean: row.mean,
  lossYearShare: row.lossYearShare,
  lossEventYearShare: row.lossEventYearShare,
  probabilities: row.probabilities,
  losses: row.losses,
});

const annualLossReadings = (priced: ReadonlyArray<PricedScenario>) => priced.flatMap((scenario) => [
  { riskScenarioId: scenario.scenarioId, reviewVersion: 1, posture: 'reference' as const, ...annualLossColumns(scenario.reference) },
  { riskScenarioId: scenario.scenarioId, reviewVersion: 1, posture: 'without-build' as const, ...annualLossColumns(scenario.withoutBuild) },
]);

/** What the latest run of each scenario stored for a review, which its figures and its risk curve read. */
const storeReviewRun = async (db: Db, reviewId: string, priced: ReadonlyArray<PricedScenario>): Promise<void> => {
  await db.insert(crqBudgetReviewResults).values(priced.flatMap((scenario) => scenario.results.map((result) => ({
    id: uuidv7(),
    runId: scenario.run.id,
    reviewId,
    reviewVersion: 1,
    ...result,
  }))));
  await db.insert(crqBudgetReviewAnnualLosses).values(annualLossReadings(priced).map(({ riskScenarioId, ...row }) => ({
    id: uuidv7(),
    runId: priced.find((scenario) => scenario.scenarioId === riskScenarioId)!.run.id,
    reviewId,
    ...row,
  })));
};

/** The largest loss the stored annual loss row still exceeds with more than `probability`. */
const lossAtProbability = (row: PricedScenario['reference'] | PricedScenario['withoutBuild'], probability: number): number =>
  readLossAtProbability(buildExceedanceCurve({
    lossYearShare: row.lossYearShare,
    quantiles: row.probabilities.map((level, index) => ({ probability: level, loss: row.losses[index] })),
  }), probability);

/**
 * A tolerated probability every curve of `rows` exceeds with some loss: the probability is kept when
 * it lies below each curve's loss year share, else half the smallest share, never under the schema's
 * floor. Null when a curve has no loss year share above that floor.
 */
const probabilityFor = (rows: ReadonlyArray<PricedScenario['reference']>, held: number): number | null => {
  const share = Math.min(...rows.map((row) => row.lossYearShare));
  if (held < share) {
    return held;
  }
  const probability = Math.max(MIN_TOLERATED_PROBABILITY, Math.floor((share / 2) * 1000) / 1000);
  return probability < share ? probability : null;
};

/**
 * Sets the tolerances of the scope and its overriding scenarios where the reviews' story reads them
 * on the curves the engine-anchored runs stored: a scenario on the scope's tolerance outside it at the
 * previous closing and without the build work, back inside it today; a scenario on its own tolerance
 * outside it on every curve. A probability no curve's loss years reach cannot be exceeded at any
 * amount, so it moves under them first (`probabilityFor`). An amount then lies past the tolerance
 * exactly when it is below the loss the curve exceeds with that probability (`readLossAtProbability`),
 * so each amount is set between those bounds. A bound the curves cannot give leaves the tolerance.
 */
const fitTolerancesToCurves = async (
  db: Db,
  pricedRunning: ReadonlyArray<PricedScenario>,
  pricedPrevious: ReadonlyArray<PricedScenario>,
): Promise<void> => {
  const [scope] = await db.select().from(organizationRiskTolerances).where(eq(organizationRiskTolerances.organizationId, Organization_AcmeCorp));
  const own = await db.select().from(riskScenarioRiskTolerances)
    .where(inArray(riskScenarioRiskTolerances.riskScenarioId, pricedRunning.map((scenario) => scenario.scenarioId)));
  const previousOf = (scenarioId: string) => pricedPrevious.find((scenario) => scenario.scenarioId === scenarioId)!;

  for (const tolerance of own) {
    const running = pricedRunning.find((scenario) => scenario.scenarioId === tolerance.riskScenarioId)!;
    const curves = [running.reference, running.withoutBuild, previousOf(running.scenarioId).reference];
    const probability = probabilityFor(curves, tolerance.maxExceedanceProbability);
    const ceiling = probability === null ? 0 : Math.min(...curves.map((row) => lossAtProbability(row, probability)));
    if (probability !== null && ceiling > 0) {
      await db.update(riskScenarioRiskTolerances)
        .set({ annualLoss: ceiling / 2, maxExceedanceProbability: probability })
        .where(eq(riskScenarioRiskTolerances.id, tolerance.id));
    }
  }

  const onScope = pricedRunning.filter((scenario) => !own.some((tolerance) => tolerance.riskScenarioId === scenario.scenarioId));
  if (scope === undefined || onScope.length === 0) {
    return;
  }
  const outsideCurves = onScope.flatMap((scenario) => [scenario.withoutBuild, previousOf(scenario.scenarioId).reference]);
  const probability = probabilityFor(outsideCurves, scope.maxExceedanceProbability);
  const floor = probability === null ? 0 : Math.max(...onScope.map((scenario) => lossAtProbability(scenario.reference, probability)));
  const ceiling = probability === null ? 0 : Math.min(...outsideCurves.map((row) => lossAtProbability(row, probability)));
  if (probability !== null && ceiling > 0 && ceiling > floor) {
    await db.update(organizationRiskTolerances)
      .set({ annualLoss: floor > 0 ? Math.sqrt(floor * ceiling) : ceiling / 2, maxExceedanceProbability: probability })
      .where(eq(organizationRiskTolerances.id, scope.id));
  }
};

/** What closing the previous review stored, built by the functions the closing itself calls. */
const freezePreviousReview = async (db: Db, priced: ReadonlyArray<PricedScenario>): Promise<void> => {
  const reviewId = BudgetReview_AcmeCorpPreviousPeriod;
  const scenarios = priced.map((scenario) => ({ id: scenario.scenarioId, name: scenario.name, readinessStatus: 'ready' as const }));
  const { figures } = buildReviewFigures(
    scenarios,
    priced.flatMap((scenario) => scenario.results.map((result) => ({ riskScenarioId: scenario.scenarioId, runCreatedAt: scenario.run.createdAt, reviewVersion: 1, olderThanHeadline: false, ...result }))),
    1,
    PREVIOUS_LINES,
  );
  await db.insert(budgetReviewClosedFigures).values(figures.map((figure) => ({
    id: uuidv7(),
    reviewId,
    basket: figure.basket,
    lineId: figure.lineId,
    state: figure.state,
    aleReductionMean: figure.aleReductionMean,
    aleReductionP10: figure.aleReductionP10,
    aleReductionP90: figure.aleReductionP90,
    pricedScenarioCount: figure.pricedScenarioCount,
    scopeScenarioCount: scenarios.length,
    pricedAt: figure.pricedAt,
  })));

  const [scope] = await db.select().from(organizationRiskTolerances).where(eq(organizationRiskTolerances.organizationId, Organization_AcmeCorp));
  const own = await db.select().from(riskScenarioRiskTolerances)
    .where(inArray(riskScenarioRiskTolerances.riskScenarioId, scenarios.map((scenario) => scenario.id)));
  const tolerances = scenarios.map((scenario) => ({
    riskScenarioId: scenario.id,
    scope: scope ?? null,
    own: own.find((row) => row.riskScenarioId === scenario.id) ?? null,
  }));
  await db.insert(budgetReviewClosedTolerances).values(buildReviewTolerance(scenarios, tolerances, annualLossReadings(priced), 1, new Set())
    .map((scenario) => ({ id: uuidv7(), reviewId, ...closedToleranceColumnsOf(scenario) })));

  await db.insert(budgetReviewClosedPostures).values(PREVIOUS_POSTURES.map((posture) => ({
    id: uuidv7(),
    reviewId,
    capabilityId: capabilityIdOf(posture.externalId),
    startStrengthRung: posture.start.strength,
    startCoverageBucket: posture.start.coverage,
    endStrengthRung: posture.end.strength,
    endCoverageBucket: posture.end.coverage,
  })));
};

/**
 * Two budget reviews of the payment platform scope: the fiscal year still running, open and priced,
 * and the one before it, closed. Their figures are fabricated as the CRQ runs are, on the factors the
 * run history steps down by. The running year's identity work brings the CRM breach back inside the
 * scope's tolerance and leaves the retail one outside its own, which the previous year left outside
 * too.
 */
registerPlatformSeed('budget-reviews', async ({ db, now, engineReadings }) => {
  const previousStart = previousPeriodStart(now);
  const running: ReviewSpec = {
    id: BudgetReview_AcmeCorpRunningPeriod, periodStart: runningPeriodStart(now), createdAt: withinRunningPeriod(now, 0.6), lines: RUNNING_LINES, firstLineIndex: 0,
  };
  const previous: ReviewSpec = {
    id: BudgetReview_AcmeCorpPreviousPeriod,
    periodStart: previousStart,
    createdAt: new Date(Date.UTC(previousStart.getUTCFullYear(), previousStart.getUTCMonth() + 10, 1)),
    lines: PREVIOUS_LINES,
    firstLineIndex: RUNNING_LINES.length,
  };
  const previousEnd = reviewPeriodBounds(periodStartColumn(previous.periodStart)).end;

  await insertReview(db, running, null);
  await insertReview(db, previous, new Date(previousEnd.getTime() + 18 * 86_400_000 + 10 * 3_600_000));

  const scopeScenarios = await db.select({ id: riskScenarios.id, name: riskScenarios.name }).from(riskScenarios)
    .where(eq(riskScenarios.organizationId, Organization_AcmeCorp));
  const pricedRunning: Array<PricedScenario> = [];
  const pricedPrevious: Array<PricedScenario> = [];
  for (const scenario of scopeScenarios) {
    const steps = postureStepsOf(scenario.id, now);
    if (steps === undefined) {
      throw new Error(`[platform-seed] Budget review scope scenario ${scenario.id} has no posture steps to price`);
    }
    // Engine-anchored runs can price a scenario at a very low LEF: its curve without the build work
    // keeps enough loss years for the tolerance story to read it outside.
    const minShare = engineReadings === null ? null : MIN_WITHOUT_BUILD_SHARE;
    pricedRunning.push(await priceScenario(db, scenario, steps.running, RUNNING_LINES, null, minShare));
    pricedPrevious.push(await priceScenario(db, scenario, steps.previous, PREVIOUS_LINES, previousEnd, minShare));
  }
  // The fixed amounts of `risk-tolerances` are read against invented anchors; engine-anchored runs
  // price the scope an order of magnitude apart, so the amounts follow their curves instead.
  if (engineReadings !== null) {
    await fitTolerancesToCurves(db, pricedRunning, pricedPrevious);
  }
  await storeReviewRun(db, running.id, pricedRunning);
  await storeReviewRun(db, previous.id, pricedPrevious);
  await freezePreviousReview(db, pricedPrevious);
}, 'history');
