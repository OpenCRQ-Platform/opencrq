import { desc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { CoverageBucket, StrengthRung } from '../../modules/controls/capability/constants';
import type { CrqControlWhatIfDimension, CrqControlWhatIfZeroReason, CrqReachGapKind } from '../../modules/crq-indicators/schema';
import type { AssetCategory } from '../../modules/supporting-assets/constants';
import type { SeededAttacker } from '../data/attacker-classes';
import type { PostureStep } from '../data/budget-review-story';
import type { EngineReading, PlatformSeedServices, SeedContext } from '../platform-seed-registry';
import type { DrizzleDB } from '../../db';
import { isActiveTechnique } from '../../modules/attack-outcomes';
import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '../../modules/controls/capability/constants';
import { controlCapabilityAssessments } from '../../modules/controls/capability/schema';
import { ATTACK_RUN_CATALOGUE_VINTAGE } from '../../modules/crq-indicators/attack-run-inputs';
import { ATTACKER_FACTS } from '../../modules/crq-indicators/engine/attack-walk';
import { ANNUAL_LOSS_YEARS_PER_WORLD, sampleAnnualLosses } from '../../modules/crq-indicators/engine/annual-loss';
import { ATTACK_RUN_CALIBRATION_VINTAGE, ATTACK_RUN_CORNER_CONSTANTS } from '../../modules/crq-indicators/engine/attack-run-constants';
import { pertQuantile } from '../../modules/crq-indicators/engine/distributions';
import { createPrng, deriveSeed } from '../../modules/crq-indicators/engine/prng';
import { pricedFraction } from '../../modules/crq-indicators/engine/priced-fraction';
import { PRICE_RUN_PROFILE } from '../../modules/crq-indicators/run-profile';
import {
  crqControlWhatIfResults,
  crqIndicatorGroupScores,
  crqIndicatorRunAnnualLosses,
  crqIndicatorRunReachGaps,
  crqIndicatorRuns,
  crqIndicatorRunUnplayableObstacles,
  crqTechniqueWhatIfResults,
  tefEstimates,
} from '../../modules/crq-indicators/schema';
import { resolveEffectiveActorClass } from '../../modules/threat-analyses/actor-classes';
import { threatAnalyses } from '../../modules/threat-analyses/schema';
import { riskScenarios } from '../../modules/risk-scenarios/schema';
import { scenarioLossEstimates } from '../../modules/scenario-loss-estimates/schema';
import { computePertExpectedValue } from '../../modules/scenario-loss-estimates/pert';
import { ASSET_CATEGORY_VALUES, isLossBearingAssetCategory, UNCLASSIFIED_ASSET_CATEGORY } from '../../modules/supporting-assets/constants';
import { supportingAssets } from '../../modules/supporting-assets/schema';
import { TEF_EVERY_SIZE, TEF_SIZE_CLASSES } from '../../modules/tef-catalog/catalogue-constants';
import { foldAttackersByClass } from '../data/attacker-classes';
import { postureStepsOf, stepMultiplierAt } from '../data/budget-review-story';
import {
  crqHistoryRunId,
  RiskScenario_BizInterruptionEcommerce,
  RiskScenario_CardDataBreachKestrelmoor,
  RiskScenario_DataBreachCrm,
  RiskScenario_DataBreachRetailPos,
  RiskScenario_EspionageFirmware,
  RiskScenario_RansomwareTradeFinance,
  Tenant_Acme,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

interface ScenarioSimSpec {
  scenarioId: string,
  // Factor applied to the anchor run's values at the oldest point of the history window; the
  // series interpolates from there back to 1.0 (the anchor) so trends read rising (<1) or
  // falling (>1) on the dashboards.
  startFactor: number,
}

// `RiskScenario_DataBreachAmlExposure` is deliberately absent: it names the same outcome as
// `RiskScenario_DataBreachCrm` and `RiskScenario_DataBreachRetailPos` but stays unsimulated, so the
// attack outcome overview's exposure ledger has a scenario to show as "Not simulated".
const SCENARIO_SIM_SPECS: Array<ScenarioSimSpec> = [
  // High enough that the budget review closing the previous fiscal year reads it outside the
  // scope's tolerance on any date, which the running review's build work alone would only just do.
  { scenarioId: RiskScenario_DataBreachCrm, startFactor: 1.3 },
  { scenarioId: RiskScenario_DataBreachRetailPos, startFactor: 1.1 },
  { scenarioId: RiskScenario_BizInterruptionEcommerce, startFactor: 1.5 },
  { scenarioId: RiskScenario_EspionageFirmware, startFactor: 1.3 },
  { scenarioId: RiskScenario_RansomwareTradeFinance, startFactor: 0.6 },
  { scenarioId: RiskScenario_CardDataBreachKestrelmoor, startFactor: 1.0 },
];

/**
 * The anchor run of each simulated scenario, which is the latest of its history and the only one
 * carrying child rows besides reach gaps. A later seeder writing rows against these runs computes the same ids rather
 * than reading them back through a join, and an id whose scenario stayed unsimulated matches no row.
 */
export const CRQ_ANCHOR_RUN_IDS: ReadonlyArray<string> =
  SCENARIO_SIM_SPECS.map((_, specIndex) => crqHistoryRunId(specIndex, 0));

/** The scenarios the history is seeded for, which the engine prices between the two phases. */
export const SIMULATED_SCENARIO_IDS: ReadonlyArray<string> = SCENARIO_SIM_SPECS.map((spec) => spec.scenarioId);

// RetailPos is the only scenario above still on manual TEF mode - the others compute theirs
// automatically from firmography - so it is the only one that needs a seeded input row.
export const MANUAL_TEF_INPUT = { riskScenarioId: RiskScenario_DataBreachRetailPos, min: 1, likely: 3, max: 7 };

/** What the demo tenant is configured with, and what the fabricated runs claim to have drawn. */
export const DEMO_WORLDS = 400;

/** The tenant's last phishing simulation, read by the engine as measured under the awareness training the seed declares. */
export const DEMO_PHISHING_FAILURE_RATE = 0.05;
export const DEMO_PHISHING_MEASURED_DAYS_AGO = 90;

const HISTORY_DAYS = 365;
/** The longest window the review page draws, which a fiscal year closed last year needs whole. */
const REVIEWED_SCOPE_HISTORY_DAYS = 731;
const COVERED_COUNT_STEP_DAYS = 60;

const GAP_FAMILIES: ReadonlyArray<AssetCategory> = ASSET_CATEGORY_VALUES
  .filter((family) => family !== UNCLASSIFIED_ASSET_CATEGORY && isLossBearingAssetCategory(family));

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

type Prng = () => number;

const between = (prng: Prng, min: number, max: number): number => min + (max - min) * prng();

const pick = <T>(prng: Prng, values: ReadonlyArray<T>): T => values[Math.floor(prng() * values.length)];

/** Derived rather than drawn: a draw here would shift every figure seeded after it. */
export const bandInside = (p5: number, centre: number, p95: number): { p10: number, p90: number } => ({
  p10: p5 + (centre - p5) * 0.3,
  p90: centre + (p95 - centre) * 0.55,
});

/** A right-skewed spread around a mean, the shape every figure of a real run has. */
const spreadAround = (prng: Prng, mean: number): { p5: number, p10: number, p50: number, p90: number, p95: number } => {
  const p5 = mean * between(prng, 0.2, 0.45);
  const p50 = mean * between(prng, 0.65, 0.95);
  const p95 = mean * between(prng, 1.6, 2.8);
  return { p5, ...bandInside(p5, p50, p95), p50, p95 };
};

const nextRung = (rung: StrengthRung): StrengthRung =>
  STRENGTH_RUNGS[Math.min(STRENGTH_RUNGS.indexOf(rung) + 1, STRENGTH_RUNGS.length - 1)];

const nextBucket = (bucket: CoverageBucket): CoverageBucket =>
  COVERAGE_BUCKETS[Math.min(COVERAGE_BUCKETS.indexOf(bucket) + 1, COVERAGE_BUCKETS.length - 1)];

/** A reach gap held on the runs from `since` days before the anchor run up to `until` days before it. */
interface GapSpan {
  mitreTechniqueId: string,
  family: AssetCategory,
  gap: CrqReachGapKind,
  since: number,
  until: number,
}

/**
 * Each anchor gap back to the day it opened, and pairs the anchor no longer holds back to the day
 * they closed. One of each moves inside the week before the anchor, so the default comparison of
 * the last seven days shows a pair on a run between its two ends.
 */
const buildGapSpans = (
  spec: ScenarioSimSpec,
  anchorGaps: ReadonlyArray<typeof crqIndicatorRunReachGaps.$inferInsert>,
  techniqueIds: ReadonlyArray<string>,
): Array<GapSpan> => {
  const prng = createPrng(deriveSeed(spec.scenarioId, 'platform-seed-gap-history'));
  const recentDay = (index: number, recent: number): number =>
    (index === 0 ? recent : Math.floor(between(prng, 8, 120)));
  const opened = anchorGaps.map((row, index): GapSpan => ({
    mitreTechniqueId: row.mitreTechniqueId,
    family: row.family,
    gap: row.gap,
    since: index > 0 && prng() < 0.5 ? HISTORY_DAYS : recentDay(index, 6),
    until: 0,
  }));
  const anchored = new Set(anchorGaps.map((row) => row.mitreTechniqueId));
  const closed = techniqueIds
    .filter((id) => !anchored.has(id))
    .slice(0, 3)
    .map((mitreTechniqueId, index): GapSpan => ({
      mitreTechniqueId,
      family: pick(prng, GAP_FAMILIES),
      gap: prng() < 0.6 ? 'estate' : 'catalogue',
      since: HISTORY_DAYS,
      until: recentDay(index, 5),
    }));
  return [...opened, ...closed];
};

/**
 * Backdated copies of the anchor run with its trend split across a threat, a defences and a
 * business factor (attacks per year, the priced share of those attacks, the cost of one that
 * lands), and the aggregate frequencies and euros scaled along with them. Everything else on the
 * row is the anchor's own, and the reach gaps are the only child rows a history run has.
 *
 * A scenario a budget review prices steps down where the review's build work landed, and reaches
 * back over both of its seeded fiscal years. That older stretch draws from its own seeds, so the
 * year every other surface reads keeps exactly the runs it had.
 */
const buildHistoryRows = (
  spec: ScenarioSimSpec,
  specIndex: number,
  anchor: typeof crqIndicatorRuns.$inferInsert,
  gapSpans: ReadonlyArray<GapSpan>,
  now: Date,
): { rows: Array<typeof crqIndicatorRuns.$inferInsert>, gapRows: Array<typeof crqIndicatorRunReachGaps.$inferInsert> } => {
  const steps = postureStepsOf(spec.scenarioId, now);
  const stepsAhead = steps === undefined ? [] : [...steps.previous, ...steps.running];
  const recent = historyRowsOver(spec, specIndex, anchor, gapSpans, now, stepsAhead, { oldestDay: HISTORY_DAYS, newestDay: 2, seed: 'platform-seed-history' });
  if (steps === undefined) {
    return recent;
  }
  const older = historyRowsOver(spec, specIndex, anchor, gapSpans, now, stepsAhead, {
    oldestDay: REVIEWED_SCOPE_HISTORY_DAYS,
    newestDay: HISTORY_DAYS + 1,
    seed: 'platform-seed-history-older',
  });
  return { rows: [...older.rows, ...recent.rows], gapRows: [...older.gapRows, ...recent.gapRows] };
};

const historyRowsOver = (
  spec: ScenarioSimSpec,
  specIndex: number,
  anchor: typeof crqIndicatorRuns.$inferInsert,
  gapSpans: ReadonlyArray<GapSpan>,
  now: Date,
  steps: ReadonlyArray<PostureStep>,
  days: { oldestDay: number, newestDay: number, seed: string },
): { rows: Array<typeof crqIndicatorRuns.$inferInsert>, gapRows: Array<typeof crqIndicatorRunReachGaps.$inferInsert> } => {
  const prng = createPrng(deriveSeed(spec.scenarioId, days.seed));
  // Kept apart from `prng` so splitting the trend into three factors below draws no extra value
  // from it: the run dates and minutes must stay exactly what they were before the split existed.
  const factorPrng = createPrng(deriveSeed(spec.scenarioId, `${days.seed}-factors`));
  const rows: Array<typeof crqIndicatorRuns.$inferInsert> = [];
  const gapRows: Array<typeof crqIndicatorRunReachGaps.$inferInsert> = [];
  const anchorPassed = anchor.outcomeEvicted! + anchor.outcomeImpactDetected! + anchor.outcomeImpactUndetected!;

  for (let day = days.oldestDay; day >= days.newestDay; day--) {
    const date = new Date(now.getTime() - day * 86_400_000);
    const weekday = date.getUTCDay();
    const isRunDay = weekday === 1 || weekday === 3 || (weekday === 5 && prng() < 0.5);
    if (!isRunDay) {
      continue;
    }

    const progress = 1 - day / HISTORY_DAYS;
    const trend = (spec.startFactor + (1 - spec.startFactor) * progress) * (1 + (prng() - 0.5) * 0.08);
    // A build project moves the defences alone, so its step stays out of the threat and business factors.
    const step = stepMultiplierAt(steps, date);
    const factor = trend * step;
    // Threat and defences each land near trend^(1/3) with their own noise; business closes the
    // product exactly, so the ALE columns below scale by `factor` alone.
    const cubeRoot = Math.cbrt(trend);
    const threatFactor = cubeRoot * (1 + (factorPrng() - 0.5) * 0.04);
    // The trend scales the odds of getting past blocking, which keeps every share in [0, 1]. A build
    // step scales the passed shares directly, so the business factor stays step-free; the guard below
    // catches a step the anchor's blocked share cannot absorb.
    const trendOdds = cubeRoot * (1 + (factorPrng() - 0.5) * 0.04);
    const trendDefenceFactor = trendOdds / (anchor.outcomeBlocked! + anchorPassed * trendOdds);
    const defenceFactor = trendDefenceFactor * step;
    const outcomeBlocked = 1 - anchorPassed * defenceFactor;
    if (outcomeBlocked < 0) {
      throw new Error(`[platform-seed] the posture steps of ${spec.scenarioId} leave its run ${day} days back blocking ${outcomeBlocked} of attacks`);
    }
    const businessFactor = factor / (threatFactor * defenceFactor);
    // 09:00-11:29 UTC keeps the run inside the same day for both the UTC-bucketed dashboard
    // trend and the local-day scenario ALE chart.
    const createdAt = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      9,
      Math.floor(prng() * 150),
    ));

    const scaled = (value: number | null | undefined, byFactor: number): number | null =>
      (value === null || value === undefined ? null : value * byFactor);

    const outcomeEvicted = anchor.outcomeEvicted! * defenceFactor;
    const outcomeImpactDetected = anchor.outcomeImpactDetected! * defenceFactor;
    const outcomeImpactUndetected = anchor.outcomeImpactUndetected! * defenceFactor;

    const runId = crqHistoryRunId(specIndex, day);
    const held = gapSpans.filter((span) => span.until <= day && day <= span.since);
    gapRows.push(...held.map((span) => ({
      id: uuidv7(),
      runId,
      mitreTechniqueId: span.mitreTechniqueId,
      family: span.family,
      gap: span.gap,
    })));

    rows.push({
      ...anchor,
      id: runId,
      createdAt,
      uncontestedPairCount: held.filter((span) => span.gap === 'estate').length,
      uncontestablePairCount: held.filter((span) => span.gap === 'catalogue').length,
      tefMin: anchor.tefMin! * threatFactor,
      tefLikely: anchor.tefLikely! * threatFactor,
      tefMax: anchor.tefMax! * threatFactor,
      vulnerabilityP5: clamp01(anchor.vulnerabilityP5 * defenceFactor),
      vulnerabilityP50: clamp01(anchor.vulnerabilityP50 * defenceFactor),
      vulnerabilityP95: clamp01(anchor.vulnerabilityP95 * defenceFactor),
      vulnerabilityMean: anchor.vulnerabilityMean == null ? null : clamp01(anchor.vulnerabilityMean * defenceFactor),
      outcomeBlocked,
      outcomeEvicted,
      outcomeImpactDetected,
      outcomeImpactUndetected,
      lefP10: scaled(anchor.lefP10, threatFactor * defenceFactor),
      lefP90: scaled(anchor.lefP90, threatFactor * defenceFactor),
      lefMean: scaled(anchor.lefMean, threatFactor * defenceFactor),
      magnitudeMean: scaled(anchor.magnitudeMean, businessFactor),
      magnitudeP10: scaled(anchor.magnitudeP10, businessFactor),
      magnitudeP90: scaled(anchor.magnitudeP90, businessFactor),
      aleP10: scaled(anchor.aleP10, factor),
      aleP90: scaled(anchor.aleP90, factor),
      aleMean: scaled(anchor.aleMean, factor),
      aleAtMemorylessDetection: scaled(anchor.aleAtMemorylessDetection, factor),
      coveredTechniqueCount: day > COVERED_COUNT_STEP_DAYS
        ? Math.max(anchor.coveredTechniqueCount - 2, 0)
        : anchor.coveredTechniqueCount,
    });
  }

  return { rows, gapRows };
};

