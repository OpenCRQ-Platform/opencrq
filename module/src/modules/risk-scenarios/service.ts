import { diffSets } from '@app/utils';
import { compareText } from '@app/utils/text-fold';
import type { InferRepository } from '../../registry';
import type { DependencyGraph } from '../asset-dependencies/constants';
import type { SupportToPrimaryLinkRole } from '../asset-dependencies/link-roles';
import type { CriteriaReached } from '../attack-outcomes/data/attack-outcomes-data';
import type { RiskTolerance } from '../organizations/constants';
import type { AssetImpact, AttackShare, ImpactContribution } from './impact';
import type { ScenarioReadiness } from './readiness';
import type { ScenarioFindingsQuery, ScenarioPageQuery, ScenarioSupportingAssetSortKey } from './scenario-lists';
import type { TefMode } from './schema';
import type { CveExploitationAnswer, CveExploitationReachedAsset } from './cve-exploitation';
import type { EvidenceHealthReading, EvidenceHealthSource, EvidenceHealthState, SourceRunHealth } from './evidence-health';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { canonicalLinkRoles, inheritedCriteriaOfRoles } from '../asset-dependencies/link-roles';
import { MAX_REACH_DEPTH } from '../asset-dependencies/reach';
import { assetDependenciesService } from '../asset-dependencies/service';
import { attackOutcomesService, isActiveTechnique } from '../attack-outcomes';
import { readAttackClaims } from '../technique-mapping/attack-claims';
import { techniqueMappingService } from '../technique-mapping/service';
import { foldToParentTechnique } from '../threat-analyses/technique-weighting';
import { assembleCveExploitation, readExposureExploitation } from './cve-exploitation';
import { EVIDENCE_HEALTH_STATES, EVIDENCE_SYNC_KINDS, readEvidenceHealth, readSourceRunHealth } from './evidence-health';
import { computeLifelineChange, LIFELINE_WINDOW_DAYS } from './lifeline';
import { computeAssetImpacts, shareOfAttackTransmitted, wholePercent } from './impact';
import { placeFindingRows } from './finding-ways-in';
import { computeScenarioReadiness } from './readiness';
import { riskScenariosRepository } from './repository';
import { NO_SCENARIO_FINDING_SEVERITIES, NO_SCENARIO_FINDINGS } from './scenario-findings';

type Repo = InferRepository<typeof riskScenariosRepository>;

interface ReadinessFigures {
  lastRunAt: Date | null,
  tefInputUpdatedAt?: Date | null,
  tefEstimateCreatedAt?: Date | null,
  lossExpectedValue?: number | null,
  lossUpdatedAt?: Date | null,
}

/** The one place a scenario's figures become its readiness, so the overview and `getRiskScenariosReadiness` agree. */
const readinessOf = (scenario: { tefMode: TefMode, noMappedAsset: boolean }, figures: ReadinessFigures): ScenarioReadiness => {
  // An auto-mode scenario is read against its estimate: the manual triplet the detail page mirrors
  // for the switch back is rewritten on every visit, and would make an untouched scenario read as stale.
  const tefUpdatedAt = scenario.tefMode === 'auto' ? figures.tefEstimateCreatedAt : figures.tefInputUpdatedAt;
  return computeScenarioReadiness({
    noMappedAsset: scenario.noMappedAsset,
    lastRunAt: figures.lastRunAt,
    tefUpdatedAt: tefUpdatedAt ?? null,
    lossDriversUpdatedAt: figures.lossExpectedValue != null && figures.lossExpectedValue > 0 ? figures.lossUpdatedAt ?? null : null,
  });
};

interface RiskScenarioDependencyGraph extends DependencyGraph {
  primaryAssets: Array<{ id: string, name: string }>,
}

interface AssetNames {
  name: string | null,
  derivedName: string | null,
}

interface DerivedSupportingAsset {
  supportingAssetId: string,
  supportingAssetName: string | null,
  supportingAssetDerivedName: string | null,
  depth: number,
}

const DAY_MS = 86_400_000;

type SupportToPrimaryLinkRow = Awaited<ReturnType<Repo['findDirectSupportingAssetsForPrimaryAssets']>>[number];
type SupportToSupportLinkRow = Awaited<ReturnType<Repo['findSupportingAssetProviders']>>[number];

interface SupportingAssetWalk {
  /** Every supporting asset reached, once, at the first level that reaches it. */
  derived: Array<DerivedSupportingAsset>,
  supportToPrimaryLinks: Array<SupportToPrimaryLinkRow>,
  /** Every link whose dependent sits within `MAX_REACH_DEPTH - 1` hops, so every path of up to `MAX_REACH_DEPTH` hops is in it. */
  supportToSupportLinks: Array<SupportToSupportLinkRow>,
}

