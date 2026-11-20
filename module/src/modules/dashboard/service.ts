import type { InferRepository } from '../../registry';
import type { TargetingProfile } from '../threat-analyses';
import type { AssetsOverview, FindingsOverview } from './aggregation';
import type { RemediationPace } from './remediation-pace';
import { defineService } from '../../registry';
import { aggregateTopControlMoves, aggregateTopControls } from '../crq-indicators/control-aggregation';
import { familyRunOwnership } from '../crq-indicators/run-profile';
import { threatAnalysesService } from '../threat-analyses';
import {
  buildDailyTrendSeries,
  buildExposureFlowAggregate,
  buildRiskScopeFigures,
  computeLikelihoodChange,
  computeScenarioTrend,
  foldAssetDistribution,
  toUtcDayKey,
  TREND_WINDOW_DAYS,
  trendWindowStart,
} from './aggregation';
import { buildBandAxis, buildExposureBandSeries } from './exposure-band';
import { buildRemediationPace, remediationPaceHorizon } from './remediation-pace';
import { dashboardRepository } from './repository';
import { assembleRiskTreatmentCards, buildRiskTreatmentPoints, buildScenarioRunSeries, countToleranceByScope, rankToleranceGaps } from './risk-treatment';
import { aggregateTechniqueGains, rankScopeThreats } from './threat-aggregation';

const TOP_CONTROLS_LIMIT = 5;
const TOP_FINDINGS_LIMIT = 5;
const TOP_CVES_LIMIT = 5;
const TOP_ASSETS_LIMIT = 5;
const MOST_ACTIVE_THREATS_LIMIT = 6;
const DAY_MS = 86_400_000;

type Repo = InferRepository<typeof dashboardRepository>;

const toLossExceedanceDistribution = (row: Awaited<ReturnType<Repo['findAnnualLossesByRunIds']>>[number]) => ({
  mean: row.mean,
  lossYearShare: row.lossYearShare,
  quantiles: row.probabilities.map((probability, index) => ({ probability, loss: row.losses[index] })),
});

type FamilyRuns = Awaited<ReturnType<Repo['findInScopeFamilyRuns']>>;

/** Each control's lever rows, from the latest run of its scenario that computed them. */
const leverRowsOf = async (repo: Repo, runs: FamilyRuns) => {
  const { owns, runIds } = familyRunOwnership(runs, 'levers');
  const rows = await repo.findWhatIfResultsByRunIds([...runIds]);
  return rows.filter((row) => owns(row.runId, row.controlId));
};

/** Each scenario with the tolerances applying to it, and the annual loss distribution of its latest run. */
const toleranceInputsOf = async (repo: Repo, organizationId?: string) => {
  const [scenarios, tolerances, latestRuns] = await Promise.all([
    repo.findScenariosWithRelations(organizationId),
    repo.findScenarioRiskTolerances(organizationId),
    repo.findInScopeLatestRuns(organizationId),
  ]);
  const annualLosses = await repo.findAnnualLossesByRunIds(latestRuns.map((run) => run.runId));
  const scenarioIdByRunId = new Map(latestRuns.map((run) => [run.runId, run.riskScenarioId]));
  const annualLossByScenario = new Map(annualLosses.flatMap((row) => {
    const scenarioId = scenarioIdByRunId.get(row.runId);
    return scenarioId === undefined ? [] : [[scenarioId, toLossExceedanceDistribution(row)] as const];
  }));
  const tolerancesByScenario = new Map(tolerances.map((row) => [row.riskScenarioId, row]));
  return {
    annualLossByScenario,
    scenarios: scenarios.map((scenario) => ({
      ...scenario,
      scopeTolerance: tolerancesByScenario.get(scenario.id)?.scope ?? null,
      ownTolerance: tolerancesByScenario.get(scenario.id)?.own ?? null,
    })),
  };
};

/** Each scenario's technique values, from its latest run that computed them. */
const techniqueRowsOf = async (repo: Repo, runs: FamilyRuns) => {
  const { owns, runIds } = familyRunOwnership(runs, 'techniques');
  const rows = await repo.findTechniqueValuesByRunIds([...runIds]);
  return rows.filter((row) => owns(row.runId, row.mitreTechniqueId));
};