/** The right-skewed law of one loss relative to its mean, read at evenly spaced levels rather than drawn. */
const MAGNITUDE_SHAPE = { min: 0.2, likely: 0.7, max: 3.5 };

export const magnitudeShape = (): Float64Array => {
  const shapeMean = (MAGNITUDE_SHAPE.min + 4 * MAGNITUDE_SHAPE.likely + MAGNITUDE_SHAPE.max) / 6;
  return Float64Array.from({ length: DEMO_WORLDS }, (_, world) =>
    pertQuantile(MAGNITUDE_SHAPE.min, MAGNITUDE_SHAPE.likely, MAGNITUDE_SHAPE.max, (world + 0.5) / DEMO_WORLDS) / shapeMean);
};

/**
 * The annual loss a priced run stores, sampled by the engine on rates and magnitudes chosen so the
 * loss events arrive at the run's LEF and the years average its ALE. Null for an unpriced run, which
 * the engine writes no distribution for either.
 */
export const buildAnnualLossRow = (
  run: typeof crqIndicatorRuns.$inferInsert,
  shape: Float64Array,
): typeof crqIndicatorRunAnnualLosses.$inferInsert | null => {
  const { lefMean, aleMean } = run;
  const evicted = run.outcomeEvicted!;
  const impactDetected = run.outcomeImpactDetected!;
  const impactUndetected = run.outcomeImpactUndetected!;
  const lossEventShare = impactDetected + impactUndetected;
  if (lefMean == null || aleMean == null || lefMean <= 0 || lossEventShare <= 0) {
    return null;
  }
  const attackRate = lefMean / lossEventShare;
  const magnitude = aleMean / (attackRate * pricedFraction({ evicted, impactDetected, impactUndetected }));
  const constantRate = (rate: number) => new Float64Array(DEMO_WORLDS).fill(rate);
  const none = { evicted: 0, impactDetected: 0, impactUndetected: 0 };
  const distribution = sampleAnnualLosses({
    streams: [
      { rates: constantRate(attackRate * impactUndetected), pricedFraction: pricedFraction({ ...none, impactUndetected: 1 }), lossEvent: true },
      { rates: constantRate(attackRate * impactDetected), pricedFraction: pricedFraction({ ...none, impactDetected: 1 }), lossEvent: true },
      { rates: constantRate(attackRate * evicted), pricedFraction: pricedFraction({ ...none, evicted: 1 }), lossEvent: false },
    ],
    magnitudes: shape.map((relative) => relative * magnitude),
    yearsPerWorld: ANNUAL_LOSS_YEARS_PER_WORLD,
    seed: run.id,
  });
  return {
    id: run.id,
    runId: run.id,
    years: distribution.years,
    mean: distribution.mean,
    lossYearShare: distribution.lossYearShare,
    lossEventYearShare: distribution.lossEventYearShare,
    probabilities: distribution.quantiles.map((quantile) => quantile.probability),
    losses: distribution.quantiles.map((quantile) => quantile.loss),
  };
};