const walkSupportingAssetGraph = async (
  repo: Repo,
  primaryAssets: Array<{ id: string }>,
): Promise<SupportingAssetWalk> => {
  if (primaryAssets.length === 0) {
    return { derived: [], supportToPrimaryLinks: [], supportToSupportLinks: [] };
  }

  const stpLinks = await repo.findDirectSupportingAssetsForPrimaryAssets(primaryAssets.map((pa) => pa.id));
  const allStsLinks: Array<SupportToSupportLinkRow> = [];

  const results: Array<DerivedSupportingAsset> = [];
  const visitedIds = new Set<string>();

  for (const link of stpLinks) {
    if (!visitedIds.has(link.supportingAssetId)) {
      visitedIds.add(link.supportingAssetId);
      results.push({
        supportingAssetId: link.supportingAssetId,
        supportingAssetName: link.supportingAssetName,
        supportingAssetDerivedName: link.supportingAssetDerivedName,
        depth: 0,
      });
    }
  }

  let currentFrontier = [...visitedIds];

  for (let depth = 1; depth <= MAX_REACH_DEPTH && currentFrontier.length > 0; depth++) {
    const stsLinks = await repo.findSupportingAssetProviders(currentFrontier);
    allStsLinks.push(...stsLinks);

    const nextFrontier: Array<string> = [];
    for (const link of stsLinks) {
      if (!visitedIds.has(link.providerAssetId)) {
        visitedIds.add(link.providerAssetId);
        nextFrontier.push(link.providerAssetId);
        results.push({
          supportingAssetId: link.providerAssetId,
          supportingAssetName: link.providerAssetName,
          supportingAssetDerivedName: link.providerAssetDerivedName,
          depth,
        });
      }
    }
    currentFrontier = nextFrontier;
  }

  return { derived: results, supportToPrimaryLinks: stpLinks, supportToSupportLinks: allStsLinks };
};

interface AssetRef extends AssetNames {
  id: string,
}

interface ScenarioImpactContribution extends Omit<ImpactContribution, 'chain'> {
  primaryAssetName: string,
  chain: Array<AssetRef>,
}

export interface ScenarioSupportingAsset {
  supportingAssetId: string,
  supportingAssetName: string | null,
  supportingAssetDerivedName: string | null,
  /** The shortest path's support-to-support hops. */
  depth: number,
  /** The primary assets it supports directly, then the supporting assets below the scenario it runs. */
  via: Array<AssetRef>,
  /** Across its links to the scenario's primary assets, empty for an asset that is only transitive. */
  roles: Array<SupportToPrimaryLinkRole>,
  /** The scenario's scope is closed and does not map the asset. */
  outOfScope: boolean,
  impact: number,
  contributions: Array<ScenarioImpactContribution>,
}

export interface ScenarioSupportingAssets {
  attackOutcome: { id: string, name: string, criteriaReached: CriteriaReached },
  primaryAssets: Array<{ id: string, name: string }>,
  /** Highest impact first, then by name. */
  assets: Array<ScenarioSupportingAsset>,
}

export interface ScenarioSupportingAssetsPage extends Omit<ScenarioSupportingAssets, 'assets'> {
  items: Array<ScenarioSupportingAsset>,
  /** Every supporting asset the walk reaches, not the rows of the page. */
  total: number,
  directCount: number,
  transitiveCount: number,
}

interface RiskScenarioImpactGraph extends RiskScenarioDependencyGraph {
  /** `null` for an unknown scenario or one of another tenant. */
  attackOutcome: { name: string, criteriaReached: CriteriaReached } | null,
  /** `contributions` explains the node's impact, as the list's row does. */
  assets: Array<RiskScenarioDependencyGraph['assets'][number] & { impact: number, contributions: Array<ScenarioImpactContribution> }>,
  /** What a support-to-primary link transmits of the attack, `null` on a link between two supporting assets. */
  links: Array<RiskScenarioDependencyGraph['links'][number] & { attackShare: AttackShare | null }>,
}

const criteriaReachedOf = (context: NonNullable<Awaited<ReturnType<Repo['findScenarioImpactContext']>>>): CriteriaReached => ({
  availability: context.reachesAvailability,
  integrity: context.reachesIntegrity,
  confidentiality: context.reachesConfidentiality,
  traceability: context.reachesTraceability,
});

const computeScenarioImpacts = (walk: SupportingAssetWalk, primaryAssets: Array<{ id: string }>, criteriaReached: CriteriaReached) =>
  computeAssetImpacts({
    primaryAssetIds: primaryAssets.map((asset) => asset.id),
    supportToPrimaryLinks: walk.supportToPrimaryLinks,
    supportToSupportLinks: walk.supportToSupportLinks,
    criteriaReached,
    maxHops: MAX_REACH_DEPTH,
  });

/** A ranked row before its contributions are resolved, which only the rows a page shows need. */
type RankedSupportingAsset = Omit<ScenarioSupportingAsset, 'outOfScope' | 'contributions'>;

const displayNameOf = (asset: RankedSupportingAsset) => asset.supportingAssetName ?? asset.supportingAssetDerivedName ?? '';

const viaTextOf = (asset: RankedSupportingAsset) => asset.via.map((via) => via.name ?? via.derivedName ?? '').join(', ');

const byImpactThenName = (a: RankedSupportingAsset, b: RankedSupportingAsset) =>
  b.impact - a.impact || compareText(displayNameOf(a), displayNameOf(b)) || a.supportingAssetId.localeCompare(b.supportingAssetId);

