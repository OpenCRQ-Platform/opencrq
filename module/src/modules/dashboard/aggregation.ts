import type { AssetCategory, AssetCriticality, SupportingAssetExposure } from '../supporting-assets/schema';
import type { ActorClass } from '../threat-analyses/actor-classes';
import type { ThreatEntityType } from '../threat-analyses/entity-types';

export const TREND_WINDOW_DAYS = 90;

/** Start of the trend window: midnight UTC, `windowDays` days back inclusive of today. */
export const trendWindowStart = (now: Date, windowDays: number = TREND_WINDOW_DAYS): Date => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));
  return start;
};

export interface DashboardRunSample {
  runId: string,
  riskScenarioId: string,
  createdAt: Date,
  aleMean: number | null,
  lefMean: number | null,
}

export interface DashboardTrendPoint {
  date: string,
  ale: number | null,
  lef: number | null,
  /** Probability of at least one loss event in the year. */
  likelihood: number | null,
  /** Mean loss per event. */
  magnitude: number | null,
}

export interface ScenarioTrend {
  baselineAleMean: number,
  currentAleMean: number,
  delta: number,
  deltaPct: number | null,
}

export const toUtcDayKey = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Loss events are Poisson, so the summed LEF is the rate of the scope's merged event stream and
 * `1 - e^-LEF` the chance that stream fires at least once in the year.
 */
export const deriveLikelihood = (lef: number | null): number | null => (lef === null ? null : 1 - Math.exp(-lef));

export const deriveMagnitude = (ale: number | null, lef: number | null): number | null =>
  (ale === null || lef === null || lef <= 0 ? null : ale / lef);

interface MetricCarry {
  ale: number | null,
  lef: number | null,
}

/**
 * Buckets runs per UTC day, carries the last known value of each metric forward
 * per scenario (a null metric on a newer run keeps the previous value), then sums
 * across scenarios. Points start on the first day any scenario has a value.
 */