/**
 * The anchor run of one scenario, invented rather than simulated.
 *
 * The figures come from the scenario's own seed, so they mean nothing in themselves. Everything a
 * surface joins on is read from the database instead: the admitted actors and their classes, the
 * scored techniques, the declared controls, the estate size. That is what keeps the counts on the
 * run row equal to the child rows underneath it and every foreign key pointing at a row that exists.
 * The one count that is not a row count is the admitted actors: the attackers are stored one per
 * actor class, as the engine stores them.
 *
 * With the engine's reading of the scenario (`readEngineReadings`), the vulnerability and the outcome
 * split are the engine's and the actors are scaled to them, so the headline the boot price pass writes
 * next continues the history instead of breaking it (#3253). Without one, they are drawn too.
 *
 * Null for a scenario whose outcome admits no actor: it stays unsimulated, a state the demo exists
 * to show.
 */
const buildAnchorRun = async (
  { db, services }: Pick<SeedContext, 'db' | 'services'>,
  spec: ScenarioSimSpec,
  specIndex: number,
  engine: EngineReading | null,
): Promise<{ run: typeof crqIndicatorRuns.$inferInsert, gapSpans: Array<GapSpan> } | null> => {
  const prng = createPrng(deriveSeed(spec.scenarioId, 'platform-seed-anchor'));
  const platform = services.withOrigin({ type: 'system' });

  const [scenario] = await db.select().from(riskScenarios).where(eq(riskScenarios.id, spec.scenarioId));
  if (!scenario) {
    throw new Error(`[platform-seed] CRQ spec names an unknown risk scenario ${spec.scenarioId}`);
  }

  const outcome = await platform.attackOutcomes.getMitreTechniquesForOutcome(
    scenario.attackOutcomeId,
    { organizationId: scenario.organizationId, tenantId: Tenant_Acme },
  );
  if (outcome.mixtureGroups.length === 0) {
    return null;
  }

  const tef = scenario.tefMode === 'auto'
    ? await platform.crqIndicators.resolveAutoTef(spec.scenarioId, Tenant_Acme)
    : MANUAL_TEF_INPUT;

  // Sequential: the seed's `db` is one transaction, a single connection `pg` will not queue on from v9.
  const analyses = await db.select().from(threatAnalyses)
    .where(inArray(threatAnalyses.id, outcome.mixtureGroups.map((group) => group.groupKey)));
  const estimates = await db.select().from(scenarioLossEstimates).where(eq(scenarioLossEstimates.riskScenarioId, spec.scenarioId));
  const assets = await db.select({ id: supportingAssets.id }).from(supportingAssets).where(eq(supportingAssets.tenantId, Tenant_Acme));
  const assessments = await db.select().from(controlCapabilityAssessments)
    .where(eq(controlCapabilityAssessments.tenantId, Tenant_Acme))
    .orderBy(controlCapabilityAssessments.capabilityId);

  const magnitude = estimates.reduce((total, row) => (
    row.minValue === null || row.likelyValue === null || row.maxValue === null
      ? total
      : total + computePertExpectedValue(row.minValue, row.likelyValue, row.maxValue)
  ), 0);
  const priced = magnitude > 0;
  const euros = (value: number): number | null => (priced ? value : null);

  const classByAnalysisId = new Map(analyses.map((row) => [row.id, resolveEffectiveActorClass(row)]));
  const admittedShare = outcome.mixtureGroups.reduce((total, group) => total + group.share, 0);
  // The outcome's actors and techniques come back in no set order, and each one takes the next draws.
  const drawnActors = outcome.mixtureGroups.toSorted((a, b) => a.groupKey.localeCompare(b.groupKey)).map((group): SeededAttacker => {
    const actorClass = classByAnalysisId.get(group.groupKey) ?? 'default';
    const actorVulnerabilityMean = between(prng, 0.04, 0.36);
    const actorVulnerability = spreadAround(prng, actorVulnerabilityMean);
    return {
      share: group.share / admittedShare,
      actorClass,
      vulnerabilityMean: actorVulnerabilityMean,
      vulnerabilityP5: clamp01(actorVulnerability.p5),
      vulnerabilityP50: clamp01(actorVulnerability.p50),
      vulnerabilityP95: clamp01(actorVulnerability.p95),
      // The state that makes every detect control worth zero against an actor. Rare, and the demo
      // carries a case of it because a column of zeros with no reason reads as a defect.
      reactionTimeExceededShare: prng() < 0.25 ? between(prng, 0.1, 0.7) : 0,
    };
  });

  // Every actor scaled alike, so the recombined mean is the engine's and no actor passes certainty.
  const drawnVulnerability = drawnActors.reduce((total, actor) => total + actor.share * actor.vulnerabilityMean, 0);
  const scale = engine === null || drawnVulnerability === 0
    ? 1
    : Math.min(engine.vulnerabilityMean / drawnVulnerability, 1 / Math.max(...drawnActors.map((actor) => actor.vulnerabilityMean)));
  const actors = drawnActors.map((actor): SeededAttacker => ({
    ...actor,
    vulnerabilityMean: actor.vulnerabilityMean * scale,
    vulnerabilityP5: clamp01(actor.vulnerabilityP5 * scale),
    vulnerabilityP50: clamp01(actor.vulnerabilityP50 * scale),
    vulnerabilityP95: clamp01(actor.vulnerabilityP95 * scale),
  }));

  const attackers = foldAttackersByClass(actors).map((attacker) => ({ ...attacker, groupKey: uuidv7() }));
  const groupKeyByClass = new Map(attackers.map((attacker) => [attacker.actorClass, attacker.groupKey]));
  const vulnerabilityMean = actors.reduce((total, actor) => total + actor.share * actor.vulnerabilityMean, 0);
  const vulnerability = spreadAround(prng, vulnerabilityMean);
  const lefMean = tef.likely * vulnerabilityMean;
  const lef = spreadAround(prng, lefMean);
  // The mean this shape scales needs the outcome split below, so only the shape (relative to a
  // mean of 1) is drawn here, at the ALE spread's usual place in the sequence.
  const aleSpread = spreadAround(prng, 1);

  // Drawn whatever the engine read, so every later draw of the sequence stays where it was.
  const detectedShare = between(prng, 0.35, 0.7);
  const evictedShare = between(prng, 0.1, 0.3);
  const outcomeImpactDetected = engine === null ? vulnerabilityMean * detectedShare : Math.min(engine.outcomeImpactDetected, vulnerabilityMean);
  const outcomeEvicted = engine === null ? (1 - vulnerabilityMean) * evictedShare : Math.min(engine.outcomeEvicted, 1 - vulnerabilityMean);
  const outcomeImpactUndetected = vulnerabilityMean - outcomeImpactDetected;
  // The engine's own identity: loss = attacks per year x the priced share of those attacks x the
  // cost of one that lands.
  const aleMean = computePertExpectedValue(tef.min, tef.likely, tef.max)
    * pricedFraction({ evicted: outcomeEvicted, impactDetected: outcomeImpactDetected, impactUndetected: outcomeImpactUndetected })
    * magnitude;
  const ale = { p10: aleSpread.p10 * aleMean, p90: aleSpread.p90 * aleMean };

  const runId = crqHistoryRunId(specIndex, 0);
  const techniques = outcome.techniques.filter(isActiveTechnique).toSorted((a, b) => a.externalId.localeCompare(b.externalId));

  const techniqueRows = techniques.map((technique) => ({
    id: uuidv7(),
    runId,
    mitreTechniqueId: technique.mitreTechniqueId,
    preventValueMean: euros(aleMean * between(prng, 0, 0.09)),
    detectValueMean: euros(aleMean * between(prng, 0, 0.05)),
  }));

  const gapRows: Array<typeof crqIndicatorRunReachGaps.$inferInsert> = techniques
    .filter(() => prng() < 0.2)
    .map((technique) => ({
      id: uuidv7(),
      runId,
      mitreTechniqueId: technique.mitreTechniqueId,
      family: pick(prng, GAP_FAMILIES),
      gap: prng() < 0.6 ? 'estate' : 'catalogue',
    }));

  // One draw per actor, deduplicated after: two actors of a class can draw the same obstacle.
  const drawnObstacles = actors
    .filter(() => prng() < 0.2)
    .flatMap((actor) => {
      const obstacleKey = pick(prng, ATTACKER_FACTS);
      const groupKey = groupKeyByClass.get(actor.actorClass);
      return groupKey === undefined ? [] : [{ groupKey, obstacleKey }];
    });
  const obstacleRows = [...new Map(drawnObstacles.map((obstacle) => [`${obstacle.groupKey}:${obstacle.obstacleKey}`, obstacle])).values()]
    .map((obstacle) => ({ id: uuidv7(), runId, ...obstacle }));

  const controlRows = assessments.flatMap((assessment) => {
    const levers: Array<{
      dimension: CrqControlWhatIfDimension,
      upgradedStrength: StrengthRung,
      upgradedCoverage: CoverageBucket,
      zeroReason: CrqControlWhatIfZeroReason | null,
    }> = [];
    if (assessment.strengthRung === 'L0' || assessment.coverageBucket === 'L0') {
      levers.push({ dimension: 'deploy', upgradedStrength: 'L1', upgradedCoverage: 'L1', zeroReason: null });
    } else if (assessment.strengthRung === 'L3' && assessment.coverageBucket === 'L3') {
      levers.push({ dimension: 'strength', upgradedStrength: 'L3', upgradedCoverage: 'L3', zeroReason: 'already-maximal' });
    } else {
      if (assessment.strengthRung !== 'L3') {
        levers.push({
          dimension: 'strength',
          upgradedStrength: nextRung(assessment.strengthRung),
          upgradedCoverage: assessment.coverageBucket,
          zeroReason: prng() < 0.2 ? pick(prng, ['actor-repertoire', 'estate-families'] as const) : null,
        });
      }
      if (assessment.coverageBucket !== 'L3') {
        levers.push({
          dimension: 'coverage',
          upgradedStrength: assessment.strengthRung,
          upgradedCoverage: nextBucket(assessment.coverageBucket),
          zeroReason: prng() < 0.2 ? 'estate-families' : null,
        });
      }
    }

    return levers.map((lever) => {
      const reduction = lever.zeroReason === null ? aleMean * between(prng, 0.01, 0.18) : 0;
      const low = reduction * between(prng, 0.2, 0.8);
      const high = reduction * between(prng, 1.2, 3.2);
      const band = bandInside(low, reduction, high);
      return {
        id: uuidv7(),
        runId,
        controlId: assessment.capabilityId,
        controlKind: 'capability' as const,
        dimension: lever.dimension,
        currentStrength: assessment.strengthRung,
        upgradedStrength: lever.upgradedStrength,
        currentCoverage: assessment.coverageBucket,
        upgradedCoverage: lever.upgradedCoverage,
        aleReductionMean: euros(reduction),
        aleReductionP10: euros(band.p10),
        aleReductionP90: euros(band.p90),
        zeroReason: lever.zeroReason,
      };
    });
  });

  const unscannedAssetCount = Math.round(assets.length * between(prng, 0.05, 0.35));
  const coveredTechniqueCount = Math.round(techniqueRows.length * between(prng, 0.55, 0.9));
  const aleAtMemorylessDetection = aleMean * between(prng, 1.05, 1.25);
  const magnitudeSpread = spreadAround(prng, magnitude);
  const run: typeof crqIndicatorRuns.$inferInsert = {
    id: runId,
    riskScenarioId: spec.scenarioId,
    // Not the seed's clock: the run comes after the loss estimates the services dated from their own.
    createdAt: new Date(),
    iterations: DEMO_WORLDS,
    vulnerabilityP5: clamp01(vulnerability.p5),
    vulnerabilityP50: clamp01(vulnerability.p50),
    vulnerabilityP95: clamp01(vulnerability.p95),
    vulnerabilityMean,
    tefMin: tef.min,
    tefLikely: tef.likely,
    tefMax: tef.max,
    lefP10: lef.p10,
    lefP90: lef.p90,
    lefMean,
    aleP10: euros(ale.p10),
    aleP90: euros(ale.p90),
    aleMean: euros(aleMean),
    magnitudeMean: euros(magnitude),
    magnitudeP10: euros(magnitudeSpread.p10),
    magnitudeP90: euros(magnitudeSpread.p90),
    techniqueCount: techniqueRows.length,
    coveredTechniqueCount,
    threatEvidenceMode: outcome.evidenceMode,
    admittedActorCount: outcome.mixtureGroups.length,
    outcomeBlocked: 1 - vulnerabilityMean - outcomeEvicted,
    outcomeEvicted,
    outcomeImpactDetected,
    outcomeImpactUndetected,
    calibrationVintage: ATTACK_RUN_CALIBRATION_VINTAGE,
    cornerConstants: [...ATTACK_RUN_CORNER_CONSTANTS],
    catalogueVintage: ATTACK_RUN_CATALOGUE_VINTAGE,
    unscannedAssetShare: assets.length === 0 ? 0 : unscannedAssetCount / assets.length,
    unscannedAssetCount,
    estateAssetCount: assets.length,
    uncontestedPairCount: gapRows.filter((row) => row.gap === 'estate').length,
    uncontestablePairCount: gapRows.filter((row) => row.gap === 'catalogue').length,
    aleAtMemorylessDetection: euros(aleAtMemorylessDetection),
  };

  await db.insert(crqIndicatorRuns).values(run);
  await db.insert(crqIndicatorGroupScores).values(attackers.map((attacker) => ({
    id: uuidv7(),
    runId,
    groupName: null,
    groupEntityType: null,
    ...attacker,
  })));
  if (gapRows.length > 0) {
    await db.insert(crqIndicatorRunReachGaps).values(gapRows);
  }
  if (obstacleRows.length > 0) {
    await db.insert(crqIndicatorRunUnplayableObstacles).values(obstacleRows);
  }
  if (controlRows.length > 0) {
    await db.insert(crqControlWhatIfResults).values(controlRows);
  }
  if (techniqueRows.length > 0) {
    await db.insert(crqTechniqueWhatIfResults).values(techniqueRows);
  }
  return { run, gapSpans: buildGapSpans(spec, gapRows, techniques.map((technique) => technique.mitreTechniqueId)) };
};