/** Ascending; on whole percents, so two impacts the list prints alike keep their rank by name. */
const SUPPORTING_ASSET_ORDERS: Record<ScenarioSupportingAssetSortKey, (a: RankedSupportingAsset, b: RankedSupportingAsset) => number> = {
  impact: (a, b) => wholePercent(a.impact) - wholePercent(b.impact),
  supportingAsset: (a, b) => compareText(displayNameOf(a), displayNameOf(b)),
  depth: (a, b) => a.depth - b.depth,
  via: (a, b) => compareText(viaTextOf(a), viaTextOf(b)),
};

interface WalkNames {
  assets: Map<string, AssetNames>,
  primaryAssets: Map<string, string>,
}

const namesOfWalk = (walk: SupportingAssetWalk, primaryAssets: Array<{ id: string, name: string }>): WalkNames => ({
  assets: new Map(walk.derived.map((row) => [row.supportingAssetId, { name: row.supportingAssetName, derivedName: row.supportingAssetDerivedName }])),
  primaryAssets: new Map(primaryAssets.map((asset) => [asset.id, asset.name])),
});

const assetRefOf = (names: WalkNames, id: string): AssetRef => ({
  id, name: names.assets.get(id)?.name ?? null, derivedName: names.assets.get(id)?.derivedName ?? null,
});

/** Every supporting asset the walk reaches, highest impact first and then by name. */
const rankScenarioSupportingAssets = (
  walk: SupportingAssetWalk,
  primaryAssets: Array<{ id: string, name: string }>,
  impacts: Map<string, AssetImpact>,
  names: WalkNames,
): Array<RankedSupportingAsset> => {
  const depthById = new Map(walk.derived.map((row) => [row.supportingAssetId, row.depth]));
  const directLinksById = Map.groupBy(walk.supportToPrimaryLinks, (link) => link.supportingAssetId);
  const dependentLinksById = Map.groupBy(walk.supportToSupportLinks, (link) => link.providerAssetId);

  return [...depthById].map(([supportingAssetId, depth]): RankedSupportingAsset => {
    const directLinks = directLinksById.get(supportingAssetId) ?? [];
    const primaryVia = primaryAssets
      .filter((primary) => directLinks.some((link) => link.primaryAssetId === primary.id))
      .map((primary): AssetRef => ({ id: primary.id, name: primary.name, derivedName: null }));
    const dependentIds = [...new Set((dependentLinksById.get(supportingAssetId) ?? [])
      .filter((link) => depthById.has(link.dependentAssetId))
      .map((link) => link.dependentAssetId))];
    return {
      supportingAssetId,
      supportingAssetName: names.assets.get(supportingAssetId)?.name ?? null,
      supportingAssetDerivedName: names.assets.get(supportingAssetId)?.derivedName ?? null,
      depth,
      via: [...primaryVia, ...dependentIds.map((id) => assetRefOf(names, id))],
      roles: canonicalLinkRoles(directLinks.flatMap((link) => link.roles)),
      impact: impacts.get(supportingAssetId)?.impact ?? 0,
    };
  }).toSorted(byImpactThenName);
};

const contributionsOf = (assetId: string, impacts: Map<string, AssetImpact>, names: WalkNames): Array<ScenarioImpactContribution> =>
  (impacts.get(assetId)?.contributions ?? []).map((contribution) => ({
    ...contribution,
    primaryAssetName: names.primaryAssets.get(contribution.primaryAssetId) ?? '',
    chain: contribution.chain.map((id) => assetRefOf(names, id)),
  }));

const withContributions = (
  row: RankedSupportingAsset,
  impacts: Map<string, AssetImpact>,
  names: WalkNames,
  mappedAssetIds: Set<string> | null,
): ScenarioSupportingAsset => ({
  ...row,
  outOfScope: mappedAssetIds !== null && !mappedAssetIds.has(row.supportingAssetId),
  contributions: contributionsOf(row.supportingAssetId, impacts, names),
});

/** The scenario, the impact context it is read in, its walk and every impact on it; `undefined` for an unknown scenario. */
const loadScenarioImpacts = async (repo: Repo, riskScenarioId: string) => {
  const [scenario, context] = await Promise.all([
    repo.findRiskScenarioById(riskScenarioId),
    repo.findScenarioImpactContext(riskScenarioId),
  ]);
  if (!scenario || !context) {
    return undefined;
  }
  const criteriaReached = criteriaReachedOf(context);
  const walk = await walkSupportingAssetGraph(repo, scenario.primaryAssets);
  const impacts = computeScenarioImpacts(walk, scenario.primaryAssets, criteriaReached);
  return { scenario, context, criteriaReached, walk, impacts, names: namesOfWalk(walk, scenario.primaryAssets) };
};

/** The page's rows with the names and way in each carries, read from the reach for those rows alone. */
const placeOnReach = async <T extends { supportingAssetId: string }>(
  repo: Repo,
  primaryAssets: Array<{ id: string, name: string }>,
  rows: Array<T>,
) => {
  const primaryAssetIds = primaryAssets.map((asset) => asset.id);
  const { waysIn, names } = await repo.findReachWaysIn(primaryAssetIds, [...new Set(rows.map((row) => row.supportingAssetId))]);
  return placeFindingRows(
    rows,
    waysIn,
    new Map(names.map((asset) => [asset.id, { name: asset.name, derivedName: asset.derivedName }])),
    new Map(primaryAssets.map((asset) => [asset.id, asset.name])),
  );
};