export const dashboardService = defineService(
  'dashboard',
  dashboardRepository,
).dependsOn(() => [threatAnalysesService]).implement({
  getScenarioSummaries: async ({ repo }, organizationId?: string, windowDays: number = TREND_WINDOW_DAYS) => {
    const now = new Date();
    const windowStart = trendWindowStart(now, windowDays);
    const [scenarios, latestRuns, baselineRuns, windowRuns] = await Promise.all([
      repo.findScenariosWithRelations(organizationId),
      repo.findLatestRunsPerScenario(organizationId),
      repo.findLatestRunPerScenarioBefore(windowStart, organizationId),
      repo.findRunsSince(windowStart, organizationId),
    ]);

    const latestByScenario = new Map(latestRuns.map((run) => [run.riskScenarioId, run]));
    const baselineByScenario = new Map(baselineRuns.map((run) => [run.riskScenarioId, run]));
    const firstInWindowByScenario = new Map<string, typeof windowRuns[number]>();
    for (const run of windowRuns) {
      if (!firstInWindowByScenario.has(run.riskScenarioId)) {
        firstInWindowByScenario.set(run.riskScenarioId, run);
      }
    }

    return scenarios.map((scenario) => {
      const latestRun = latestByScenario.get(scenario.id);
      const preWindowBaseline = baselineByScenario.get(scenario.id);
      const baseline = preWindowBaseline ?? firstInWindowByScenario.get(scenario.id);
      return {
        id: scenario.id,
        name: scenario.name,
        organizationId: scenario.organizationId,
        organizationName: scenario.organizationName,
        attackOutcomeName: scenario.attackOutcomeName,
        noMappedAsset: scenario.noMappedAsset,
        latestRun: latestRun
          ? {
            runId: latestRun.runId,
            createdAt: latestRun.createdAt,
            aleMean: latestRun.aleMean,
            aleP10: latestRun.aleP10,
            aleP90: latestRun.aleP90,
            lefMean: latestRun.lefMean,
          }
          : null,
        trend: computeScenarioTrend(latestRun, baseline),
        likelihoodChange: computeLikelihoodChange(latestRun, preWindowBaseline),
      };
    });
  },

  getExposureTrend: async ({ repo }, organizationId?: string, windowDays: number = TREND_WINDOW_DAYS) => {
    const now = new Date();
    const windowStart = trendWindowStart(now, windowDays);
    const [seedRuns, windowRuns] = await Promise.all([
      repo.findLatestRunPerScenarioBefore(windowStart, organizationId),
      repo.findRunsSince(windowStart, organizationId),
    ]);
    return buildDailyTrendSeries(seedRuns, windowRuns, windowStart, now);
  },

  getRiskScopeFigures: async ({ repo }, windowDays: number) => {
    const now = new Date();
    const windowStart = trendWindowStart(now, windowDays);
    const [scopes, seedRuns, windowRuns] = await Promise.all([
      repo.findRiskScopes(),
      repo.findLatestRunPerScenarioBefore(windowStart),
      repo.findRunsSince(windowStart),
    ]);
    return buildRiskScopeFigures(scopes, seedRuns, windowRuns, windowStart, now);
  },

  /**
   * The whole exposure Sankey in six batched selects, replacing the client-side fan-out that
   * issued two queries per scenario for the same rows.
   */
  getExposureFlow: async ({ repo }, organizationId?: string) => {
    const [scenarios, latestRuns, techniqueRuns] = await Promise.all([
      repo.findScenariosWithRelations(organizationId),
      repo.findLatestRunsPerScenario(organizationId),
      repo.findFamilyRuns('techniques', organizationId),
    ]);
    const runIds = latestRuns.map((run) => run.runId);
    const scenarioIds = scenarios.map((scenario) => scenario.id);
    const [groupRows, techniqueRows, estimateRows, primaryAssetRows] = await Promise.all([
      repo.findGroupScoresByRunIds(runIds),
      techniqueRowsOf(repo, techniqueRuns),
      repo.findLossEstimatesByScenarioIds(scenarioIds),
      repo.findPrimaryAssetsByScenarioIds(scenarioIds),
    ]);
    return buildExposureFlowAggregate(scenarios, latestRuns, groupRows, techniqueRows, estimateRows, primaryAssetRows);
  },

  /**
   * The timeline's series over the window the caller asks for, `windowDays` null meaning the whole
   * history: one point per sampled day of the axis, however many runs the window holds.
   */
  getExposureBand: async (
    { repo },
    { organizationId, windowDays }: { organizationId?: string, windowDays: number | null },
  ) => {
    const now = Date.now();
    const earliest = await repo.findEarliestRunAt(organizationId);
    const dayKeys = buildBandAxis({ windowDays, now, earliestRunTime: earliest?.getTime() ?? null });
    if (dayKeys.length === 0) {
      return [];
    }
    const since = windowDays === null || earliest === null
      ? null
      : new Date(Math.max(now - windowDays * DAY_MS, earliest.getTime()));
    const seedRead = since === null ? Promise.resolve([]) : repo.findRunSampleBefore(since, organizationId);
    const [seeds, buckets] = await Promise.all([seedRead, repo.findRunBandBuckets(dayKeys, since, organizationId)]);
    return buildExposureBandSeries(dayKeys, seeds, buckets);
  },

  /** The latest run of each scenario, the one the headline figures are read on: the series of a card is `getRiskTreatmentSeries`. */
  getRiskTreatment: async (
    { repo },
    { organizationId, riskScenarioId }: { organizationId?: string, riskScenarioId?: string },
  ) => {
    const [scenarios, tolerances, latestRuns, leverRuns] = await Promise.all([
      repo.findScenariosWithRelations(organizationId, riskScenarioId),
      repo.findScenarioRiskTolerances(organizationId, riskScenarioId),
      repo.findInScopeLatestRuns(organizationId, riskScenarioId),
      repo.findInScopeFamilyRuns('levers', organizationId, riskScenarioId),
    ]);
    const whatIfRows = await leverRowsOf(repo, leverRuns);
    const tolerancesByScenario = new Map(tolerances.map((row) => [row.riskScenarioId, row]));
    return assembleRiskTreatmentCards(
      scenarios.map((scenario) => ({
        ...scenario,
        scopeTolerance: tolerancesByScenario.get(scenario.id)?.scope ?? null,
        ownTolerance: tolerancesByScenario.get(scenario.id)?.own ?? null,
      })),
      latestRuns,
      whatIfRows,
      TOP_CONTROLS_LIMIT,
    );
  },

  /**
   * One scenario's annual loss distribution on its latest run, and its day-by-day readings over the
   * window. A run of the window is read against the tolerance applied today, and its distribution is
   * only read when there is one.
   */
  getRiskTreatmentSeries: async (
    { repo },
    { riskScenarioId, windowDays }: { riskScenarioId: string, windowDays: number },
  ) => {
    const windowStart = trendWindowStart(new Date(), windowDays);
    const [tolerances, seedRuns, windowRuns, latestRuns] = await Promise.all([
      repo.findScenarioRiskTolerances(undefined, riskScenarioId),
      repo.findScenarioRunBefore(windowStart, undefined, riskScenarioId),
      repo.findScenarioDailyRunsSince(windowStart, undefined, riskScenarioId),
      repo.findInScopeLatestRuns(undefined, riskScenarioId),
    ]);
    const series = buildScenarioRunSeries(seedRuns, windowRuns, windowStart).get(riskScenarioId) ?? [];
    const tolerance = tolerances.at(0);
    const applied = tolerance?.own ?? tolerance?.scope ?? null;
    const latestRunId = latestRuns.at(0)?.runId;
    const annualLosses = await repo.findAnnualLossesByRunIds([
      ...(applied === null ? [] : series.map((run) => run.runId)),
      ...(latestRunId === undefined ? [] : [latestRunId]),
    ]);
    const distributions = new Map(annualLosses.map((row) => [row.runId, toLossExceedanceDistribution(row)]));
    return {
      windowStart: toUtcDayKey(windowStart),
      annualLoss: (latestRunId === undefined ? undefined : distributions.get(latestRunId)) ?? null,
      series: buildRiskTreatmentPoints(series, applied, distributions),
    };
  },

  /**
   * Each scenario's ALE, the last of each day over the window, with the last run before it opening
   * the series: what the scope's curve is summed from.
   */
  getScenarioAleSeries: async ({ repo }, { organizationId, windowDays }: { organizationId?: string, windowDays: number }) => {
    const windowStart = trendWindowStart(new Date(), windowDays);
    const [seedRuns, windowRuns] = await Promise.all([
      repo.findRunSampleBefore(windowStart, organizationId),
      repo.findScenarioDailyAleSince(windowStart, organizationId),
    ]);
    return [...buildScenarioRunSeries(seedRuns, windowRuns, windowStart)].map(([scenarioId, series]) => ({
      scenarioId,
      series: series.map(({ date, aleMean }) => ({ date, aleMean })),
    }));
  },

  /** Read on the latest run of each scenario, the one its risk treatment card draws, so the two never disagree on its status. */
  getToleranceGaps: async ({ repo }, organizationId?: string) => {
    const { scenarios, annualLossByScenario } = await toleranceInputsOf(repo, organizationId);
    return rankToleranceGaps(scenarios, annualLossByScenario);
  },

  /** The scenarios under a tolerance and the ones outside it, per risk scope, on the same reads `getToleranceGaps` ranks. */
  getToleranceCounts: async ({ repo }, organizationId?: string) => {
    const { scenarios, annualLossByScenario } = await toleranceInputsOf(repo, organizationId);
    return countToleranceByScope(scenarios, annualLossByScenario);
  },

  getTopControls: async ({ repo }, organizationId?: string) => {
    const whatIfRows = await leverRowsOf(repo, await repo.findInScopeFamilyRuns('levers', organizationId));
    return aggregateTopControls(whatIfRows).slice(0, TOP_CONTROLS_LIMIT);
  },

  getTopControlMoves: async ({ repo }, organizationId?: string) => {
    const whatIfRows = await leverRowsOf(repo, await repo.findInScopeFamilyRuns('levers', organizationId));
    return aggregateTopControlMoves(whatIfRows).slice(0, TOP_CONTROLS_LIMIT);
  },

  /** Scenarios sharing a targeting profile and an attack outcome admit the same threats, so each pair is admitted once. */
  getMostActiveThreats: async ({ repo, deps }, organizationId?: string) => {
    const scenarios = await repo.findScenarioTargets(organizationId);
    const profiles: Array<TargetingProfile> = [];
    const profileIndexByKey = new Map<string, number>();
    const profileIndexOf = (scenario: typeof scenarios[number]): number => {
      const key = `${scenario.countryId}:${scenario.sectorId}`;
      const known = profileIndexByKey.get(key);
      if (known !== undefined) {
        return known;
      }
      const index = profiles.push({
        countryIds: scenario.countryId ? [scenario.countryId] : [],
        sectorIds: scenario.sectorId ? [scenario.sectorId] : [],
      }) - 1;
      profileIndexByKey.set(key, index);
      return index;
    };
    const profileIndexByScenarioId = new Map(scenarios.map((scenario) => [scenario.scenarioId, profileIndexOf(scenario)]));

    const admittedByProfile = await deps.threatAnalyses.getAdmittedThreatsByProfile({
      attackOutcomeIds: [...new Set(scenarios.map((scenario) => scenario.attackOutcomeId))],
      profiles,
    });
    return rankScopeThreats(scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      threats: admittedByProfile[profileIndexByScenarioId.get(scenario.scenarioId)!].get(scenario.attackOutcomeId) ?? [],
    })), MOST_ACTIVE_THREATS_LIMIT);
  },

  getTechniqueGains: async ({ repo }, organizationId?: string) => {
    const valueRows = await techniqueRowsOf(repo, await repo.findInScopeFamilyRuns('techniques', organizationId));
    const [tacticLinks, tactics] = await Promise.all([
      repo.findTacticsOfTechniques([...new Set(valueRows.map((row) => row.mitreTechniqueId))]),
      repo.findMitreTactics(),
    ]);
    return aggregateTechniqueGains(valueRows, tacticLinks, tactics);
  },

  getTechniqueFindingCounts: async ({ repo }, organizationId?: string) => repo.findTechniqueFindingCounts(organizationId),

  getFindingsOverview: async ({ repo }, organizationId?: string): Promise<FindingsOverview> => {
    const summary = await repo.findFindingsOverview({
      organizationId,
      topFindingsLimit: TOP_FINDINGS_LIMIT,
      topCvesLimit: TOP_CVES_LIMIT,
    });
    return {
      summary: {
        activeCount: summary.activeCount,
        criticalCount: summary.criticalCount,
        highCount: summary.highCount,
        kevCount: summary.kevCount,
        impactedAssetCount: summary.impactedAssetCount,
        severityDistribution: {
          critical: summary.criticalCount,
          high: summary.highCount,
          medium: summary.mediumCount,
          low: summary.lowCount,
          none: summary.noneCount,
          unscored: summary.unscoredCount,
        },
      },
      topFindings: summary.topFindings,
      topCves: summary.topCves,
    };
  },

  getRemediationPace: async (
    { repo },
    { organizationId, windowDays }: { organizationId?: string, windowDays: number },
  ): Promise<RemediationPace> => {
    const now = new Date();
    const windowStart = trendWindowStart(now, windowDays);
    const horizon = remediationPaceHorizon(now);
    const since = windowStart < horizon ? windowStart : horizon;
    const [creations, transitions, timeOpen] = await Promise.all([
      repo.findFindingCreationsByDay(since, organizationId),
      repo.findFindingTransitionsByDay(since, organizationId),
      repo.findTimeOpenOfClosuresSince(windowStart, organizationId),
    ]);
    return buildRemediationPace({ creations, transitions, timeOpen, now, windowStart, windowDays });
  },

  getAssetsOverview: async ({ repo }, organizationId?: string): Promise<AssetsOverview> => {
    const { topAssets, distributionCells } = await repo.findAssetsOverview({ organizationId, topLimit: TOP_ASSETS_LIMIT });
    return { topAssets, ...foldAssetDistribution(distributionCells) };
  },
});