/** One class below the anchor's, or no size at all when the anchor read no single class. */
const earlierSizeOf = (anchor: typeof tefEstimates.$inferSelect): Pick<typeof tefEstimates.$inferInsert, 'sizeSource' | 'readSizeClasses' | 'readSizeWeights'> => {
  const [sizeClass] = anchor.readSizeClasses ?? [];
  const index = TEF_SIZE_CLASSES.findIndex((candidate) => candidate === sizeClass);
  if (anchor.sizeSource !== 'employee_count' || index < 1) {
    return { sizeSource: 'none', readSizeClasses: TEF_EVERY_SIZE.map((share) => share.sizeClass), readSizeWeights: TEF_EVERY_SIZE.map((share) => share.weight) };
  }
  return { sizeSource: 'employee_count', readSizeClasses: TEF_SIZE_CLASSES.slice(index - 1, index), readSizeWeights: [1] };
};

/**
 * The estimate each history run of an automatic scenario drew, written just before that run so it
 * reads as automatic. The size class the anchor estimate read was lower until the newest history
 * run, which falls two to six days back on any weekday, so the default comparison of the last week
 * lists the move.
 */
const buildTefEstimateHistory = (
  anchorEstimate: typeof tefEstimates.$inferSelect,
  historyRows: ReadonlyArray<typeof crqIndicatorRuns.$inferInsert>,
): Array<typeof tefEstimates.$inferInsert> => {
  const movedAt = Math.max(...historyRows.map((run) => run.createdAt!.getTime()));
  const earlierSize = earlierSizeOf(anchorEstimate);
  return historyRows.map((run) => {
    const runAt = run.createdAt!.getTime();
    return {
      ...anchorEstimate,
      ...(runAt < movedAt ? earlierSize : {}),
      id: uuidv7(),
      min: run.tefMin!,
      likely: run.tefLikely!,
      max: run.tefMax!,
      createdAt: new Date(runAt - 5 * 60_000),
    };
  });
};