export const buildDailyTrendSeries = (
  seedRuns: Array<DashboardRunSample>,
  windowRuns: Array<DashboardRunSample>,
  windowStart: Date,
  now: Date,
): Array<DashboardTrendPoint> => {
  const carries = new Map<string, MetricCarry>();
  const applyRun = (run: DashboardRunSample) => {
    const carry = carries.get(run.riskScenarioId) ?? { ale: null, lef: null };
    carries.set(run.riskScenarioId, {
      ale: run.aleMean ?? carry.ale,
      lef: run.lefMean ?? carry.lef,
    });
  };
  seedRuns.forEach(applyRun);

  const runsByDay = new Map<string, Array<DashboardRunSample>>();
  for (const run of [...windowRuns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const dayKey = toUtcDayKey(run.createdAt);
    const list = runsByDay.get(dayKey) ?? [];
    list.push(run);
    runsByDay.set(dayKey, list);
  }

  const points: Array<DashboardTrendPoint> = [];
  const day = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth(), windowStart.getUTCDate()));
  const lastDayKey = toUtcDayKey(now);
  while (toUtcDayKey(day) <= lastDayKey) {
    const dayKey = toUtcDayKey(day);
    (runsByDay.get(dayKey) ?? []).forEach(applyRun);

    let ale: number | null = null;
    let lef: number | null = null;
    for (const carry of carries.values()) {
      if (carry.ale !== null) {
        ale = (ale ?? 0) + carry.ale;
      }
      if (carry.lef !== null) {
        lef = (lef ?? 0) + carry.lef;
      }
    }

    if (points.length > 0 || ale !== null || lef !== null) {
      points.push({ date: dayKey, ale, lef, likelihood: deriveLikelihood(lef), magnitude: deriveMagnitude(ale, lef) });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return points;
};

export const computeScenarioTrend = (
  current: { runId: string, aleMean: number | null } | undefined,
  baseline: { runId: string, aleMean: number | null } | undefined,
): ScenarioTrend | null => {
  if (!current || !baseline || current.runId === baseline.runId) {
    return null;
  }
  if (current.aleMean === null || baseline.aleMean === null) {
    return null;
  }
  const delta = current.aleMean - baseline.aleMean;
  return {
    baselineAleMean: baseline.aleMean,
    currentAleMean: current.aleMean,
    delta,
    deltaPct: baseline.aleMean === 0 ? null : delta / baseline.aleMean,
  };
};

interface LikelihoodRun {
  runId: string,
  lefMean: number | null,
}

/**
 * Change of `1 - e^-LEF` since `baseline`, which must be the last run before the window: a scenario
 * first simulated inside it has no earlier likelihood to have moved from. It does not need ALE, since
 * an unpriced run still carries its LEF.
 */
export const computeLikelihoodChange = (
  current: LikelihoodRun | undefined,
  baseline: LikelihoodRun | undefined,
): number | null => {
  if (!current || !baseline || current.runId === baseline.runId) {
    return null;
  }
  const currentLikelihood = deriveLikelihood(current.lefMean);
  const baselineLikelihood = deriveLikelihood(baseline.lefMean);
  return currentLikelihood === null || baselineLikelihood === null ? null : currentLikelihood - baselineLikelihood;
};

export interface FindingsSeverityDistribution {
  critical: number,
  high: number,
  medium: number,
  low: number,
  none: number,
  unscored: number,
}

export interface DashboardTopFinding {
  evidenceId: string,
  supportingAssetId: string,
  assetName: string | null,
  assetDerivedName: string | null,
  cveId: string,
  cvss: number | null,
  epss: number | null,
  kev: boolean | null,
}

export interface DashboardTopCve {
  cveId: string,
  cvss: number | null,
  epss: number | null,
  kev: boolean,
  impactedAssetCount: number,
}

export interface FindingsOverview {
  summary: {
    activeCount: number,
    criticalCount: number,
    highCount: number,
    kevCount: number,
    impactedAssetCount: number,
    severityDistribution: FindingsSeverityDistribution,
  },
  topFindings: Array<DashboardTopFinding>,
  topCves: Array<DashboardTopCve>,
}

/** Assets in scope counted once per (category, exposure) pair, the grid both margins are read from. */
export interface AssetDistributionCell {
  categoryId: AssetCategory,
  exposure: SupportingAssetExposure,
  assetCount: number,
  impactedAssetCount: number,
}

export interface AssetsOverview {
  topAssets: Array<{
    id: string,
    name: string | null,
    derivedName: string | null,
    criticality: AssetCriticality,
    score: number,
    applicableCount: number,
    criticalOrHighCount: number,
  }>,
  byCategory: Array<{ categoryId: AssetCategory, assetCount: number, impactedAssetCount: number }>,
  byExposure: Array<{ exposure: SupportingAssetExposure, assetCount: number, impactedAssetCount: number }>,
}

/** Each margin comes out ordered by asset count, ties broken on the key so the order is stable. */
export const foldAssetDistribution = (
  cells: Array<AssetDistributionCell>,
): Pick<AssetsOverview, 'byCategory' | 'byExposure'> => {
  const fold = <TKey extends string>(keyOf: (cell: AssetDistributionCell) => TKey) => {
    const byKey = new Map<TKey, { assetCount: number, impactedAssetCount: number }>();
    for (const cell of cells) {
      const key = keyOf(cell);
      const acc = byKey.get(key) ?? { assetCount: 0, impactedAssetCount: 0 };
      acc.assetCount += cell.assetCount;
      acc.impactedAssetCount += cell.impactedAssetCount;
      byKey.set(key, acc);
    }
    return [...byKey.entries()]
      .sort((a, b) => b[1].assetCount - a[1].assetCount || a[0].localeCompare(b[0]))
      .map(([key, counts]) => ({ key, ...counts }));
  };

  return {
    byCategory: fold((cell) => cell.categoryId).map(({ key, ...counts }) => ({ categoryId: key, ...counts })),
    byExposure: fold((cell) => cell.exposure).map(({ key, ...counts }) => ({ exposure: key, ...counts })),
  };
};

// ─── Exposure flow ────────────────────────────────────────────────────────────

export interface ExposureFlowScenarioRow {
  id: string,
  name: string,
  organizationId: string,
  attackOutcomeId: string,
  attackOutcomeName: string,
  noMappedAsset: boolean,
}

export interface ExposureFlowRunRow {
  runId: string,
  riskScenarioId: string,
  aleMean: number | null,
  aleP10: number | null,
  aleP90: number | null,
  lefMean: number | null,
}

export interface ExposureFlowPrimaryAssetRow {
  riskScenarioId: string,
  primaryAssetId: string,
  primaryAssetName: string,
}

export interface ExposureFlowGroupRow {
  runId: string,
  groupKey: string | null,
  groupName: string | null,
  groupEntityType: ThreatEntityType | null,
  actorClass: ActorClass | null,
  share: number,
  vulnerabilityMean: number,
}

export interface ExposureFlowTechniqueRow {
  /** The values come from the scenario's latest run that computed them, not always its latest run. */
  riskScenarioId: string,
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  /** What interdicting the technique is worth, per lever; null on a run that carries no price. */
  preventValue: number | null,
  detectValue: number | null,
}

export interface ExposureFlowEstimateRow {
  riskScenarioId: string,
  lossDriverId: string,
  lossDriverName: string,
  lossCategoryId: string,
  lossCategoryName: string,
  minValue: number | null,
  likelyValue: number | null,
  maxValue: number | null,
}

export interface ExposureFlowScenario {
  scenarioId: string,
  name: string,
  organizationId: string,
  outcomeId: string,
  outcomeName: string,
  ale: number,
  aleP10: number | null,
  aleP90: number | null,
  lefMean: number | null,
  primaryAssets: Array<{ id: string, name: string }>,
  /**
   * `actorClass` is set on a row standing for an actor class rather than one threat analysis, whose
   * key is then local to its run: the row is identified by its class, never by its key.
   */
  groups: Array<{
    key: string | null,
    name: string | null,
    entityType: ThreatEntityType | null,
    actorClass: ActorClass | null,
    share: number,
    vulnerabilityMean: number,
  }>,
  /** The techniques the run priced, each with its signed euro value to the attacker. */
  techniques: Array<{ techniqueId: string, externalId: string, name: string, value: number }>,
  driverExpectations: Array<{
    driverId: string,
    name: string,
    lossCategoryId: string,
    lossCategoryName: string,
    minValue: number,
    likelyValue: number,
    maxValue: number,
  }>,
}

export interface ExposureFlowScenarioRef {
  id: string,
  name: string,
  organizationId: string,
}

export interface ExposureFlowAggregate {
  scenarios: Array<ExposureFlowScenario>,
  /** Never simulated: no run at all, so nothing can be priced. */
  unsimulatedScenarios: Array<ExposureFlowScenarioRef>,
  /**
   * Simulated but carrying no annual loss figure. A run reaches an ALE of exactly 0 when it has
   * no loss estimate or no TEF, so zero is reported as no figure rather than as a priced zero.
   */
  unpricedScenarios: Array<ExposureFlowScenarioRef>,
  /**
   * A closed scope mapping no asset, whether or not a run is on file: no run can price it until
   * assets are mapped, so neither a simulation nor a loss estimate is the remedy.
   */
  unmappedScenarios: Array<ExposureFlowScenarioRef>,
  /**
   * No percentile of the total: summing per-scenario p10s and p90s assumes every scenario has its
   * extreme year at once, which is a stress bound and not a portfolio figure.
   */
  totals: { aleMean: number | null },
}

const groupBy = <T, K>(rows: Array<T>, key: (row: T) => K): Map<K, Array<T>> => {
  const out = new Map<K, Array<T>>();
  for (const row of rows) {
    const bucket = out.get(key(row));
    if (bucket === undefined) {
      out.set(key(row), [row]);
    } else {
      bucket.push(row);
    }
  }
  return out;
};

/**
 * Everything the exposure-flow Sankey needs, assembled from six batched selects.
 *
 * This is the aggregate the dashboard used to build client-side by issuing one `getRunWithScores`
 * and one `getScenarioLossEstimates` per scenario. The shape it produces (per-scenario ALE with
 * its actor, technique and loss-driver decompositions) is a server-side join, and doing it here
 * means the row count is bounded by the scope rather than by a round trip per scenario.
 *
 * A partly-filled loss estimate is dropped, not defaulted: the engine treats a missing bound as
 * no estimate at all, so a half-filled driver must not claim a share of the split either.
 */
export const buildExposureFlowAggregate = (
  scenarios: Array<ExposureFlowScenarioRow>,
  latestRuns: Array<ExposureFlowRunRow>,
  groupRows: Array<ExposureFlowGroupRow>,
  techniqueRows: Array<ExposureFlowTechniqueRow>,
  estimateRows: Array<ExposureFlowEstimateRow>,
  primaryAssetRows: Array<ExposureFlowPrimaryAssetRow>,
): ExposureFlowAggregate => {
  const runByScenario = new Map(latestRuns.map((run) => [run.riskScenarioId, run]));
  const primaryAssetsByScenario = groupBy(primaryAssetRows, (row) => row.riskScenarioId);
  const groupsByRun = groupBy(groupRows, (row) => row.runId);
  const techniquesByScenario = groupBy(techniqueRows, (row) => row.riskScenarioId);
  const estimatesByScenario = groupBy(estimateRows, (row) => row.riskScenarioId);

  const out: Array<ExposureFlowScenario> = [];
  const unsimulatedScenarios: Array<ExposureFlowScenarioRef> = [];
  const unpricedScenarios: Array<ExposureFlowScenarioRef> = [];
  const unmappedScenarios: Array<ExposureFlowScenarioRef> = [];
  let aleMean: number | null = null;

  for (const scenario of scenarios) {
    const ref = { id: scenario.id, name: scenario.name, organizationId: scenario.organizationId };
    if (scenario.noMappedAsset) {
      unmappedScenarios.push(ref);
      continue;
    }
    const run = runByScenario.get(scenario.id);
    if (run === undefined) {
      unsimulatedScenarios.push(ref);
      continue;
    }
    if (run.aleMean === null || run.aleMean <= 0) {
      unpricedScenarios.push(ref);
      continue;
    }

    aleMean = (aleMean ?? 0) + run.aleMean;

    out.push({
      scenarioId: scenario.id,
      name: scenario.name,
      organizationId: scenario.organizationId,
      outcomeId: scenario.attackOutcomeId,
      outcomeName: scenario.attackOutcomeName,
      ale: run.aleMean,
      aleP10: run.aleP10,
      aleP90: run.aleP90,
      lefMean: run.lefMean,
      primaryAssets: (primaryAssetsByScenario.get(scenario.id) ?? []).map((row) => ({ id: row.primaryAssetId, name: row.primaryAssetName })),
      groups: (groupsByRun.get(run.runId) ?? []).map((row) => ({
        key: row.groupKey,
        name: row.groupName,
        entityType: row.groupEntityType,
        actorClass: row.groupKey !== null && row.groupName === null && row.groupEntityType === null ? row.actorClass : null,
        share: row.share,
        vulnerabilityMean: row.vulnerabilityMean,
      })),
      techniques: (techniquesByScenario.get(scenario.id) ?? []).flatMap((row) => (row.preventValue === null || row.detectValue === null
        ? []
        : [{
          techniqueId: row.mitreTechniqueId,
          externalId: row.externalId,
          name: row.name,
          value: row.preventValue + row.detectValue,
        }])),
      driverExpectations: (estimatesByScenario.get(scenario.id) ?? []).flatMap((row) => {
        if (row.minValue === null || row.likelyValue === null || row.maxValue === null) {
          return [];
        }
        return [{
          driverId: row.lossDriverId,
          name: row.lossDriverName,
          lossCategoryId: row.lossCategoryId,
          lossCategoryName: row.lossCategoryName,
          minValue: row.minValue,
          likelyValue: row.likelyValue,
          maxValue: row.maxValue,
        }];
      }),
    });
  }

  return { scenarios: out, unsimulatedScenarios, unpricedScenarios, unmappedScenarios, totals: { aleMean } };
};

// ─── Risk scope ranking ───────────────────────────────────────────────────────

export interface RiskScopeRunSample extends DashboardRunSample {
  organizationId: string,
}

export interface RiskScopeFigures {
  organizationId: string,
  name: string,
  /** The scenarios whose runs the figures add up. */
  scenarioCount: number,
  ale: number | null,
  lef: number | null,
  likelihood: number | null,
  magnitude: number | null,
  /** Today's ALE against the first day of the window that has one, null until two days carry one. */
  aleChange: number | null,
  /** The first day of the window that carries an ALE, so a sum of scopes reads its change as one series. */
  aleBaseline: { date: string, ale: number } | null,
  /** The UTC day the window opens on, which a run from before it is carried in on. */
  windowStart: string,
}

/**
 * An unpriced scope ranks last. Each row is the last day of `buildDailyTrendSeries` over that scope's
 * runs alone, so it reads exactly what the scope's own aggregate risk reads.
 */
export const buildRiskScopeFigures = (
  scopes: Array<{ id: string, name: string }>,
  seedRuns: Array<RiskScopeRunSample>,
  windowRuns: Array<RiskScopeRunSample>,
  windowStart: Date,
  now: Date,
): Array<RiskScopeFigures> => {
  const seedByScope = groupBy(seedRuns, (run) => run.organizationId);
  const windowByScope = groupBy(windowRuns, (run) => run.organizationId);
  return scopes
    .flatMap((scope): Array<RiskScopeFigures> => {
      const seed = seedByScope.get(scope.id) ?? [];
      const inWindow = windowByScope.get(scope.id) ?? [];
      const series = buildDailyTrendSeries(seed, inWindow, windowStart, now);
      const today = series.at(-1);
      if (today === undefined) {
        return [];
      }
      const measuredAle = series.flatMap((point) => (point.ale === null ? [] : [{ date: point.date, ale: point.ale }]));
      const scenarioIds = new Set([...seed, ...inWindow]
        .filter((run) => run.aleMean !== null || run.lefMean !== null)
        .map((run) => run.riskScenarioId));
      return [{
        organizationId: scope.id,
        name: scope.name,
        scenarioCount: scenarioIds.size,
        ale: today.ale,
        lef: today.lef,
        likelihood: today.likelihood,
        magnitude: today.magnitude,
        aleChange: measuredAle.length < 2 ? null : measuredAle[measuredAle.length - 1].ale - measuredAle[0].ale,
        aleBaseline: measuredAle[0] ?? null,
        windowStart: toUtcDayKey(windowStart),
      }];
    })
    .toSorted((a, b) =>
      (b.ale ?? Number.NEGATIVE_INFINITY) - (a.ale ?? Number.NEGATIVE_INFINITY) || a.name.localeCompare(b.name));
};