export const riskScenariosService = defineService(
  'riskScenarios',
  riskScenariosRepository,
).dependsOn(() => [
  assetDependenciesService,
  attackOutcomesService,
  techniqueMappingService,
]).implement({
  createRiskScenario: async ({ atomic, eventOrigin }, values: {
    id: string,
    organizationId: string,
    name: string,
    description: string | null,
    ownerId?: string | null,
    attackOutcomeId: string,
    primaryAssetIds: Array<string>,
    businessValueCategoryIds?: Array<string>,
  }) => {
    const { primaryAssetIds: rawPrimaryAssetIds, businessValueCategoryIds: rawCategoryIds, ...scenarioValues } = values;
    const primaryAssetIds = [...new Set(rawPrimaryAssetIds)];
    const requestedCategoryIds = rawCategoryIds !== undefined ? [...new Set(rawCategoryIds)] : undefined;
    const tenantId = requireTenantId(eventOrigin);
    await atomic(async ({ repo: atomicRepo }) => {
      if (scenarioValues.ownerId) {
        await atomicRepo.validateOwnerId(scenarioValues.ownerId);
      }
      await atomicRepo.validateOrganizationId(scenarioValues.organizationId);
      await atomicRepo.validateAttackOutcomeId(scenarioValues.attackOutcomeId);
      await atomicRepo.insertRiskScenario({ ...scenarioValues, tenantId });
      if (primaryAssetIds.length > 0) {
        await atomicRepo.validatePrimaryAssetIds(primaryAssetIds);
        await atomicRepo.insertRiskScenarioPrimaryAssets(
          primaryAssetIds.map((primaryAssetId) => ({
            riskScenarioId: values.id,
            primaryAssetId,
          })),
        );
      }
      // A scenario named with no scope of its own inherits the union of what its targets hold.
      const categoryIds = requestedCategoryIds
        ?? await atomicRepo.findBusinessValueCategoryIdsForPrimaryAssets(primaryAssetIds);
      if (categoryIds.length > 0) {
        await atomicRepo.validateBusinessValueCategoryIds(categoryIds);
        await atomicRepo.insertRiskScenarioBusinessValueCategories(
          categoryIds.map((businessValueCategoryId) => ({
            riskScenarioId: values.id,
            businessValueCategoryId,
          })),
        );
      }
    });
  },
  // No `attackOutcomeId`: the outcome is fixed at creation.
  updateRiskScenario: async ({ atomic }, id: string, values: {
    name?: string,
    description?: string | null,
    ownerId?: string | null,
    tefMode?: TefMode,
    primaryAssetIds?: Array<string>,
    businessValueCategoryIds?: Array<string>,
  }) => {
    const { primaryAssetIds: rawPrimaryAssetIds, businessValueCategoryIds: rawCategoryIds, ...fields } = values;
    const primaryAssetIds = rawPrimaryAssetIds !== undefined ? [...new Set(rawPrimaryAssetIds)] : undefined;
    const requestedCategoryIds = rawCategoryIds !== undefined ? [...new Set(rawCategoryIds)] : undefined;
    await atomic(async ({ repo: atomicRepo }) => {
      if (fields.ownerId) {
        await atomicRepo.validateOwnerId(fields.ownerId);
      }
      if (Object.keys(fields).length > 0) {
        await atomicRepo.updateRiskScenario(id, fields);
      }
      if (primaryAssetIds !== undefined) {
        const existingIds = await atomicRepo.findRiskScenarioPrimaryAssetIds(id);
        const { toAdd, toRemove } = diffSets(existingIds, primaryAssetIds);
        if (toAdd.length > 0) {
          await atomicRepo.validatePrimaryAssetIds(toAdd);
          await atomicRepo.insertRiskScenarioPrimaryAssets(
            toAdd.map((primaryAssetId) => ({ riskScenarioId: id, primaryAssetId })),
          );
        }
        if (toRemove.length > 0) {
          await atomicRepo.deleteRiskScenarioPrimaryAssetsByIds(id, toRemove);
        }
      }
      // The loss scope follows the targets: aiming the scenario at one more primary asset widens
      // what the attack destroys, taking one away narrows it.
      const categoryIds = requestedCategoryIds
        ?? (primaryAssetIds !== undefined
          ? await atomicRepo.findBusinessValueCategoryIdsForPrimaryAssets(primaryAssetIds)
          : undefined);
      if (categoryIds !== undefined) {
        const existingIds = await atomicRepo.findRiskScenarioBusinessValueCategoryIds(id);
        const { toAdd, toRemove } = diffSets(existingIds, categoryIds);
        if (toAdd.length > 0) {
          await atomicRepo.validateBusinessValueCategoryIds(toAdd);
          await atomicRepo.insertRiskScenarioBusinessValueCategories(
            toAdd.map((businessValueCategoryId) => ({ riskScenarioId: id, businessValueCategoryId })),
          );
        }
        if (toRemove.length > 0) {
          await atomicRepo.deleteRiskScenarioBusinessValueCategoriesByIds(id, toRemove);
        }
      }
    });
  },
  deleteRiskScenarios: async ({ repo }, ids: Array<string>) => await repo.deleteRiskScenarios(ids),
  getRiskScenario: async ({ repo }, id: string) => await repo.findRiskScenarioById(id),
  getRiskScenarioNamesByIds: async ({ repo }, ids: Array<string>) => await repo.findRiskScenarioNamesByIds(ids),
  /**
   * The list row: every scenario with its latest quantification, the shape of how it got there, the
   * move its last simulation produced and the one next action it needs. Three reads for the whole
   * list, none of which grows with the run history.
   */
  getRiskScenariosOverview: async ({ repo }, organizationId?: string) => {
    const now = new Date();
    const lifelineStart = new Date(now.getTime() - LIFELINE_WINDOW_DAYS * DAY_MS);
    const [scenarios, figures] = await Promise.all([
      repo.findAllRiskScenarios(organizationId),
      repo.findOverviewFigures(lifelineStart, now, organizationId),
    ]);
    const figuresByScenario = new Map(figures.map((figure) => [figure.riskScenarioId, figure]));

    return scenarios.map((scenario) => {
      const figure = figuresByScenario.get(scenario.id);
      const latestRun = figure?.latestRun ?? null;
      // A scenario last quantified before the window is still priced: its run in force reads as one
      // point, so an empty lifeline only ever means never quantified.
      const lifeline = figure?.lifeline.length || latestRun?.aleMean == null
        ? figure?.lifeline ?? []
        : [{ at: latestRun.createdAt, aleMean: latestRun.aleMean, aleP10: latestRun.aleP10, aleP90: latestRun.aleP90 }];
      return {
        ...scenario,
        latestRun,
        lifeline,
        changeOverLifeline: computeLifelineChange(lifeline),
        readiness: readinessOf(scenario, { ...figure, lastRunAt: latestRun?.createdAt ?? null }),
      };
    });
  },
  /**
   * The overview's scenarios with their readiness and nothing else, for a caller that needs only
   * which of them can be priced: it never reads the run figures or builds the lifeline.
   */
  getRiskScenariosReadiness: async ({ repo }, organizationId?: string) =>
    (await repo.findReadinessFigures(organizationId)).map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      readiness: readinessOf(row, row),
    })),
  getTefMode: async ({ repo }, id: string): Promise<TefMode | undefined> => repo.findScenarioTefMode(id),
  setTefMode: async ({ repo }, id: string, tefMode: TefMode) => repo.updateRiskScenario(id, { tefMode }),
  getAutoModeRiskScenarioIds: async ({ repo }, organizationId: string) => repo.findAutoModeRiskScenarioIds(organizationId),
  // `tenantId` is forwarded, never derived here: the technique weights are tenant state and this
  // read runs under a `system` origin inside the CRQ job, where the secured views scope nothing.
  getControlCapabilitiesForRiskScenario: async ({ repo, deps }, riskScenarioId: string, tenantId?: string) => {
    const scenario = await repo.findRiskScenarioById(riskScenarioId);
    if (!scenario) {
      return [];
    }
    const outcomeTechniques = await deps.attackOutcomes.getMitreTechniquesForOutcome(
      scenario.attackOutcomeId,
      { organizationId: scenario.organizationId, tenantId },
    );
    // The attack run engine prices a control on the admitted actors' whole repertoires, which are
    // wider than the outcome's curated set, so the list covers both or a priced control has no row.
    const repertoire = await repo.findActorTechniqueExternalIds(outcomeTechniques.mixtureGroups.map((group) => group.groupKey));
    const repertoireRows = await repo.findTechniqueIdsByExternalIds(
      [...new Set(repertoire.map((row) => foldToParentTechnique(row.techniqueExternalId)))],
    );
    const techniqueIds = [...new Set([
      ...outcomeTechniques.techniques.filter(isActiveTechnique).map((t) => t.mitreTechniqueId),
      ...repertoireRows.map((row) => row.id),
    ])];
    if (techniqueIds.length === 0) {
      return [];
    }
    return repo.findControlCapabilitiesByTechniqueIds(techniqueIds, scenario.organizationId);
  },

  /**
   * A closed scope's mapping flags the candidates and never narrows them: the shared asset outside it
   * is often the one whose compromise costs most. `undefined` for an unknown scenario or one of
   * another tenant.
   */
  getDerivedSupportingAssets: async ({ repo }, riskScenarioId: string): Promise<ScenarioSupportingAssets | undefined> => {
    const loaded = await loadScenarioImpacts(repo, riskScenarioId);
    if (!loaded) {
      return undefined;
    }
    const { scenario, context, criteriaReached, walk, impacts, names } = loaded;
    const ranked = rankScenarioSupportingAssets(walk, scenario.primaryAssets, impacts, names);
    const mappedAssetIds = context.estateMode === 'closed'
      ? new Set(await repo.findAssetIdsMappedToScope(context.organizationId, ranked.map((row) => row.supportingAssetId)))
      : null;
    return {
      attackOutcome: { id: context.attackOutcomeId, name: context.attackOutcomeName, criteriaReached },
      primaryAssets: scenario.primaryAssets,
      assets: ranked.map((row) => withContributions(row, impacts, names, mappedAssetIds)),
    };
  },

  /**
   * `getDerivedSupportingAssets` one page at a time: the whole walk is ranked, then cut, so the order
   * is the same on every page. The counts are the whole walk's.
   */
  listDerivedSupportingAssets: async (
    { repo },
    riskScenarioId: string,
    query: ScenarioPageQuery<ScenarioSupportingAssetSortKey>,
  ): Promise<ScenarioSupportingAssetsPage | undefined> => {
    const loaded = await loadScenarioImpacts(repo, riskScenarioId);
    if (!loaded) {
      return undefined;
    }
    const { scenario, context, criteriaReached, walk, impacts, names } = loaded;
    const ranked = rankScenarioSupportingAssets(walk, scenario.primaryAssets, impacts, names);
    const order = query.sortBy === undefined ? undefined : SUPPORTING_ASSET_ORDERS[query.sortBy];
    const sorted = order === undefined ? ranked : ranked.toSorted((a, b) => (query.sortDesc ? order(b, a) : order(a, b)));
    const page = sorted.slice((query.page - 1) * query.limit, query.page * query.limit);
    const mappedAssetIds = context.estateMode === 'closed'
      ? new Set(await repo.findAssetIdsMappedToScope(context.organizationId, page.map((row) => row.supportingAssetId)))
      : null;
    const directCount = ranked.filter((row) => row.depth === 0).length;
    return {
      attackOutcome: { id: context.attackOutcomeId, name: context.attackOutcomeName, criteriaReached },
      primaryAssets: scenario.primaryAssets,
      items: page.map((row) => withContributions(row, impacts, names, mappedAssetIds)),
      total: ranked.length,
      directCount,
      transitiveCount: ranked.length - directCount,
    };
  },

  /**
   * How `cveId` would be exploited on each supporting asset the scenario reaches: the techniques a
   * mapping naming the CVE gives, else the topology rule's reading of its vector and the asset's
   * exposure (T1190 internet-facing, T1210 internal). Whether the asset carries the CVE is not asked:
   * the question is how it would be exploited there. An unknown scenario or CVE, or one of another
   * tenant, is named in `missing`.
   */
  getCveExploitation: async (
    { repo, deps },
    riskScenarioId: string,
    cveId: string,
    limit: number,
  ): Promise<{ missing: 'scenario' | 'cve' } | { answer: CveExploitationAnswer, cve: { cveId: string, cveTitle: string | null, cvss: number | null, cvssVector: string | null } }> => {
    const [loaded, cve] = await Promise.all([loadScenarioImpacts(repo, riskScenarioId), repo.findCveRowByCveId(cveId)]);
    if (!loaded) {
      return { missing: 'scenario' };
    }
    if (!cve) {
      return { missing: 'cve' };
    }
    const { scenario, walk, impacts, names } = loaded;
    const ranked = rankScenarioSupportingAssets(walk, scenario.primaryAssets, impacts, names);
    const exposureById = new Map((await repo.findSupportingAssetExposures(ranked.map((row) => row.supportingAssetId)))
      .map((row) => [row.id, row.exposure]));
    const primaryNames = new Map(scenario.primaryAssets.map((asset) => [asset.id, asset.name]));
    const reached = ranked.map((row): CveExploitationReachedAsset => ({
      supportingAssetId: row.supportingAssetId,
      supportingAssetName: row.supportingAssetName,
      supportingAssetDerivedName: row.supportingAssetDerivedName,
      depth: row.depth,
      impact: row.impact,
      exposure: exposureById.get(row.supportingAssetId) ?? 'unknown',
      primaryAssets: [...new Set((impacts.get(row.supportingAssetId)?.contributions ?? []).map((part) => part.primaryAssetId))]
        .map((id) => ({ id, name: primaryNames.get(id) ?? '' })),
    }));
    const claims = await deps.techniqueMapping.getTechniqueClaims([cve.id]);
    const stored = claims.mappings.filter((mapping) => mapping.cveId === cve.id);
    const inputs = claims.cves.find((row) => row.cveRowId === cve.id);
    const answer = assembleCveExploitation(reached, (exposure) => readExposureExploitation(exposure, readAttackClaims({
      stored,
      cwe: inputs?.cwe ?? null,
      cvssVector: inputs?.cvssVector ?? null,
      cvssV2UserInteractionRequired: inputs?.cvssV2UserInteractionRequired ?? null,
      exposure,
      ruleCatalogue: claims.ruleCatalogue,
    })), limit);
    return { answer, cve: { cveId: cve.cveId, cveTitle: cve.cveTitle, cvss: cve.cvss, cvssVector: cve.cvssVector } };
  },

  /**
   * Where the evidence behind each supporting asset the scenario reaches stands at `now`, against a
   * re-test delay of `maxAgeDays` that the caller's policy sets: the assets that are not `current`
   * first, worst state then highest impact, cut to `limit`, with the counts per state of the whole
   * walk and the health of the connector syncs. `undefined` for an unknown scenario or one of another tenant.
   */
  getEvidenceHealth: async (
    { repo },
    riskScenarioId: string,
    maxAgeDays: number,
    limit: number,
    now: Date = new Date(),
  ): Promise<{
    assets: Array<EvidenceHealthReading & { supportingAssetId: string, supportingAssetName: string | null, supportingAssetDerivedName: string | null, markingRefs: Array<string>, impact: number, sources: Array<EvidenceHealthSource> }>,
    counts: Record<EvidenceHealthState, number>,
    markingRefs: Array<string>,
    sources: Array<SourceRunHealth>,
    total: number,
  } | undefined> => {
    const loaded = await loadScenarioImpacts(repo, riskScenarioId);
    if (!loaded) {
      return undefined;
    }
    const { scenario, walk, impacts, names } = loaded;
    const ranked = rankScenarioSupportingAssets(walk, scenario.primaryAssets, impacts, names);
    const ids = ranked.map((row) => row.supportingAssetId);
    const [inputs, runs, scenarioMarkingRefs] = await Promise.all([
      repo.findEvidenceHealthInputs(ids),
      repo.findLatestSucceededRunTotals(EVIDENCE_SYNC_KINDS),
      repo.findScenarioMarkingRefs(riskScenarioId),
    ]);
    const categoryById = new Map(inputs.assets.map((row) => [row.id, row.categoryId]));
    // A caller that records what it reads where other people read it (XTM One's CTEM loop) needs the
    // markings to keep a marked name out of a less cleared reader's view (CTEM marking parity, G5).
    const markingsById = new Map(inputs.assets.map((row) => [row.id, row.markingRefs]));
    const sourcesById = Map.groupBy(inputs.sources, (row) => row.supportingAssetId);
    const versioned = new Set(inputs.versions.map((row) => row.supportingAssetId));
    const verdictById = new Map(inputs.verdicts.map((row) => [row.supportingAssetId, row.lastVerdictAt]));
    const order = new Map(EVIDENCE_HEALTH_STATES.map((state, index) => [state, index]));
    const rankOf = (state: EvidenceHealthState) => order.get(state) ?? EVIDENCE_HEALTH_STATES.length;
    // An asset the walk reaches but the tenant's views do not show is left out, never read as a gap.
    const read = ranked.flatMap((row) => {
      const categoryId = categoryById.get(row.supportingAssetId);
      if (categoryId === undefined) {
        return [];
      }
      const sources = (sourcesById.get(row.supportingAssetId) ?? []).map(({ connectorId, origin, lastSeenAt }) => ({ connectorId, origin, lastSeenAt }));
      const reading = readEvidenceHealth({
        categoryId,
        sources,
        lastVerdictAt: verdictById.get(row.supportingAssetId) ?? null,
        versionReported: versioned.has(row.supportingAssetId),
      }, maxAgeDays, now);
      return [{ ...reading, supportingAssetId: row.supportingAssetId, supportingAssetName: row.supportingAssetName, supportingAssetDerivedName: row.supportingAssetDerivedName, markingRefs: markingsById.get(row.supportingAssetId) ?? [], impact: row.impact, sources }];
    });
    const counts: Record<EvidenceHealthState, number> = { no_source: 0, attested_only: 0, never_measured: 0, expired: 0, version_unknown: 0, current: 0 };
    for (const row of read) {
      counts[row.state] += 1;
    }
    const assets = read
      .filter((row) => row.state !== 'current')
      .toSorted((a, b) => (rankOf(a.state) - rankOf(b.state)) || (b.impact - a.impact))
      .slice(0, limit);
    return { assets, counts, markingRefs: scenarioMarkingRefs ?? [], sources: readSourceRunHealth(runs), total: read.length };
  },

  /**
   * An unknown scenario, or one of another tenant, reads as a scenario with no primary asset. The
   * impact is walked over every path whatever `depth` draws, so a node reads the list's figure, and
   * an asset holding more providers than the graph draws shows the highest impacts first.
   */
  getDependencyGraph: async ({ repo, deps }, riskScenarioId: string, depth: number): Promise<RiskScenarioImpactGraph> => {
    const [scenario, context] = await Promise.all([
      repo.findRiskScenarioById(riskScenarioId),
      repo.findScenarioImpactContext(riskScenarioId),
    ]);
    const primaryAssets = scenario?.primaryAssets ?? [];
    const walk = await walkSupportingAssetGraph(repo, primaryAssets);
    const criteriaReached = context ? criteriaReachedOf(context) : null;
    const impacts = criteriaReached ? computeScenarioImpacts(walk, primaryAssets, criteriaReached) : new Map<string, AssetImpact>();
    const names = namesOfWalk(walk, primaryAssets);
    const graph = await deps.assetDependencies.getDependencyGraphBelow(
      primaryAssets.map((asset) => asset.id),
      depth,
      new Map([...impacts].map(([assetId, assetImpact]) => [assetId, assetImpact.impact])),
    );
    return {
      primaryAssets,
      attackOutcome: context && criteriaReached ? { name: context.attackOutcomeName, criteriaReached } : null,
      ...graph,
      assets: graph.assets.map((asset) => ({
        ...asset,
        impact: impacts.get(asset.id)?.impact ?? 0,
        contributions: contributionsOf(asset.id, impacts, names),
      })),
      links: graph.links.map((link) => ({
        ...link,
        attackShare: link.roles && criteriaReached
          ? shareOfAttackTransmitted(criteriaReached, inheritedCriteriaOfRoles(link.roles))
          : null,
      })),
    };
  },

  /**
   * The CVE findings on the assets the scenario's primary assets reach, one row per asset and CVE,
   * one page at a time: deduplicated, filtered and ordered in the database, since a wide reach holds
   * hundreds of thousands of assets. `summary` counts every finding the filters keep, not the rows of the page.
   */
  listFindingsForRiskScenario: async ({ repo }, riskScenarioId: string, query: ScenarioFindingsQuery) => {
    const scenario = await repo.findRiskScenarioById(riskScenarioId);
    if (!scenario || scenario.primaryAssets.length === 0) {
      return { items: [], summary: NO_SCENARIO_FINDINGS };
    }
    const primaryAssetIds = scenario.primaryAssets.map((asset) => asset.id);
    const [rows, summary] = await Promise.all([
      repo.findScenarioFindingsPage(primaryAssetIds, query),
      repo.countScenarioFindings(primaryAssetIds, query),
    ]);
    return { items: await placeOnReach(repo, scenario.primaryAssets, rows), summary };
  },

  /** The applicable findings by CVSS severity, the ones set aside, and the `topLimit` to look at first. */
  getFindingsSummaryForRiskScenario: async ({ repo }, riskScenarioId: string, topLimit: number) => {
    const scenario = await repo.findRiskScenarioById(riskScenarioId);
    if (!scenario || scenario.primaryAssets.length === 0) {
      return { counts: NO_SCENARIO_FINDING_SEVERITIES, top: [] };
    }
    const primaryAssetIds = scenario.primaryAssets.map((asset) => asset.id);
    const [counts, top] = await Promise.all([
      repo.countScenarioFindingSeverities(primaryAssetIds),
      repo.findTopScenarioFindings(primaryAssetIds, topLimit),
    ]);
    return { counts, top: await placeOnReach(repo, scenario.primaryAssets, top) };
  },

  findRiskScenariosByAttackOutcomeIds: async ({ repo }, attackOutcomeIds: Array<string>, organizationId?: string) =>
    await repo.findRiskScenariosByAttackOutcomeIds(attackOutcomeIds, organizationId),

  getRiskScenariosInScopes: async (
    { repo },
    scopes: { closedOrganizationIds: Array<string>, includeOpenScopes: boolean, onlyOrganizationId: string | null },
  ) => await repo.findRiskScenariosInScopes(scopes),

  /** A scenario's loss-estimate activation set: its attack outcome crossed with its own loss scope. */
  getScenarioActivationContext: async ({ repo }, riskScenarioId: string) =>
    await repo.findScenarioActivationContext(riskScenarioId),

  /**
   * Declares this scenario's estimates derived from the given answers version, inside the caller's
   * transaction. Returns whether the stamp actually moved: a run that finds the version already
   * recorded writes nothing, which is what keeps the recompute from waking itself through the
   * `risk_scenarios` it also reads.
   */
  markEstimatesDerived: async ({ repo }, riskScenarioId: string, answersVersion: string) =>
    await repo.stampDerivedAnswers(riskScenarioId, answersVersion),

  /** Whether this scenario's own estimates predate the current answers. */
  isEstimatesRecomputePending: async ({ repo }, riskScenarioId: string) =>
    await repo.findEstimatesRecomputePending(riskScenarioId),

  /** Just the scenario's owning organization, in the one statement a caller needing no more than that shouldn't skip past. */
  getScenarioOrganizationId: async ({ repo }, riskScenarioId: string) =>
    await repo.findScenarioOrganizationId(riskScenarioId),

  /** Ordered by id, and past `after` when given, so a pass can resume where an earlier run stopped. */
  getAllRiskScenarioIds: async ({ repo }, after?: string) => await repo.findAllRiskScenarioIds(after),
  getRiskScenarioPricingSubject: async ({ repo }, riskScenarioId: string) =>
    await repo.findRiskScenarioPricingSubject(riskScenarioId),

  getRiskScenarioIdsByOrganizationIds: async ({ repo }, organizationIds: Array<string>) =>
    await repo.findRiskScenarioIdsByOrganizationIds(organizationIds),

  /** `null` drops the scenario's own threshold, so it follows its scope again. Returns whether the scenario exists. */
  setRiskTolerance: async ({ repo }, riskScenarioId: string, tolerance: RiskTolerance | null): Promise<boolean> => {
    if (await repo.findScenarioOrganizationId(riskScenarioId) === undefined) {
      return false;
    }
    await (tolerance === null ? repo.deleteRiskTolerance(riskScenarioId) : repo.upsertRiskTolerance(riskScenarioId, tolerance));
    return true;
  },
});