/**
 * The engine's price of every simulated scenario on the committed estate, each run read and dropped:
 * the history's anchor stands in for it, and the boot price pass writes the same figure again (the
 * engine is seeded by the scenario id). On the pool, never in the seed's transaction: the engine's
 * parallel reads need more than the one connection a transaction holds.
 */
export const readEngineReadings = async (db: DrizzleDB, services: PlatformSeedServices): Promise<Map<string, EngineReading>> => {
  const engine = services.withOrigin({ type: 'system' }).crqIndicators;
  const readings = new Map<string, EngineReading>();
  for (const scenarioId of SIMULATED_SCENARIO_IDS) {
    const outcome = await engine.runAttackRunEngine(scenarioId, Tenant_Acme, undefined, PRICE_RUN_PROFILE);
    if (outcome === null || 'skipped' in outcome) {
      continue;
    }
    await db.delete(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, outcome.runId));
    readings.set(scenarioId, {
      vulnerabilityMean: outcome.result.vulnerability.mean,
      outcomeEvicted: outcome.result.outcomes.evicted,
      outcomeImpactDetected: outcome.result.outcomes.impactDetected,
    });
  }
  return readings;
};

registerPlatformSeed('crq-simulations', async ({ db, services, now, engineReadings }) => {
  const shape = magnitudeShape();
  for (const [specIndex, spec] of SCENARIO_SIM_SPECS.entries()) {
    const built = await buildAnchorRun({ db, services }, spec, specIndex, engineReadings?.get(spec.scenarioId) ?? null);
    if (built === null) {
      continue;
    }
    const { run: anchor, gapSpans } = built;
    const { rows: historyRows, gapRows } = buildHistoryRows(spec, specIndex, anchor, gapSpans, now);
    await db.insert(crqIndicatorRuns).values(historyRows);
    if (gapRows.length > 0) {
      await db.insert(crqIndicatorRunReachGaps).values(gapRows);
    }
    const [anchorEstimate] = await db.select().from(tefEstimates)
      .where(eq(tefEstimates.riskScenarioId, spec.scenarioId))
      .orderBy(desc(tefEstimates.createdAt), desc(tefEstimates.id))
      .limit(1);
    // The manual scenario's anchor drew its typed triplet, not the estimate.
    if (anchorEstimate !== undefined && anchorEstimate.likely === anchor.tefLikely) {
      await db.insert(tefEstimates).values(buildTefEstimateHistory(anchorEstimate, historyRows));
    }
    const annualLossRows = [anchor, ...historyRows]
      .map((run) => buildAnnualLossRow(run, shape))
      .filter((row) => row !== null);
    if (annualLossRows.length > 0) {
      await db.insert(crqIndicatorRunAnnualLosses).values(annualLossRows);
    }
  }
}, 'history');
