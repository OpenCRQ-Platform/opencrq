import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { newError, StructuredError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { OutcomeEvidenceMode, OutcomeTechniques, OutcomeTechniqueScope } from '../attack-outcomes';
import type { TefMode } from '../risk-scenarios/schema';
import type { TefCatalogue, TefCatalogueLookup, TefSizeClass, TefSizeSource } from '../tef-catalog';
import type {
  TefCatalogOverview,
  TefCatalogProfile,
  TefCatalogRead,
  TefCatalogReading,
  TefCatalogSource,
  TefEstimate,
  TefEstimateWithRead,
  TefInput,
  TefScopeReading,
} from './types';
import type { crqIndicatorRunAnnualLosses, CrqReachGapKind, TefFallbackReason } from './schema';
import type { ExtractPublicFromDef, InferRepository, ServiceContext } from '../../registry';
import type { AssetCategory, AssetSubcategory } from '../supporting-assets/constants';
import type { SupportingAssetExposure } from '../supporting-assets/schema';
import type { UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import type { AttackRunReachReport } from './attack-run-inputs';
import type { EngineRunResult } from './engine/engine-run';
import type { CveGainSource, CveGainState } from './cve-gain-state';
import type { CrqRunProfile } from './run-profile';
import type { EngineRunRows } from './result-fingerprint';
import type { AnnualLossDistribution } from './engine/annual-loss';
import type { EstateMode, RevenueBand } from '../organizations/constants';
import type { PertRange } from './engine/attack-run-worlds';
import type { TefRange } from './tef-total';
import type { ReviewExceedanceKey, ReviewFigureKey, ReviewPricing } from '../budget-reviews/review-baskets';
import type { BudgetReviewTolerancePosture } from '../budget-reviews/constants';
import type { AssessmentAxis } from '../controls/capability/constants';
import type { PostureCrossing } from '../controls/capability/service';
import type { XtmExposure } from './xtm-exposure';
import { foldToParentTechnique } from '../threat-analyses/technique-weighting';
import { InputsNotReadyError, NonRetryableError } from '../jobs/types';
import { organizationsService, REVENUE_BAND_VALUES } from '../organizations';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { attackOutcomesService, outcomeCatalogId, PATHS_WITHOUT_INITIAL_ACCESS } from '../attack-outcomes';
import { attackSurfacesService } from '../attack-surfaces/service';
import { riskScenariosService } from '../risk-scenarios';
import { scenarioLossEstimatesService } from '../scenario-loss-estimates';
import { crqIndicatorSettingsService, freshPhishingFailureRate, MAX_CRQ_ITERATIONS } from '../crq-indicator-settings';
import { cweService } from '../cwe/service';
import { DEFAULT_ACTOR_CLASS, resolveEffectiveActorClass } from '../threat-analyses/actor-classes';
import { currentTefCatalogue, lookupTefCatalogue, revenueBandSizeClasses, TEF_ANY, TEF_OUTCOME_BY_KEY, TEF_SIZE_CLASSES, tefCatalogueOf } from '../tef-catalog';
import { countriesService } from '../countries';
import { sectorsService } from '../sectors';
import { budgetReviewsService } from '../budget-reviews/service';
import { declaredEstateService } from '../declared-estate/service';
import { annualLossBasketsOf } from '../budget-reviews/review-baskets';
import { entryTechniqueApplies } from '../attack-surfaces/entry-applicability';
import { crossingRepricesScope } from '../controls/capability/scope-posture';
import { SCENARIO_GROUP_BOOST_G } from './engine/engine-constants';
import { DEFAULT_REACTION_TIME_HOURS } from './engine/attack-run-constants';
import { createEngineRun } from './engine/engine-run';
import { fingerprintedBaseline, resolveAttackRunInputs } from './attack-run-inputs';
import { completeDeclaredEstate } from './declared-estate-completion';
import { totalOfRanges } from './tef-total';
import { aggregateTopControls } from './control-aggregation';
import { actorCveRoutes } from './actor-cve-routes';
import { cveGainState } from './cve-gain-state';
import { compareCveScenarioGains } from './cve-scenario-gain-order';
import { fingerprintOf } from './run-fingerprint';
import { resultFingerprintOf } from './result-fingerprint';
import { crqIndicatorsRepository } from './repository';
import { computesSubject, familyRunOwnership, FULL_RUN_PROFILE, PRICE_RUN_PROFILE, runProfileCovers, runProfileTokens } from './run-profile';
import { summariseXtmExposure } from './xtm-exposure';

type CrqRepo = InferRepository<typeof crqIndicatorsRepository>;

/**
 * The universe a run prices against: the admitted actors' whole repertoire, folded to parent
 * techniques, never the outcome's curated set, plus the techniques of the outcome's path around
 * the door, which no actor needs to hold for the path to be played. The recompute a posture save
 * books resolves its scenarios through this same call, so the two cannot answer "does this control
 * play here" differently.
 */
const repertoireTechniquesOf = (
  repo: CrqRepo,
  actorTechniques: Array<{ techniqueExternalId: string }>,
  pathTechniqueExternalIds: ReadonlyArray<string> = [],
) => repo.findTechniqueIdsByExternalIds(
  [...new Set([...actorTechniques.map((row) => foldToParentTechnique(row.techniqueExternalId)), ...pathTechniqueExternalIds])],
);

/** The run each scenario's CVE what-ifs are read from: the newest one that computed them whole. */
const findCveFamilyRunIds = async (repo: CrqRepo, riskScenarioIds: Array<string>): Promise<Map<string, string>> => {
  const runs = await repo.findFamilyRunsByScenarioIds('cves', riskScenarioIds);
  const runIdByScenarioId = new Map<string, string>();
  for (const [riskScenarioId, scenarioRuns] of Map.groupBy(runs, (run) => run.riskScenarioId)) {
    const runId = familyRunOwnership(scenarioRuns, 'cves').runIds.at(0);
    if (runId !== undefined) {
      runIdByScenarioId.set(riskScenarioId, runId);
    }
  }
  return runIdByScenarioId;
};

const findCveFamilyRun = async (repo: CrqRepo, riskScenarioId: string) => {
  const runId = (await findCveFamilyRunIds(repo, [riskScenarioId])).get(riskScenarioId);
  return runId === undefined ? undefined : await repo.findRunById(runId);
};

export interface ScenarioControls {
  riskScenarioId: string,
  controlIds: Array<string>,
}

interface PricedScenarioDeps {
  attackOutcomes: {
    getAllAttackOutcomeIds: () => Promise<Array<string>>,
    getMitreTechniquesForOutcome: (attackOutcomeId: string, scope: OutcomeTechniqueScope) => Promise<OutcomeTechniques>,
  },
  riskScenarios: {
    findRiskScenariosByAttackOutcomeIds: (attackOutcomeIds: Array<string>, organizationId?: string) => Promise<Array<{ id: string, attackOutcomeId: string }>>,
  },
}

/**
 * The scope's scenarios whose run would carry any of `capabilityIds`, and which of them, answered by
 * the engine's own input builder over the engine's own technique universe.
 *
 * Resolved once per attack outcome: the repertoire depends on the outcome's admitted actors and
 * the scope, never on the individual scenario.
 */
const scenariosPricedAgainst = async (
  repo: CrqRepo,
  deps: PricedScenarioDeps,
  capabilityIds: ReadonlySet<string>,
  organizationId: string,
  tenantId: string,
): Promise<Array<ScenarioControls>> => {
  if (capabilityIds.size === 0) {
    return [];
  }
  const attackOutcomeIds = await deps.attackOutcomes.getAllAttackOutcomeIds();
  if (attackOutcomeIds.length === 0) {
    return [];
  }
  const scenarios = await deps.riskScenarios.findRiskScenariosByAttackOutcomeIds(attackOutcomeIds, organizationId);
  const scenarioIdsByOutcome = Map.groupBy(scenarios, (scenario) => scenario.attackOutcomeId);
  const priced: Array<ScenarioControls> = [];
  for (const [attackOutcomeId, outcomeScenarios] of scenarioIdsByOutcome) {
    const outcomeTechniques = await deps.attackOutcomes.getMitreTechniquesForOutcome(attackOutcomeId, { organizationId, tenantId });
    const analysisIds = outcomeTechniques.mixtureGroups.map((group) => group.groupKey);
    if (analysisIds.length === 0) {
      continue;
    }
    const actorTechniques = await repo.findActorTechniqueExternalIds(analysisIds);
    const repertoireRows = await repertoireTechniquesOf(
      repo,
      actorTechniques,
      withoutInitialAccessOf(outcomeCatalogId(tenantId, attackOutcomeId))?.techniqueExternalIds,
    );
    if (repertoireRows.length === 0) {
      continue;
    }
    const controls = await repo.findAttackRunControlInputs(repertoireRows.map((row) => row.id), tenantId, organizationId);
    const controlIds = [...new Set(controls.map((control) => control.controlId).filter((id) => capabilityIds.has(id)))].sort();
    if (controlIds.length > 0) {
      priced.push(...outcomeScenarios.map((scenario) => ({ riskScenarioId: scenario.id, controlIds })));
    }
  }
  return priced;
};

type ScopeOverrideRow = Awaited<ReturnType<CrqRepo['findScopeOverridesOfCapabilities']>>[number];

/** What a scope's own declaration holds on one axis, null where it leaves the tenant's value to stand. */
const pinnedBy = (override: ScopeOverrideRow | undefined, axis: AssessmentAxis) => {
  switch (axis) {
    case 'strength':
      return override?.strengthRung;
    case 'coverage':
      return override?.coverageBucket;
  }
};

const DEFAULT_TOP_CONTROLS_FOR_OUTCOME_LIMIT = 5;

export interface FigureFamilyDate {
  computedAt: Date,
  olderThanHeadline: boolean,
}

export interface FigureFamilyDates {
  headlineAt: Date,
  levers: FigureFamilyDate | null,
  techniques: FigureFamilyDate | null,
  cves: FigureFamilyDate | null,
}

export interface CveScenarioGain {
  id: string,
  name: string,
  organizationId: string,
  aleMean: number | null,
  aleP10: number | null,
  aleP90: number | null,
  noMappedAsset: boolean,
  gain: CveGainState,
  /** The run that priced the CVEs is not the scenario's latest run. */
  olderThanHeadline: boolean,
  /** When the run that priced the CVEs ran, null when no run did. */
  computedAt: Date | null,
  /** The job has not computed the scenario's attacker mixture yet, so its citing actors are unknown. */
  mixturePending: boolean,
}

export interface CveScenarioGains {
  /** The distinct threat analyses citing the CVE among the listed scenarios' mixtures. */
  actorCount: number,
  /** The listed scenarios whose mixture holds at least one of them. */
  citedScenarioCount: number,
  /** The sum of the listed scenarios' mean annual loss, never of their gains, which overlap. */
  totalAle: number,
  scenarios: Array<CveScenarioGain>,
}

const NO_CVE_SCENARIO_GAINS: CveScenarioGains = { actorCount: 0, citedScenarioCount: 0, totalAle: 0, scenarios: [] };

/**
 * The CVEs of the openings that the run would play at its door under the tenant setting: the rows are
 * stored under the widest reading of an unknown exposure, which the run narrows.
 */
const cveIdsPricedAtTheDoor = (
  openings: Array<{ cveId: string, categoryId: AssetCategory, subcategoryId: AssetSubcategory | null, exposure: SupportingAssetExposure, techniqueExternalId: string }>,
  unknownExposureCountsAs: UnknownExposureCountsAs,
): Array<string> => [...new Set(openings
  .filter(({ techniqueExternalId, ...asset }) =>
    entryTechniqueApplies(foldToParentTechnique(techniqueExternalId), { ...asset, identityEnabled: true }, unknownExposureCountsAs))
  .map((opening) => opening.cveId))];

const DAY_MS = 86_400_000;

/** One a day over the widest period the Overview offers. */
const RUN_TIMELINE_SAMPLES = 365;
/** What `getRunHistory` returns, for the caller outside this repository that cannot page. */
const RUN_HISTORY_LIMIT = 500;

const hasAleMean = <T extends { aleMean: number | null }>(row: T): row is T & { aleMean: number } => row.aleMean !== null;

// ─── Auto TEF ────────────────────────────────────────────────────────────────

/** The catalogue package every auto estimate is read from. */
export const currentTefCatalogueRef = (): { id: string, version: string } => {
  const { id, version } = currentTefCatalogue();
  return { id, version };
};

interface OrganizationFirmography {
  sectorId: string | null,
  countryId: string | null,
  revenueBand: RevenueBand | null,
  employeeCount: number | null,
  sector: { name: string } | null,
  country: { isoAlpha2: string, isoAlpha3: string } | null,
}

interface AutoTefDeps {
  riskScenarios: {
    getRiskScenarioPricingSubject: (id: string) => Promise<{ attackOutcomeId: string, organizationId: string, tefMode: TefMode } | undefined>,
  },
  organizations: {
    getOrganization: (id: string) => Promise<OrganizationFirmography | undefined>,
  },
}

interface StoredTefRead {
  catalogId: string,
  catalogVersion: string,
  countryIsoAlpha3: string | null,
  sectorName: string | null,
  sizeSource: TefSizeSource,
  readCountry: string,
  readSector: string | null,
  readSizeClasses: Array<string>,
  readSizeWeights: Array<number>,
  notMeasured: Array<TefCatalogRead['notMeasured'][number]>,
  sourceIds: Array<string>,
}

interface AutoTefResolution {
  range: TefRange,
  positioned: boolean,
  fallbackReason: TefFallbackReason | null,
  read: StoredTefRead,
}

/** A catalogue profile naming a country or a sector the caller's tenant does not hold. */
export class TefCatalogProfileUnknownIdError extends StructuredError {
  override readonly name: string = 'TefCatalogProfileUnknownIdError';

  constructor(field: 'countryId' | 'sectorId') {
    super(field === 'countryId' ? 'The TEF catalogue profile names an unknown country' : 'The TEF catalogue profile names an unknown sector', { data: { field } });
  }
}

interface AskedProfile {
  country: { isoAlpha2: string, isoAlpha3: string } | null,
  sectorName: string | null,
  employeeCount: number | null,
  revenueBand: RevenueBand | null,
}

const askedProfileOf = (organization: OrganizationFirmography | undefined): AskedProfile => ({
  country: organization?.countryId != null && organization.country !== null ? organization.country : null,
  sectorName: organization?.sectorId != null && organization.sector !== null ? organization.sector.name : null,
  employeeCount: organization?.employeeCount ?? null,
  revenueBand: organization?.revenueBand ?? null,
});

const readTefCatalogue = (catalogue: TefCatalogue, asked: AskedProfile, outcomeId: string): TefCatalogueLookup =>
  lookupTefCatalogue(catalogue, {
    countryIsoAlpha2: asked.country?.isoAlpha2 ?? null,
    sector: asked.sectorName,
    employeeCount: asked.employeeCount,
    revenueBand: asked.revenueBand,
  }, outcomeId);

const storedReadOf = (catalogue: TefCatalogue, lookup: TefCatalogueLookup, asked: AskedProfile): StoredTefRead => ({
  catalogId: catalogue.id,
  catalogVersion: catalogue.version,
  countryIsoAlpha3: asked.country?.isoAlpha3 ?? null,
  sectorName: asked.sectorName,
  sizeSource: lookup.sizeSource,
  readCountry: lookup.country,
  readSector: lookup.sector === TEF_ANY ? null : lookup.sector,
  readSizeClasses: lookup.sizeClasses.map((share) => share.sizeClass),
  readSizeWeights: lookup.sizeClasses.map((share) => share.weight),
  notMeasured: [...lookup.notMeasured],
  sourceIds: [...lookup.sourceIds],
});

/**
 * Every profile reads a range, a missing value reading every value of that dimension, which can sit
 * far from the profile's own. One missing its country, sector or size is still recorded as not
 * positioned, which the scenario's checklist asks to complete.
 */
const computeAutoTefResolution = (
  catalogue: TefCatalogue,
  outcomeId: string,
  organization: OrganizationFirmography | undefined,
): AutoTefResolution => {
  const asked = askedProfileOf(organization);
  const lookup = readTefCatalogue(catalogue, asked, outcomeId);
  const complete = asked.country !== null && asked.sectorName !== null && lookup.sizeSource !== 'none';
  return {
    range: { low: lookup.low, likely: lookup.likely, high: lookup.high },
    positioned: complete,
    fallbackReason: complete ? null : 'incomplete_firmography',
    read: storedReadOf(catalogue, lookup, asked),
  };
};

const catalogueSources = (catalogue: TefCatalogue | undefined, ids: ReadonlyArray<string>): Array<TefCatalogSource> | null =>
  (catalogue === undefined
    ? null
    : ids.flatMap((id) => {
      const source = catalogue.sources.find((candidate) => candidate.id === id);
      return source === undefined ? [] : [{ ...source }];
    }));

const CATALOGUE_OUTCOME_IDS: ReadonlySet<string> = new Set(Object.values(TEF_OUTCOME_BY_KEY));

/** The tenant's attack outcomes the catalogue measures, each with the catalogue's own id for it. */
const catalogueOutcomesOf = <T extends { id: string }>(outcomeRows: ReadonlyArray<T>, tenantId: string): Array<{ outcome: T, catalogOutcomeId: string }> =>
  outcomeRows.flatMap((outcome) => {
    const catalogOutcomeId = outcomeCatalogId(tenantId, outcome.id);
    return catalogOutcomeId === undefined || !CATALOGUE_OUTCOME_IDS.has(catalogOutcomeId) ? [] : [{ outcome, catalogOutcomeId }];
  });

const isSizeClass = (value: string): value is TefSizeClass => (TEF_SIZE_CLASSES as ReadonlyArray<string>).includes(value);

const apiReadOf = (read: StoredTefRead, range: { low: number, likely: number, high: number }): TefCatalogRead => ({
  catalogue: { id: read.catalogId, version: read.catalogVersion },
  countryIsoAlpha3: read.countryIsoAlpha3,
  sectorName: read.sectorName,
  sizeSource: read.sizeSource,
  country: read.readCountry,
  sector: read.readSector,
  sizeClasses: read.readSizeClasses.flatMap((sizeClass, i) => (isSizeClass(sizeClass) ? [{ sizeClass, weight: read.readSizeWeights[i] ?? 0 }] : [])),
  low: range.low,
  likely: range.likely,
  high: range.high,
  notMeasured: read.notMeasured,
  sources: catalogueSources(tefCatalogueOf(read.catalogId, read.catalogVersion), read.sourceIds),
});

type StoredEstimateRead = Pick<TefEstimate, 'catalogId' | 'catalogVersion' | 'min' | 'likely' | 'max' | 'countryIsoAlpha3' | 'sectorName' | 'sizeSource' | 'readCountry' | 'readSector' | 'readSizeClasses' | 'readSizeWeights' | 'notMeasured' | 'sourceIds'>;

/** The read an estimate records, `null` on one of the multiplier vintages. */
const estimateReadOf = (estimate: StoredEstimateRead): TefCatalogRead | null => {
  const { catalogId, catalogVersion, sizeSource, readCountry, readSizeClasses, readSizeWeights, notMeasured, sourceIds } = estimate;
  if (catalogId === null || catalogVersion === null || sizeSource === null || readCountry === null
    || readSizeClasses === null || readSizeWeights === null || notMeasured === null || sourceIds === null) {
    return null;
  }
  return apiReadOf(
    { catalogId, catalogVersion, countryIsoAlpha3: estimate.countryIsoAlpha3, sectorName: estimate.sectorName, sizeSource, readCountry, readSector: estimate.readSector, readSizeClasses, readSizeWeights, notMeasured, sourceIds },
    { low: estimate.min, likely: estimate.likely, high: estimate.max },
  );
};

const withReadOf = (estimate: TefEstimate): TefEstimateWithRead => ({
  id: estimate.id,
  riskScenarioId: estimate.riskScenarioId,
  catalogVintage: estimate.catalogVintage,
  catalogId: estimate.catalogId,
  catalogVersion: estimate.catalogVersion,
  min: estimate.min,
  likely: estimate.likely,
  max: estimate.max,
  positioned: estimate.positioned,
  fallbackReason: estimate.fallbackReason,
  createdAt: estimate.createdAt,
  read: estimateReadOf(estimate),
});

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

interface CatalogueReaderDeps {
  attackOutcomes: { getAttackOutcomes: () => Promise<Array<{ id: string, name: string }>> },
  sectors: { getSectors: () => Promise<Array<{ id: string, name: string }>> },
  countries: { getCountries: () => Promise<Array<{ id: string, isoAlpha2: string, isoAlpha3: string }>> },
}

/**
 * Reads profiles in the catalogue in force with the tenant's outcomes, sectors and countries loaded
 * once: every outcome of the catalogue, and their total (`totalOfRanges`).
 * A country or sector id the tenant does not hold is refused, never read as unset.
 */
const catalogueReader = async (deps: CatalogueReaderDeps, tenantId: string): Promise<(profile: TefCatalogProfile) => TefCatalogReading> => {
  const catalogue = currentTefCatalogue();
  const [outcomeRows, sectorRows, countryRows] = await Promise.all([
    deps.attackOutcomes.getAttackOutcomes(),
    deps.sectors.getSectors(),
    deps.countries.getCountries(),
  ]);
  const outcomes = catalogueOutcomesOf(outcomeRows, tenantId);
  const sectorById = new Map(sectorRows.map((sector) => [sector.id, sector]));
  const countryById = new Map(countryRows.map((country) => [country.id, country]));
  return (profile) => {
    const country = profile.countryId === null ? null : countryById.get(profile.countryId);
    if (country === undefined) {
      throw new TefCatalogProfileUnknownIdError('countryId');
    }
    const sector = profile.sectorId === null ? null : sectorById.get(profile.sectorId);
    if (sector === undefined) {
      throw new TefCatalogProfileUnknownIdError('sectorId');
    }
    const asked: AskedProfile = {
      country: country === null ? null : { isoAlpha2: country.isoAlpha2, isoAlpha3: country.isoAlpha3 },
      sectorName: sector?.name ?? null,
      employeeCount: profile.employeeCount,
      revenueBand: profile.revenueBand,
    };
    const reads = outcomes.map(({ outcome, catalogOutcomeId }) => {
      const lookup = readTefCatalogue(catalogue, asked, catalogOutcomeId);
      return { catalogOutcomeId, attackOutcomeId: outcome.id, name: outcome.name, read: apiReadOf(storedReadOf(catalogue, lookup, asked), lookup) };
    });
    return {
      outcomes: reads.map(({ attackOutcomeId, name, read }) => ({ attackOutcomeId, name, read })),
      // Keyed by the catalogue's own outcome id, so every tenant reads one profile at one total.
      total: totalOfRanges(reads.map(({ catalogOutcomeId, read }) => ({ ...read, key: catalogOutcomeId }))),
    };
  };
};

const persistTefEstimate = async (
  repo: CrqRepo,
  riskScenarioId: string,
  resolution: AutoTefResolution,
): Promise<TefEstimate> => {
  const inserted = await repo.insertTefEstimate({
    id: uuidv7(),
    riskScenarioId,
    min: resolution.range.low,
    likely: resolution.range.likely,
    max: resolution.range.high,
    positioned: resolution.positioned,
    fallbackReason: resolution.fallbackReason,
    ...resolution.read,
  });
  if (!inserted) {
    throw newError('Failed to persist TEF estimate', { riskScenarioId });
  }
  return inserted;
};

/**
 * The three decimals the auto mode displays. The triplet handed over on the way to manual is the
 * number the analyst was reading, not the double behind it.
 */
const roundToDisplayedPrecision = (value: number): number => Math.round(value * 1000) / 1000;

/** True when the run drew the frequency this stored estimate carries. */
const sampledEstimate = (run: { tefMin: number | null, tefLikely: number | null, tefMax: number | null }, stored: TefEstimate): boolean =>
  run.tefMin === stored.min && run.tefLikely === stored.likely && run.tefMax === stored.max;

const sameList = <T>(stored: ReadonlyArray<T> | null, fresh: ReadonlyArray<T>): boolean =>
  stored !== null && stored.length === fresh.length && stored.every((value, i) => value === fresh[i]);

/**
 * True when the stored row already says what the fresh resolution says, read included, so persisting
 * it again would only move `created_at`, which every freshness read takes for "the frequency moved".
 */
const carriesSameEstimate = (stored: TefEstimate, resolution: AutoTefResolution): boolean => {
  const { read } = resolution;
  return stored.catalogId === read.catalogId
    && stored.catalogVersion === read.catalogVersion
    && stored.min === resolution.range.low
    && stored.likely === resolution.range.likely
    && stored.max === resolution.range.high
    && stored.positioned === resolution.positioned
    && stored.fallbackReason === resolution.fallbackReason
    && stored.countryIsoAlpha3 === read.countryIsoAlpha3
    && stored.sectorName === read.sectorName
    && stored.sizeSource === read.sizeSource
    && stored.readCountry === read.readCountry
    && stored.readSector === read.readSector
    && sameList(stored.readSizeClasses, read.readSizeClasses)
    && sameList(stored.readSizeWeights, read.readSizeWeights)
    && sameList(stored.notMeasured, read.notMeasured)
    && sameList(stored.sourceIds, read.sourceIds);
};

/**
 * Recomputes the estimate and records it — the job-triggered, mode-switch and "first auto read"
 * path. A resolution identical to the stored row keeps that row rather than writing a second copy
 * of it, so `created_at` marks a frequency that moved and not a recomputation that ran.
 * `keepStored` lets a caller refuse that reuse for a reason the values cannot show.
 */
const computeAndPersistAutoTefEstimate = async (
  repo: CrqRepo,
  deps: AutoTefDeps,
  riskScenarioId: string,
  tenantId: string,
  keepStored: (stored: TefEstimate) => boolean | Promise<boolean> = () => true,
): Promise<TefEstimate> => {
  const scenario = await deps.riskScenarios.getRiskScenarioPricingSubject(riskScenarioId);
  if (!scenario) {
    throw newError('Risk scenario not found', { riskScenarioId });
  }
  // `attack_outcomes.id` is tenant-derived (`deriveSeedId(tenantId, catalogId)`); the catalog's own
  // baseRates are keyed on the canonical id, so the derivation is reversed first.
  const catalogOutcomeId = outcomeCatalogId(tenantId, scenario.attackOutcomeId);
  if (!catalogOutcomeId) {
    throw newError('Attack outcome does not resolve to a catalog id for this tenant', { riskScenarioId, attackOutcomeId: scenario.attackOutcomeId });
  }
  const organization = await deps.organizations.getOrganization(scenario.organizationId);
  const resolution = computeAutoTefResolution(currentTefCatalogue(), catalogOutcomeId, organization);
  const stored = await repo.findLatestTefEstimate(riskScenarioId);
  if (stored && carriesSameEstimate(stored, resolution) && await keepStored(stored)) {
    return stored;
  }
  return persistTefEstimate(repo, riskScenarioId, resolution);
};

/**
 * Auto-mode read path: the latest persisted row, computed inline when none exists yet or when it was
 * read from another catalogue than the one the platform ships. Only a firmography save books a
 * recompute, so without the second case an upgrade would leave every scenario on its old catalogue;
 * with it, the next price pass moves every scenario it prices, and any other read the rest, the old
 * rows staying as history.
 */
const readOrComputeAutoTefEstimate = async (
  repo: CrqRepo,
  deps: AutoTefDeps,
  riskScenarioId: string,
  tenantId: string,
): Promise<TefEstimate> => {
  const existing = await repo.findLatestTefEstimate(riskScenarioId);
  const catalogue = currentTefCatalogue();
  return existing !== undefined && existing.catalogId === catalogue.id && existing.catalogVersion === catalogue.version
    ? existing
    : computeAndPersistAutoTefEstimate(repo, deps, riskScenarioId, tenantId);
};

const buildTefInputForSimulation = async (
  repo: CrqRepo,
  deps: AutoTefDeps,
  riskScenarioId: string,
  tefMode: TefMode,
  tenantId: string,
): Promise<TefInput | null> => {
  if (tefMode === 'auto') {
    const estimateRow = await readOrComputeAutoTefEstimate(repo, deps, riskScenarioId, tenantId);
    return { min: estimateRow.min, likely: estimateRow.likely, max: estimateRow.max };
  }
  const tefInputRow = await repo.findTefInput(riskScenarioId);
  return tefInputRow ? { min: tefInputRow.min, likely: tefInputRow.likely, max: tefInputRow.max } : null;
};

/** Sliced by time and not by world: a single world of a wide scenario runs for seconds. */
const ENGINE_SLICE_MS = 20;

/**
 * The organisation's declared reaction time, or the platform's seeded triplet where it declares
 * none. It is all-or-nothing on purpose: a partial triplet is not a distribution.
 */
const reactionTimeRangeOf = (
  declared: { min: number | null, likely: number | null, max: number | null } | undefined,
): PertRange => {
  if (declared?.min == null || declared.likely == null || declared.max == null) {
    return DEFAULT_REACTION_TIME_HOURS;
  }
  return { min: declared.min, likely: declared.likely, max: declared.max };
};

/** A run that stored its figures. */
export interface AttackRunEngineRun {
  runId: string,
  result: EngineRunResult,
  reach: AttackRunReachReport,
  /**
   * The ALE mean of the scenario's latest run before this one, read in the transaction that stored
   * it; null when there was none or it was unpriced. Only a pass that compares (`skipUnchanged`)
   * reads the latest run, so any other run answers null.
   */
  aleBefore: number | null,
  /** The ALE mean this run stored: null on an unpriced scenario, as the stored column. */
  aleAfter: number | null,
}

/** A scenario the engine deliberately did not price, and the answer a surface owes for it. */
export interface AttackRunEngineSkip {
  skipped: 'no-mapped-asset' | 'no-scenario' | 'unchanged' | 'same-result',
}

/**
 * The scenario-group constant when the walked estate held both matched and unmatched assets, and
 * one otherwise.
 *
 * The boost separates matched assets from the rest, so a run whose whole estate is matched, and one
 * whose estate holds no matched asset at all, are the same run as one with no boost. Reporting the
 * constant in either case would credit a target that changed nothing.
 */
const appliedScenarioGroupBoost = (
  counts: ReadonlyArray<{ count: number }>,
  scenarioGroupCounts: ReadonlyArray<{ count: number }>,
): number => {
  const walked = counts.reduce((sum, row) => sum + row.count, 0);
  const matched = scenarioGroupCounts.reduce((sum, row) => sum + row.count, 0);
  return matched > 0 && matched < walked ? SCENARIO_GROUP_BOOST_G : 1;
};

const annualLossFromRow = (row: typeof crqIndicatorRunAnnualLosses.$inferSelect | undefined): AnnualLossDistribution | null =>
  row === undefined ? null : {
    years: row.years,
    mean: row.mean,
    lossYearShare: row.lossYearShare,
    lossEventYearShare: row.lossEventYearShare,
    quantiles: row.probabilities.map((probability, index) => ({ probability, loss: row.losses[index] })),
  };

const annualLossColumns = (distribution: AnnualLossDistribution) => ({
  years: distribution.years,
  mean: distribution.mean,
  lossYearShare: distribution.lossYearShare,
  lossEventYearShare: distribution.lossEventYearShare,
  probabilities: distribution.quantiles.map((quantile) => quantile.probability),
  losses: distribution.quantiles.map((quantile) => quantile.loss),
});

const withoutInitialAccessOf = (catalogOutcomeId: string | undefined) => {
  const path = catalogOutcomeId === undefined ? undefined : PATHS_WITHOUT_INITIAL_ACCESS[catalogOutcomeId];
  return path === undefined ? undefined : { key: path.key, share: path.share, techniqueExternalIds: path.techniqueExternalIds };
};

/** Every row one engine run writes. The user-entered TEF inputs are read and never written. */
const engineRunRows = (params: {
  runId: string,
  jobId: string | null,
  readAt: Date,
  inputsFingerprint: string,
  riskScenarioId: string,
  result: EngineRunResult,
  reach: AttackRunReachReport,
  profile: CrqRunProfile,
  tef: PertRange | null,
  lossDriverCount: number,
  techniqueIdByExternalId: ReadonlyMap<string, string>,
  /** The scope version each plan held when the run read its targets, never the one it holds now. */
  planScopeVersionById: ReadonlyMap<string, number>,
  /** The budget review figures the run priced, each under the review version the run read. */
  reviewFigures: ReadonlyArray<ReviewFigureKey>,
  reviewExceedances: ReadonlyArray<ReviewExceedanceKey>,
  threatEvidence: { evidenceMode: OutcomeEvidenceMode },
  provenance: { estateMode: EstateMode, boostApplied: number },
  noTarget: boolean,
}): EngineRunRows => {
  const { result, reach } = params;
  /*
   * The techniques this run scored, read from the actors' results rather than from the
   * per-technique rows, which a run not computing them does not write. It is smaller than the
   * actors' resolved repertoires: a technique no capability of the catalogue can contest on any
   * family the estate holds leaves the run entirely, and counting it here would put a technique in
   * the header that appears in no row underneath it.
   */
  const scored = new Set(result.actors.flatMap((actor) => actor.playedTechniqueExternalIds));
  const techniqueCount = scored.size;
  const uncontestedByEstate = reach.uncontestedByEstate.filter((pair) => scored.has(pair.techniqueExternalId));
  /*
   * The engine returns exact zeros for a scenario with no TEF or no loss estimate. They are stored
   * as nulls: a zero euro reads as a priced scenario that costs nothing, which is a different claim.
   */
  const hasFrequency = params.tef !== null;
  const priced = hasFrequency && params.lossDriverCount > 0;
  const frequency = (value: number): number | null => (hasFrequency ? value : null);
  const euros = (value: number): number | null => (priced ? value : null);
  const priceable = (value: number): number | null => (params.lossDriverCount > 0 ? value : null);
  const run = {
    id: params.runId,
    jobId: params.jobId,
    readAt: params.readAt,
    inputsFingerprint: params.inputsFingerprint,
    riskScenarioId: params.riskScenarioId,
    iterations: result.worlds,
    vulnerabilityP5: result.vulnerability.p5,
    vulnerabilityP50: result.vulnerability.p50,
    vulnerabilityP95: result.vulnerability.p95,
    vulnerabilityMean: result.vulnerability.mean,
    lefMean: frequency(result.lef.mean),
    lefP10: frequency(result.lef.p10),
    lefP90: frequency(result.lef.p90),
    aleMean: euros(result.ale.mean),
    aleP10: euros(result.ale.p10),
    aleP90: euros(result.ale.p90),
    magnitudeMean: priceable(result.magnitude.mean),
    magnitudeP10: priceable(result.magnitude.p10),
    magnitudeP90: priceable(result.magnitude.p90),
    techniqueCount,
    coveredTechniqueCount: [...scored].filter((externalId) => reach.contestedTechniqueExternalIds.has(externalId)).length,
    threatEvidenceMode: params.threatEvidence.evidenceMode,
    admittedActorCount: reach.threatRelevance.admittedActorCount,
    outcomeBlocked: result.outcomes.blocked,
    outcomeEvicted: result.outcomes.evicted,
    outcomeImpactDetected: result.outcomes.impactDetected,
    outcomeImpactUndetected: result.outcomes.impactUndetected,
    pathShareStoppedAtInitialAccess: result.paths.stoppedAtInitialAccess,
    pathShareDirect: result.paths.direct,
    pathShareLong: result.paths.long,
    pathShareWithoutInitialAccess: result.paths.withoutInitialAccess,
    noTarget: params.noTarget,
    calibrationVintage: result.calibrationVintage,
    catalogueVintage: reach.catalogueVintage,
    unscannedAssetShare: reach.unscannedAssetShare,
    uncontestedPairCount: uncontestedByEstate.length,
    uncontestablePairCount: reach.uncontestableByCatalogue.length,
    aleAtMemorylessDetection: euros(result.calibration.memorylessAle),
    cornerConstants: [...result.calibration.cornerConstants],
    tefMin: params.tef?.min ?? null,
    tefLikely: params.tef?.likely ?? null,
    tefMax: params.tef?.max ?? null,
    unscannedAssetCount: reach.unscannedAssetCount,
    estateAssetCount: reach.estateAssetCount,
    declaredAssetCount: reach.declared?.assetCount ?? null,
    declaredAssetShare: reach.declared?.assetShare ?? null,
    estateMode: params.provenance.estateMode,
    boostApplied: params.provenance.boostApplied,
    profile: runProfileTokens(params.profile),
  };

  const annualLoss = priced ? { id: params.runId, runId: params.runId, ...annualLossColumns(result.annualLoss) } : null;

  const rowKeyByActor = new Map(result.actors.map((actor) => [actor.key, uuidv7()]));
  const groupScores = result.actors.map((actor) => ({
    id: uuidv7(),
    runId: params.runId,
    groupKey: rowKeyByActor.get(actor.key)!,
    groupName: actor.name,
    groupEntityType: null,
    share: actor.share,
    vulnerabilityP5: actor.vulnerability.p5,
    vulnerabilityP50: actor.vulnerability.p50,
    vulnerabilityP95: actor.vulnerability.p95,
    vulnerabilityMean: actor.vulnerability.mean,
    actorClass: actor.actorClass,
    aleMean: euros(actor.aleMean),
    attackRunDays: actor.attackRunDays,
    reactionTimeExceededShare: actor.reactionTimeExceededShare,
  }));

  const unplayableObstacles = result.actors.flatMap((actor) => actor.unplayableObstacleKeys.map((obstacleKey) => ({
    id: uuidv7(),
    runId: params.runId,
    groupKey: rowKeyByActor.get(actor.key)!,
    obstacleKey,
  })));

  const gapRows = (pairs: ReadonlyArray<{ techniqueExternalId: string, family: AssetCategory }>, gap: CrqReachGapKind) =>
    pairs.flatMap((pair) => {
      const mitreTechniqueId = params.techniqueIdByExternalId.get(pair.techniqueExternalId);
      return mitreTechniqueId === undefined ? [] : [{ id: uuidv7(), runId: params.runId, mitreTechniqueId, family: pair.family, gap }];
    });
  const reachGaps = [
    ...gapRows(uncontestedByEstate, 'estate'),
    ...gapRows(reach.uncontestableByCatalogue, 'catalogue'),
  ];

  const planWhatIfs = result.planValues.flatMap((plan) => {
    const planScopeVersion = params.planScopeVersionById.get(plan.planId);
    return planScopeVersion === undefined ? [] : [{
      id: uuidv7(),
      runId: params.runId,
      planId: plan.planId,
      planScopeVersion,
      aleReductionMean: euros(plan.aleReduction.mean),
      aleReductionP10: euros(plan.aleReduction.p10),
      aleReductionP90: euros(plan.aleReduction.p90),
    }];
  });

  const differenceByKey = new Map(result.basketDifferenceValues.map((difference) => [difference.key, difference.value]));
  const basketAnnualLossById = new Map(result.basketAnnualLosses.map((entry) => [entry.basketId, entry.annualLoss]));
  const annualLossAt = (basketId: string | null) => (basketId === null ? result.annualLoss : basketAnnualLossById.get(basketId));
  const reviewAnnualLosses = priced ? params.reviewExceedances.flatMap((exceedance) => {
    const reference = annualLossAt(exceedance.referenceBasketId);
    const withoutBuild = annualLossAt(exceedance.withoutBuildBasketId);
    if (reference === undefined || withoutBuild === undefined) {
      return [];
    }
    const row = (posture: BudgetReviewTolerancePosture, distribution: AnnualLossDistribution) => ({
      id: uuidv7(),
      runId: params.runId,
      reviewId: exceedance.reviewId,
      reviewVersion: exceedance.reviewVersion,
      posture,
      ...annualLossColumns(distribution),
    });
    return [row('reference', reference), row('without-build', withoutBuild)];
  }) : [];
  const budgetReviewResults = params.reviewFigures.flatMap((figure) => {
    const value = differenceByKey.get(figure.key);
    return value === undefined ? [] : [{
      id: uuidv7(),
      runId: params.runId,
      reviewId: figure.reviewId,
      reviewVersion: figure.reviewVersion,
      basket: figure.basket,
      lineId: figure.lineId,
      stepOn: figure.stepOn,
      aleReductionMean: euros(value.mean),
      aleReductionP10: euros(value.p10),
      aleReductionP90: euros(value.p90),
    }];
  });

  const controlWhatIfs = result.controlValues.flatMap((control) => control.levers.map((lever) => ({
    id: uuidv7(),
    runId: params.runId,
    controlId: control.controlId,
    controlKind: 'capability' as const,
    dimension: lever.dimension,
    currentStrength: control.declaredStrengthRung,
    upgradedStrength: lever.upgradedStrengthRung,
    currentCoverage: control.declaredCoverageBucket,
    upgradedCoverage: lever.upgradedCoverageBucket,
    aleReductionMean: euros(lever.aleReduction.mean),
    aleReductionP10: euros(lever.aleReduction.p10),
    aleReductionP90: euros(lever.aleReduction.p90),
    zeroReason: lever.zeroReason,
  })));

  const cveWhatIfs = result.cveValues.map((value) => ({
    id: uuidv7(),
    runId: params.runId,
    cveId: value.cveId,
    aleReductionMean: euros(value.aleReductionMean),
    aleReductionP10: euros(value.aleReductionP10),
    aleReductionP90: euros(value.aleReductionP90),
  }));

  const valueByTechnique = new Map<string, { prevent: number, detect: number }>();
  for (const entry of result.techniqueValues) {
    const held = valueByTechnique.get(entry.techniqueExternalId) ?? { prevent: 0, detect: 0 };
    valueByTechnique.set(entry.techniqueExternalId, {
      prevent: held.prevent + entry.preventValue,
      detect: held.detect + entry.detectValue,
    });
  }
  const techniqueWhatIfs = [...valueByTechnique].flatMap(([externalId, entry]) => {
    const mitreTechniqueId = params.techniqueIdByExternalId.get(externalId);
    return mitreTechniqueId === undefined ? [] : [{
      id: uuidv7(),
      runId: params.runId,
      mitreTechniqueId,
      preventValueMean: euros(entry.prevent),
      detectValueMean: euros(entry.detect),
    }];
  });

  return {
    priced,
    run,
    annualLoss,
    groupScores,
    unplayableObstacles,
    reachGaps,
    planWhatIfs,
    budgetReviewResults,
    budgetReviewAnnualLosses: reviewAnnualLosses,
    controlWhatIfs,
    cveWhatIfs,
    techniqueWhatIfs,
  };
};

const storeEngineRun = async (repo: CrqRepo, rows: EngineRunRows, resultFingerprint: string): Promise<void> => {
  await repo.insertRun({ ...rows.run, resultFingerprint });
  if (rows.annualLoss !== null) {
    await repo.insertAnnualLoss(rows.annualLoss);
  }
  await repo.insertGroupScores([...rows.groupScores]);
  await repo.insertUnplayableObstacles([...rows.unplayableObstacles]);
  await repo.insertReachGaps([...rows.reachGaps]);
  await repo.insertPlanWhatIfResults([...rows.planWhatIfs]);
  await repo.insertBudgetReviewResults([...rows.budgetReviewResults], [...rows.budgetReviewAnnualLosses]);
  await repo.insertWhatIfResults([...rows.controlWhatIfs]);
  await repo.insertCveWhatIfResults([...rows.cveWhatIfs]);
  await repo.insertTechniqueWhatIfResults([...rows.techniqueWhatIfs]);
};

interface EngineDeps {
  riskScenarios: ExtractPublicFromDef<typeof riskScenariosService>,
  organizations: ExtractPublicFromDef<typeof organizationsService>,
  attackOutcomes: ExtractPublicFromDef<typeof attackOutcomesService>,
  attackSurfaces: ExtractPublicFromDef<typeof attackSurfacesService>,
  crqIndicatorSettings: ExtractPublicFromDef<typeof crqIndicatorSettingsService>,
  scenarioLossEstimates: ExtractPublicFromDef<typeof scenarioLossEstimatesService>,
  cwe: ExtractPublicFromDef<typeof cweService>,
  budgetReviews: ExtractPublicFromDef<typeof budgetReviewsService>,
  declaredEstate: ExtractPublicFromDef<typeof declaredEstateService>,
}

export interface ScenarioPricingPass {
  priced: number,
  /** Scenarios whose latest run was computed from the very inputs this pass read. */
  unchanged: number,
  /** Scenarios whose inputs moved and whose result did not: the latest run stands for this pass too. */
  sameResult: number,
  skipped: number,
  refused: Array<{ riskScenarioId: string, reason: string }>,
  /**
   * The scenarios this pass wrote a new run for whose ALE mean moved, in the order it walked them:
   * a new run whose ALE mean equals the one before (its other figures moved) is counted in `priced`
   * and left out here, so a reader of `moved` never sees a zero delta. A scenario with no run
   * before, or no ALE on either side, is kept: its move is unknown, not nil.
   */
  moved: Array<string>,
  /** The ALE of each scenario of `moved`, in the same order. */
  movedAle: Array<ScenarioAleMove>,
  /** The scenarios this pass went through, refused ones included. */
  walked: number,
  /** The scenarios this pass had ahead of it when it started: everything after `after`. */
  total: number,
  /** The last scenario this pass went through when it stopped on its budget, null once it reached the end. */
  resumeAfter: string | null,
}

/**
 * How far one re-priced scenario's ALE mean moved: `aleBefore` is its latest run before the pass,
 * `aleAfter` the run the pass stored, each null when unpriced (or no run before), and `aleDelta`
 * after minus before, null when either side is.
 */
export interface ScenarioAleMove {
  riskScenarioId: string,
  aleBefore: number | null,
  aleAfter: number | null,
  aleDelta: number | null,
}

export interface ScenarioPricingPassProgress {
  walked: number,
  total: number,
}

/** How many scenarios a pass goes through between two progress reports. */
export const SCENARIO_PRICING_PROGRESS_EVERY = 25;

/**
 * How long every run of a scenario is kept; past it, a run goes once a later one of its UTC day
 * stands for it (`deleteExpiredRuns`). It is the longest window a page reads finer than a day: the
 * scenario's ALE history and ALE change explain, over a year.
 */
export const CRQ_RUN_DETAIL_RETENTION_DAYS = 366;

/** Each batch is its own statement, so the doorbells of a run and its cascaded rows are spread out. */
const RUN_PURGE_BATCH_SIZE = 200;
// Bounds one purge's own duration: a backlog deeper than this waits for the next day's run.
const MAX_RUN_PURGE_BATCHES = 50;

export interface RunPurgeLimits {
  batchSize: number,
  maxBatches: number,
}

export interface ScenarioPricingPassOptions {
  priceBudgetReviews?: boolean,
  appVersion?: string,
  after?: string,
  budgetMs?: number,
  /**
   * Called once the scenarios are listed, then every `SCENARIO_PRICING_PROGRESS_EVERY` scenarios.
   * The pass's own answer carries the final figures, so the caller reports the end itself.
   */
  onProgress?: (progress: ScenarioPricingPassProgress) => Promise<void>,
}

/**
 * Whether the scenario's latest run already answers a booking: computed from the inputs this one
 * read, with every figure family it asks for. A priced scenario's fingerprint leaves its plans out,
 * so a booking naming plans there is never answered: the plan scope it re-prices is not in it.
 */
const latestRunAnswers = async (
  repo: CrqRepo,
  riskScenarioId: string,
  inputsFingerprint: string,
  computed: CrqRunProfile,
  priceable: boolean,
): Promise<boolean> => {
  if (priceable && (computed.plans === 'all' || computed.plans.length > 0)) {
    return false;
  }
  const latest = await repo.findLatestRunByScenarioId(riskScenarioId);
  return latest?.inputsFingerprint === inputsFingerprint && runProfileCovers(latest.profile, computed);
};

/**
 * The attack run engine on a real tenant's scenario: it resolves the inputs, evaluates the law over
 * the drawn worlds and answers.
 *
 * The world loop hands the event loop back every `ENGINE_SLICE_MS`, inside a world as much as
 * between two. That discipline is invisible in the maths and it is the single most likely thing
 * to be lost in a rewrite: this executes inside a job worker whose lease is renewed by a timer in
 * the same process as the HTTP server, so a synchronous loop would drop the lease, be re-claimed
 * by another worker, and stall every request meanwhile.
 *
 * `signal` is read at that same yield point, and null says the run was abandoned before it wrote
 * anything: an aborted job whose engine kept turning would burn its worlds against the HTTP
 * server it shares the event loop with, then store a run for an attempt the runtime already
 * counted as over.
 *
 * The run computes its baseline and the what-ifs `profile` names, and stores the rows of those
 * alone. A scenario without a TEF or a loss estimate evaluates none of them, and runs as a full
 * run whatever it was booked for: the rows a cheaper profile skips would leave an older run's
 * euros on screen beside a headline that has none.
 *
 * `priceBudgetReviews` adds the scope's open budget reviews to the run.
 *
 * `appVersion` enters the run's fingerprint, so a release reprices what its code may price
 * differently. `skipUnchanged` answers `unchanged`, writing nothing, when the scenario's latest run
 * carries the fingerprint this one would. Past the engine, it answers `same-result` and stores no
 * run when the result equals the latest run's, a price run unless the scenario has no price: that
 * run takes this one's inputs fingerprint, so the next pass over the same inputs stops before the
 * engine, and keeps its moments, the result having held since them.
 *
 * `skipAnswered`, for a run an event booked, answers `unchanged` before the engine when the
 * scenario's latest run was computed from the same inputs and covers every family this one asks
 * for, so sequential event asks over unchanged inputs store no duplicate run.
 */
const runAttackRunEngine = async (
  { repo, deps, atomic }: ServiceContext<CrqRepo, EngineDeps>,
  riskScenarioId: string,
  tenantId: string,
  signal?: AbortSignal,
  profile: CrqRunProfile = FULL_RUN_PROFILE,
  jobId?: string,
  {
    priceBudgetReviews = false,
    appVersion,
    skipUnchanged = false,
    skipAnswered = false,
  }: { priceBudgetReviews?: boolean, appVersion?: string, skipUnchanged?: boolean, skipAnswered?: boolean } = {},
): Promise<AttackRunEngineRun | AttackRunEngineSkip | null> => {
  const readAt = new Date();
  const scenario = await deps.riskScenarios.getRiskScenarioPricingSubject(riskScenarioId);
  // A scenario deleted while its run sat in the queue is not a failure to retry or to
  // dead-letter: there is simply nothing left to price.
  if (!scenario) {
    return { skipped: 'no-scenario' };
  }
  /*
   * The estate is resolved here, once, and handed to the population reads: they join the mapping
   * they are given and never read the scope's mode, which is what lets a unit test price a fixed
   * set of assets.
   */
  const estate = await deps.organizations.resolveEstate(scenario.organizationId);
  if (estate === undefined) {
    throw new NonRetryableError('Cannot run the attack run engine: the scenario names no risk scope');
  }
  const declaredEstate = await deps.declaredEstate.getDeclaredEstateRows(scenario.organizationId);
  // A closed scope holding nothing and declaring nothing has no estate to price, and a run over zero
  // assets would read as a measured absence of risk rather than as an unanswered question.
  if (estate.mode === 'closed' && declaredEstate.length === 0 && !await deps.organizations.hasMappedAsset(estate.organizationId)) {
    return { skipped: 'no-mapped-asset' };
  }
  const outcome = await deps.attackOutcomes.getAttackOutcome(scenario.attackOutcomeId);
  const terminalTacticExternalId = outcome?.terminalTactic;
  if (!terminalTacticExternalId) {
    throw new NonRetryableError('Cannot run the attack run engine: the attack outcome declares no terminal tactic');
  }

  const outcomeTechniques = await deps.attackOutcomes.getMitreTechniquesForOutcome(
    scenario.attackOutcomeId,
    { organizationId: scenario.organizationId, tenantId },
  );
  if (outcomeTechniques.evidenceMode === 'mixture-pending') {
    throw new InputsNotReadyError('Cannot run the attack run engine: the attacker mixture of this outcome is not computed yet');
  }
  if (outcomeTechniques.mixtureGroups.length === 0) {
    throw new NonRetryableError('Cannot run the attack run engine: no actor was admitted for this outcome');
  }
  const settings = await deps.crqIndicatorSettings.getCrqIndicatorSettings();

  /*
   * The universe is the actors' whole observed repertoires, not the outcome's curated set. The
   * outcome fixes the terminal tactic and the walk decides what plays where, so a run restricted
   * to the curated set has every obstacle before the objective unplayable.
   */
  const analysisIds = outcomeTechniques.mixtureGroups.map((group) => group.groupKey);
  const [primaryAssetIds, actorClasses, actorCves, actorTechniques] = await Promise.all([
    repo.findScenarioPrimaryAssetIds(riskScenarioId),
    repo.findActorClassesByAnalysisIds(analysisIds),
    repo.findActorCveExternalIds(analysisIds),
    repo.findActorTechniqueExternalIds(analysisIds),
  ]);
  const withoutInitialAccess = withoutInitialAccessOf(outcomeCatalogId(tenantId, scenario.attackOutcomeId));
  const repertoireRows = await repertoireTechniquesOf(repo, actorTechniques, withoutInitialAccess?.techniqueExternalIds);
  const externalIdByTechniqueId = new Map(repertoireRows.map((row) => [row.id, row.externalId]));
  const techniqueIds = repertoireRows.map((row) => row.id);

  const applicablePairs = await deps.attackSurfaces.getApplicablePairsForTechniques(techniqueIds, { tenantId });
  const applicableFamiliesByTechnique = new Map<string, Array<AssetCategory>>();
  for (const pair of applicablePairs) {
    const externalId = externalIdByTechniqueId.get(pair.mitreTechniqueId);
    if (externalId === undefined) {
      continue;
    }
    applicableFamiliesByTechnique.set(externalId, [...(applicableFamiliesByTechnique.get(externalId) ?? []), pair.categoryId]);
  }
  const categoryIds = [...new Set(applicablePairs.map((pair) => pair.categoryId))];
  const noReview: ReviewPricing = { baskets: [], differences: [], figures: [], exceedances: [] };
  const [controls, reviewPricing] = await Promise.all([
    repo.findAttackRunControlInputs(techniqueIds, tenantId, scenario.organizationId),
    priceBudgetReviews ? deps.budgetReviews.getBudgetReviewPricing(scenario.organizationId) : Promise.resolve(noReview),
  ]);

  const classByAnalysisId = new Map(actorClasses.map((row) => [row.analysisId, resolveEffectiveActorClass(row)]));
  const cvesByAnalysisId = new Map<string, Set<string>>();
  for (const row of actorCves) {
    cvesByAnalysisId.set(row.analysisId, (cvesByAnalysisId.get(row.analysisId) ?? new Set()).add(row.cveExternalId));
  }
  const repertoireByAnalysisId = new Map<string, Set<string>>();
  for (const row of actorTechniques) {
    const held = repertoireByAnalysisId.get(row.analysisId) ?? new Set<string>();
    held.add(foldToParentTechnique(row.techniqueExternalId));
    repertoireByAnalysisId.set(row.analysisId, held);
  }
  const [counts, scenarioGroupCounts, actorCveClaims, unscannedAssetCount, doorCounts, entryOpenings, primaryUsers, tef, lossEstimates, reactionTime] = await Promise.all([
    repo.findEstateCountsByCategoryExposureAndCriticality(categoryIds, tenantId, estate),
    repo.findScenarioGroupCountsByCategoryExposureAndCriticality(categoryIds, tenantId, primaryAssetIds, estate),
    repo.findActorCveClaimsOnAssets(categoryIds, tenantId, [...new Set(actorCves.map((row) => row.cveExternalId))], primaryAssetIds, estate),
    repo.findUnscannedAssetCount(categoryIds, tenantId, estate),
    repo.findDoorEstateCounts(tenantId, estate, primaryAssetIds),
    repo.findEntryOpenings(tenantId, estate, primaryAssetIds),
    repo.findPrimaryUsers(tenantId, estate, primaryAssetIds),
    buildTefInputForSimulation(repo, deps, riskScenarioId, scenario.tefMode, tenantId),
    deps.scenarioLossEstimates.getScenarioLossEstimates(riskScenarioId, true),
    repo.findOrganizationReactionTime(scenario.organizationId),
  ]);
  const weaknessLink = await deps.cwe.getEffectiveTechniques(tenantId, actorCveClaims.flatMap((row) => row.cwe ?? []));
  const priceable = tef !== null && lossEstimates.length > 0;
  const computed = priceable ? profile : FULL_RUN_PROFILE;
  const planTargets = computed.plans === 'all' || computed.plans.length > 0
    ? (await repo.findTreatmentPlanTargets(scenario.organizationId)).filter((plan) => computesSubject(computed.plans, plan.planId))
    : [];

  const { inputs, reach } = await resolveAttackRunInputs({
    terminalTacticExternalId,
    applicableFamiliesByTechnique,
    mixture: outcomeTechniques.mixtureGroups.map((group) => ({
      groupKey: group.groupKey,
      name: group.name,
      share: group.share,
      techniqueExternalIds: [...(repertoireByAnalysisId.get(group.groupKey) ?? new Set<string>())],
      actorClass: classByAnalysisId.get(group.groupKey) ?? DEFAULT_ACTOR_CLASS,
      cveExternalIds: cvesByAnalysisId.get(group.groupKey) ?? new Set<string>(),
    })),
    controls,
    plans: planTargets.map(({ planId, moves }) => ({ planId, moves })),
    baskets: reviewPricing.baskets,
    basketDifferences: reviewPricing.differences,
    annualLossBaskets: annualLossBasketsOf(reviewPricing.exceedances),
    estate: {
      counts,
      scenarioGroupCounts,
      routes: actorCveRoutes(actorCveClaims, weaknessLink),
      unscannedAssetCount,
      door: { counts: doorCounts, openings: entryOpenings, primaryUsers },
      ...(declaredEstate.length === 0 ? {} : { declared: completeDeclaredEstate(declaredEstate, doorCounts, settings.unknownExposureCountsAs) }),
    },
    phishing: { declaredSusceptibility: freshPhishingFailureRate(settings, readAt) },
    unknownExposureCountsAs: settings.unknownExposureCountsAs,
    unknownCriticalityCountsAs: settings.unknownCriticalityCountsAs,
    withoutInitialAccess,
    tef,
    lossDrivers: lossEstimates.map((lossEstimate) => ({ min: lossEstimate.minValue!, likely: lossEstimate.likelyValue!, max: lossEstimate.maxValue! })),
    reactionTimeHours: reactionTimeRangeOf(reactionTime),
    worlds: Math.min(settings.iterations, MAX_CRQ_ITERATIONS),
    seed: riskScenarioId,
    threatRelevance: {
      evidenceMode: outcomeTechniques.evidenceMode,
      admittedActorCount: outcomeTechniques.mixtureGroups.length,
    },
    computesCveWhatIfs: computed.cves,
  });

  const engineInputs = {
    ...inputs,
    whatIfs: {
      techniques: computed.techniques,
      cves: computed.cves,
      leverControlIds: computed.levers === 'all' ? 'all' as const : new Set(computed.levers),
    },
  };
  const techniqueIdByExternalId = new Map(repertoireRows.map((row) => [row.externalId, row.id]));
  const planScopeVersionById = new Map(planTargets.map((plan) => [plan.planId, plan.scopeVersion]));
  const provenance = { estateMode: estate.mode, boostApplied: appliedScenarioGroupBoost(counts, scenarioGroupCounts) };
  // A target no door technique applies to leaves no trace in the door, so the fingerprint takes the flag itself.
  const noTarget = !doorCounts.some((row) => row.target);
  /*
   * The fingerprint covers what every run computes alike whatever its profile, so the price pass
   * writes nothing after a full run over the same inputs. A scenario that is not priceable
   * runs in full, so its plans enter it: a moved plan is a row the next run writes.
   */
  const { plans: planInputs, baseline } = fingerprintedBaseline(inputs);
  const inputsFingerprint = fingerprintOf({
    appVersion: appVersion ?? null,
    baseline,
    reach,
    lossDriverCount: lossEstimates.length,
    techniqueIdByExternalId,
    evidenceMode: outcomeTechniques.evidenceMode,
    provenance,
    noTarget,
    ...(priceable ? {} : { plans: planInputs, planScopeVersionById }),
  });
  if (skipUnchanged && (await repo.findLatestRunByScenarioId(riskScenarioId))?.inputsFingerprint === inputsFingerprint) {
    return { skipped: 'unchanged' };
  }
  if (skipAnswered && await latestRunAnswers(repo, riskScenarioId, inputsFingerprint, computed, priceable)) {
    return { skipped: 'unchanged' };
  }

  const run = createEngineRun(engineInputs);
  while (!run.done()) {
    if (signal?.aborted === true) {
      return null;
    }
    const sliceEnd = performance.now() + ENGINE_SLICE_MS;
    run.advanceUntil(() => performance.now() >= sliceEnd);
    await yieldToEventLoop();
  }
  const result = run.result();

  const runId = uuidv7();
  const rows = engineRunRows({
    runId,
    jobId: jobId ?? null,
    readAt,
    inputsFingerprint,
    riskScenarioId,
    result,
    reach,
    profile: computed,
    tef,
    lossDriverCount: lossEstimates.length,
    techniqueIdByExternalId,
    planScopeVersionById,
    reviewFigures: reviewPricing.figures,
    reviewExceedances: reviewPricing.exceedances,
    threatEvidence: { evidenceMode: outcomeTechniques.evidenceMode },
    provenance,
    noTarget,
  });
  const resultFingerprint = resultFingerprintOf(rows, appVersion ?? null);
  const stored = await atomic(async ({ repo: atomicRepo }) => {
    // Read in the transaction that stores, so a run stored while the engine turned is the one compared.
    const latest = skipUnchanged ? await atomicRepo.findLatestRunByScenarioId(riskScenarioId) : undefined;
    // A latest run holding figure families dates them current. A priced run's digest leaves its
    // families out, so it stands for this pass only once a price run already dates them older.
    if (latest !== undefined && latest.resultFingerprint === resultFingerprint && (!rows.priced || latest.profile.length === 0)) {
      await atomicRepo.updateRunInputsFingerprint(latest.id, inputsFingerprint);
      return null;
    }
    await storeEngineRun(atomicRepo, rows, resultFingerprint);
    return { aleBefore: latest?.aleMean ?? null };
  });
  return stored ? { runId, result, reach, ...stored, aleAfter: rows.run.aleMean ?? null } : { skipped: 'same-result' };
};

// ─── Service ─────────────────────────────────────────────────────────────────

export const crqIndicatorsService = defineService(
  'crqIndicators',
  crqIndicatorsRepository,
).dependsOn(() => [
  crqIndicatorSettingsService,
  attackOutcomesService,
  attackSurfacesService,
  scenarioLossEstimatesService,
  riskScenariosService,
  organizationsService,
  cweService,
  sectorsService,
  countriesService,
  budgetReviewsService,
  declaredEstateService,
]).implement({
  getScenariosPricedAgainstCapabilities: async (
    { repo, deps },
    capabilityIds: Array<string>,
    organizationId: string,
    tenantId: string,
  ): Promise<Array<ScenarioControls>> => scenariosPricedAgainst(repo, deps, new Set(capabilityIds), organizationId, tenantId),

  /**
   * The scenarios a tenant-level posture move reprices, across every scope: a scope whose own
   * declaration pins every axis that moved still prices the control at its own rung and is left out.
   */
  getScenariosRepricedByCrossings: async (
    { repo, deps },
    crossings: ReadonlyArray<PostureCrossing>,
    tenantId: string,
  ): Promise<Array<ScenarioControls>> => {
    if (crossings.length === 0) {
      return [];
    }
    const [organizationIds, overrides] = await Promise.all([
      repo.findOrganizationIds(),
      repo.findScopeOverridesOfCapabilities(crossings.map((crossing) => crossing.capabilityId)),
    ]);
    const overrideOf = new Map(overrides.map((row) => [`${row.organizationId}|${row.capabilityId}`, row]));
    const priced: Array<ScenarioControls> = [];
    for (const organizationId of organizationIds) {
      const moved = new Set(crossings
        .filter((crossing) => crossingRepricesScope(crossing, organizationId, (axis) =>
          (pinnedBy(overrideOf.get(`${organizationId}|${crossing.capabilityId}`), axis) ?? null) !== null))
        .map((crossing) => crossing.capabilityId));
      priced.push(...await scenariosPricedAgainst(repo, deps, moved, organizationId, tenantId));
    }
    return priced;
  },

  runAttackRunEngine,

  /**
   * The price profile on every scenario of the tenant, one after the other. A scenario the engine
   * refuses for a state of its inputs (no risk scope, no admitted actor) is passed over: the write
   * that settles that state wakes the next pass.
   *
   * `jobId` means what it does for `runAttackRunEngine`. Null says the pass
   * was abandoned mid-way. A pass past its budget stops between two scenarios, never before the
   * first, so a chain of resumed passes always moves forward.
   */
  priceAllScenarios: async (
    context,
    tenantId: string,
    signal?: AbortSignal,
    jobId?: string,
    { after, budgetMs, onProgress, ...engineOptions }: ScenarioPricingPassOptions = {},
  ): Promise<ScenarioPricingPass | null> => {
    const startedAtMs = Date.now();
    const riskScenarioIds = await context.deps.riskScenarios.getAllRiskScenarioIds(after);
    const pass: ScenarioPricingPass = {
      priced: 0, unchanged: 0, sameResult: 0, skipped: 0, refused: [], moved: [], movedAle: [], walked: 0, total: riskScenarioIds.length, resumeAfter: null,
    };
    await onProgress?.({ walked: 0, total: pass.total });
    let previous: string | undefined;
    for (const riskScenarioId of riskScenarioIds) {
      // The engine reads the signal only once it turns, and a scenario whose inputs did not move
      // returns before it: a pass of unchanged scenarios would otherwise walk to its end.
      if (signal?.aborted === true) {
        return null;
      }
      if (previous !== undefined && budgetMs !== undefined && Date.now() - startedAtMs >= budgetMs) {
        pass.resumeAfter = previous;
        return pass;
      }
      if (pass.walked > 0 && pass.walked % SCENARIO_PRICING_PROGRESS_EVERY === 0) {
        await onProgress?.({ walked: pass.walked, total: pass.total });
      }
      try {
        const outcome = await runAttackRunEngine(
          context,
          riskScenarioId,
          tenantId,
          signal,
          PRICE_RUN_PROFILE,
          jobId,
          { ...engineOptions, skipUnchanged: true },
        );
        if (outcome === null) {
          return null;
        }
        if ('skipped' in outcome) {
          if (outcome.skipped === 'unchanged') {
            pass.unchanged += 1;
          } else if (outcome.skipped === 'same-result') {
            pass.sameResult += 1;
          } else {
            pass.skipped += 1;
          }
        } else {
          pass.priced += 1;
          const { aleBefore, aleAfter } = outcome;
          const aleDelta = aleBefore === null || aleAfter === null ? null : aleAfter - aleBefore;
          if (aleDelta !== 0) {
            pass.moved.push(riskScenarioId);
            pass.movedAle.push({ riskScenarioId, aleBefore, aleAfter, aleDelta });
          }
        }
      } catch (error) {
        if (!(error instanceof NonRetryableError)) {
          throw error;
        }
        pass.refused.push({ riskScenarioId, reason: error.message });
      }
      pass.walked += 1;
      previous = riskScenarioId;
    }
    return pass;
  },

  /** Purges the tenant's runs past `CRQ_RUN_DETAIL_RETENTION_DAYS` that no reader needs, and answers how many went. */
  purgeExpiredRuns: async (
    { repo },
    now: Date,
    { batchSize, maxBatches }: RunPurgeLimits = { batchSize: RUN_PURGE_BATCH_SIZE, maxBatches: MAX_RUN_PURGE_BATCHES },
  ): Promise<{ runsDeleted: number }> => {
    const before = new Date(now.getTime() - CRQ_RUN_DETAIL_RETENTION_DAYS * DAY_MS);
    let runsDeleted = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const deleted = await repo.deleteExpiredRuns(before, batchSize);
      runsDeleted += deleted;
      if (deleted < batchSize) {
        break;
      }
    }
    return { runsDeleted };
  },

  getLatestRun: async ({ repo }, riskScenarioId: string) =>
    await repo.findLatestRunByScenarioId(riskScenarioId),

  /**
   * Levers read from several runs are dated by the oldest that still supplies one of the rows
   * `getWhatIfResults` reads. Ages compare run ids, since a timestamp read back into JavaScript
   * loses its microseconds.
   */
  getFigureFamilyDates: async ({ repo }, riskScenarioId: string): Promise<FigureFamilyDates | undefined> => {
    const latest = await repo.findLatestRunByScenarioId(riskScenarioId);
    if (!latest) {
      return undefined;
    }
    const [leverRuns, cveRun, techniqueRunId] = await Promise.all([
      repo.findFamilyRunsByScenarioIds('levers', [riskScenarioId]),
      findCveFamilyRun(repo, riskScenarioId),
      repo.findTechniqueSourceRunId(latest.id),
    ]);
    const { owns, runIds } = familyRunOwnership(leverRuns, 'levers');
    const supplying = new Set((await repo.findWhatIfResultsByRunIds([...runIds]))
      .filter((row) => owns(row.runId, row.controlId))
      .map((row) => row.runId));
    const oldestLeverRunId = leverRuns.filter((run) => supplying.has(run.runId))
      .toSorted((one, other) => other.rank - one.rank).at(0)?.runId;
    const [oldestLeverRun, techniqueRun] = await Promise.all([
      oldestLeverRunId === undefined ? undefined : repo.findRunById(oldestLeverRunId),
      techniqueRunId === undefined ? undefined : repo.findRunById(techniqueRunId),
    ]);
    const dated = (run: { id: string, createdAt: Date } | undefined): FigureFamilyDate | null =>
      (run === undefined ? null : { computedAt: run.createdAt, olderThanHeadline: run.id !== latest.id });
    return {
      headlineAt: latest.createdAt,
      levers: dated(oldestLeverRun),
      techniques: dated(techniqueRun),
      cves: dated(cveRun),
    };
  },

  /**
   * Where the gain of each CVE is read from: the run dated as the `cves` family is, and, when that run
   * predates the headline, the CVEs a run would price today, which tell a CVE no row exists for
   * because it was never priced from one that changed since. `mixturePending` says the job has not
   * stored the scenario's attacker mixture yet, whatever run the scenario has.
   */
  getCveGainSource: async (
    { repo, deps, eventOrigin },
    riskScenarioId: string,
  ): Promise<{ run: CveGainSource & { id: string, createdAt: Date } | null, pricedNow: Set<string>, baselineAle: number | null, mixturePending: boolean }> => {
    const tenantId = requireTenantId(eventOrigin);
    const [latest, run, scenario] = await Promise.all([
      repo.findLatestRunByScenarioId(riskScenarioId),
      findCveFamilyRun(repo, riskScenarioId),
      deps.riskScenarios.getRiskScenarioPricingSubject(riskScenarioId),
    ]);
    const mixturePending = scenario !== undefined
      && await deps.attackOutcomes.isAttackerMixturePending(scenario.attackOutcomeId, { organizationId: scenario.organizationId, tenantId });
    const baselineAle = latest?.aleMean ?? null;
    if (latest === undefined || run === undefined) {
      return { run: null, pricedNow: new Set(), baselineAle, mixturePending };
    }
    const source = { id: run.id, createdAt: run.createdAt, olderThanHeadline: run.id !== latest.id, withoutAle: run.aleMean === null };
    if (!source.olderThanHeadline || source.withoutAle) {
      return { run: source, pricedNow: new Set(), baselineAle, mixturePending };
    }
    const estate = scenario === undefined ? undefined : await deps.organizations.resolveEstate(scenario.organizationId);
    if (scenario === undefined || estate === undefined) {
      return { run: source, pricedNow: new Set(), baselineAle, mixturePending };
    }
    const { mixtureGroups } = await deps.attackOutcomes.getMitreTechniquesForOutcome(
      scenario.attackOutcomeId,
      { organizationId: scenario.organizationId, tenantId },
    );
    const actorCves = await repo.findActorCveExternalIds(mixtureGroups.map((group) => group.groupKey));
    const [{ unknownExposureCountsAs }, openings, cited] = await Promise.all([
      deps.crqIndicatorSettings.getCrqIndicatorSettings(),
      repo.findThreateningOpenings(tenantId, estate),
      repo.findCveIdsOnApplicableFindings(tenantId, estate, [...new Set(actorCves.map((row) => row.cveExternalId))]),
    ]);
    return {
      run: source,
      pricedNow: new Set([...cveIdsPricedAtTheDoor(openings, unknownExposureCountsAs), ...cited]),
      baselineAle,
      mixturePending,
    };
  },

  /**
   * The risk scenarios whose scope carries a CVE on an applicable finding, each with its annual loss
   * and what fixing the CVE is worth there, and the actors citing the CVE among their mixtures.
   * `cveId` is the `cve` row id and `estates` those holding it on an applicable finding, read from the
   * finding score by the caller; `scopeOrganizationId` is the scope the page sits in, open or closed,
   * null for the whole tenant. Every read is one statement over all scenarios, over their scopes or over
   * their (attack outcome, scope) pairs, never one per scenario.
   */
  getCveScenarioGains: async (
    { repo, deps, eventOrigin },
    params: {
      cveId: string,
      cveExternalId: string,
      estates: Array<{ organizationId: string | null }>,
      scopeOrganizationId: string | null,
    },
  ): Promise<CveScenarioGains> => {
    const tenantId = requireTenantId(eventOrigin);
    const { cveExternalId, estates } = params;
    if (estates.length === 0) {
      return NO_CVE_SCENARIO_GAINS;
    }
    const listed = await deps.riskScenarios.getRiskScenariosInScopes({
      closedOrganizationIds: estates.flatMap((estate) => estate.organizationId ?? []),
      includeOpenScopes: estates.some((estate) => estate.organizationId === null),
      onlyOrganizationId: params.scopeOrganizationId,
    });
    if (listed.length === 0) {
      return NO_CVE_SCENARIO_GAINS;
    }
    const scenarioIds = listed.map((scenario) => scenario.id);

    const [latestRuns, sourceRunIds] = await Promise.all([
      repo.findLatestRunsByScenarioIds(scenarioIds),
      findCveFamilyRunIds(repo, scenarioIds),
    ]);
    const latestByScenarioId = new Map(latestRuns.map((run) => [run.riskScenarioId, run]));
    const distinctSourceRunIds = [...new Set(sourceRunIds.values())];
    const [whatIfRows, sourceRuns] = await Promise.all([
      repo.findCveWhatIfRowsByRunIds(distinctSourceRunIds, params.cveId),
      repo.findRunSourcesByIds(distinctSourceRunIds),
    ]);
    const whatIfByRunId = new Map(whatIfRows.map((row) => [row.runId, row]));
    const sourceRunById = new Map(sourceRuns.map((run) => [run.runId, run]));

    const pairOf = (scenario: { attackOutcomeId: string, organizationId: string }) => `${scenario.attackOutcomeId}/${scenario.organizationId}`;
    const citedByPair = new Map<string, boolean>();
    const pendingPairs = new Set<string>();
    const analysisIdsByPair = new Map(await Promise.all([...Map.groupBy(listed, pairOf)].map(async ([pair, [{ attackOutcomeId, organizationId }]]) => {
      const { mixtureGroups, evidenceMode } = await deps.attackOutcomes.getMitreTechniquesForOutcome(attackOutcomeId, { organizationId, tenantId });
      if (evidenceMode === 'mixture-pending') {
        pendingPairs.add(pair);
      }
      return [pair, mixtureGroups.map((group) => group.groupKey)] as const;
    })));
    const citing = new Set(
      (await repo.findActorCveExternalIds([...new Set([...analysisIdsByPair.values()].flat())]))
        .filter((row) => row.cveExternalId === cveExternalId)
        .map((row) => row.analysisId),
    );
    const citingAnalysisIds = new Set<string>();
    for (const [pair, analysisIds] of analysisIdsByPair) {
      const cited = analysisIds.filter((analysisId) => citing.has(analysisId));
      cited.forEach((analysisId) => citingAnalysisIds.add(analysisId));
      citedByPair.set(pair, cited.length > 0);
    }

    const sourceOf = (scenarioId: string) => {
      const sourceRunId = sourceRunIds.get(scenarioId);
      const run = sourceRunId === undefined ? undefined : sourceRunById.get(sourceRunId);
      const source = run === undefined
        ? null
        : { olderThanHeadline: run.runId !== latestByScenarioId.get(scenarioId)?.runId, withoutAle: run.aleMean === null, createdAt: run.createdAt };
      return { row: run === undefined ? undefined : whatIfByRunId.get(run.runId), source };
    };

    const scopesToRead = new Set(listed
      .filter((scenario) => {
        const { row, source } = sourceOf(scenario.id);
        return source !== null && source.olderThanHeadline && !source.withoutAle && row?.mean == null;
      })
      .map((scenario) => scenario.organizationId));
    const pricedNowByScope = new Map<string, { threatening: boolean, onApplicable: boolean }>();
    const { unknownExposureCountsAs } = await deps.crqIndicatorSettings.getCrqIndicatorSettings();
    await Promise.all([...scopesToRead].map(async (organizationId) => {
      const estate = await deps.organizations.resolveEstate(organizationId);
      if (estate === undefined) {
        return;
      }
      const [openings, onApplicable] = await Promise.all([
        repo.findThreateningOpenings(tenantId, estate, [params.cveId]),
        repo.findCveIdsOnApplicableFindings(tenantId, estate, [cveExternalId]),
      ]);
      pricedNowByScope.set(organizationId, { threatening: cveIdsPricedAtTheDoor(openings, unknownExposureCountsAs).length > 0, onApplicable: onApplicable.length > 0 });
    }));

    const scenarios = listed.map((scenario): CveScenarioGain => {
      const { row, source } = sourceOf(scenario.id);
      const priced = pricedNowByScope.get(scenario.organizationId);
      const latest = latestByScenarioId.get(scenario.id);
      return {
        id: scenario.id,
        name: scenario.name,
        organizationId: scenario.organizationId,
        aleMean: latest?.aleMean ?? null,
        aleP10: latest?.aleP10 ?? null,
        aleP90: latest?.aleP90 ?? null,
        noMappedAsset: scenario.noMappedAsset,
        gain: cveGainState({
          row: row?.mean == null ? null : { mean: row.mean, p10: row.p10, p90: row.p90 },
          source,
          pricedNow: priced !== undefined && (priced.threatening || (priced.onApplicable && citedByPair.get(pairOf(scenario)) === true)),
        }),
        olderThanHeadline: source?.olderThanHeadline ?? false,
        computedAt: source?.createdAt ?? null,
        mixturePending: pendingPairs.has(pairOf(scenario)),
      };
    }).sort(compareCveScenarioGains);

    return {
      actorCount: citingAnalysisIds.size,
      citedScenarioCount: listed.filter((scenario) => citedByPair.get(pairOf(scenario)) === true).length,
      totalAle: scenarios.reduce((total, scenario) => total + (scenario.aleMean ?? 0), 0),
      scenarios,
    };
  },

  /**
   * Its technique values come from the latest run that computed them, up to this one, returned as
   * `techniqueSource`: a value reads as a share of that run's exposure, not of this one's.
   */
  getRunWithScores: async ({ repo }, runId: string) => {
    const run = await repo.findRunById(runId);
    if (!run) {
      return undefined;
    }
    const techniqueSourceRunId = await repo.findTechniqueSourceRunId(run.id);
    const techniqueSource = techniqueSourceRunId === undefined ? null : (await repo.findRunById(techniqueSourceRunId)) ?? null;
    const [groupScores, techniqueWhatIfResults, reachGaps, unplayableObstacles, annualLoss] = await Promise.all([
      repo.findGroupScoresByRunId(run.id),
      techniqueSourceRunId === undefined ? [] : repo.findTechniqueWhatIfResultsByRunId(techniqueSourceRunId),
      repo.findReachGapsByRunId(run.id),
      repo.findUnplayableObstaclesByRunId(run.id),
      repo.findAnnualLossByRunId(run.id),
    ]);
    return {
      ...run,
      groupScores,
      techniqueWhatIfResults,
      techniqueSource,
      reachGaps,
      unplayableObstacles,
      annualLoss: annualLossFromRow(annualLoss),
    };
  },

  getTefInput: async ({ repo }, riskScenarioId: string) =>
    await repo.findTefInput(riskScenarioId),

  getScopeScenarioTefs: async ({ repo }, organizationId: string) =>
    (await repo.findScopeScenarioTefs(organizationId)).map(({ estimate, ...scenario }) => ({
      ...scenario,
      read: estimate === null ? null : estimateReadOf(estimate),
    })),

  upsertTefInput: async ({ repo }, values: { riskScenarioId: string, min: number, likely: number, max: number }) =>
    repo.upsertTefInput(values),

  /** Recomputes now — the firmography-change job, the switch back to auto and the "first auto read". */
  resolveAutoTef: async ({ repo, deps }, riskScenarioId: string, tenantId: string): Promise<TefEstimate> =>
    computeAndPersistAutoTefEstimate(repo, deps, riskScenarioId, tenantId),

  getAutoTefEstimate: async ({ repo, deps }, riskScenarioId: string, tenantId: string): Promise<TefEstimateWithRead> =>
    withReadOf(await readOrComputeAutoTefEstimate(repo, deps, riskScenarioId, tenantId)),

  getTefCatalog: async ({ deps }, tenantId: string): Promise<TefCatalogOverview> => {
    const catalogue = currentTefCatalogue();
    const [outcomeRows, sectorRows, countryRows] = await Promise.all([
      deps.attackOutcomes.getAttackOutcomes(),
      deps.sectors.getSectors(),
      deps.countries.getCountries(),
    ]);
    return {
      id: catalogue.id,
      version: catalogue.version,
      builtOn: catalogue.builtOn,
      publisher: catalogue.publisher,
      sources: catalogue.sources.map((source) => ({ ...source })),
      sizeClasses: [...TEF_SIZE_CLASSES],
      outcomes: catalogueOutcomesOf(outcomeRows, tenantId).map(({ outcome }) => ({ id: outcome.id, name: outcome.name })),
      sectors: sectorRows.toSorted(byName).map((sector) => ({ id: sector.id, name: sector.name, measured: catalogue.sectors.has(sector.name) })),
      countries: countryRows.toSorted(byName).map((country) => ({
        id: country.id,
        name: country.name,
        isoAlpha3: country.isoAlpha3,
        readAs: catalogue.countries.has(country.isoAlpha2) ? country.isoAlpha2 : TEF_ANY,
      })),
      revenueBands: REVENUE_BAND_VALUES.map((revenueBand) => ({ revenueBand, sizeClasses: revenueBandSizeClasses(revenueBand) })),
    };
  },

  /** A profile's read for every outcome, the same rule an auto estimate reads, so the simulator and a scope agree. */
  getTefCatalogReading: async ({ deps }, profile: TefCatalogProfile, tenantId: string): Promise<TefCatalogReading> => {
    const read = await catalogueReader(deps, tenantId);
    return read(profile);
  },

  /** Every risk scope's read, for the screen comparing them, in one call rather than one per scope. */
  getTefCatalogScopeReadings: async ({ deps }, tenantId: string): Promise<Array<TefScopeReading>> => {
    const [read, organizations] = await Promise.all([catalogueReader(deps, tenantId), deps.organizations.getOrganizationProfiles()]);
    return organizations.map((organization) => ({ organizationId: organization.id, ...read(organization) }));
  },

  // Falls back to the column's own default, so a scenario this origin cannot read does not report
  // the one mode no new scenario carries.
  getTefMode: async ({ deps }, riskScenarioId: string): Promise<TefMode> =>
    await deps.riskScenarios.getTefMode(riskScenarioId) ?? 'auto',

  /**
   * Returning to auto recomputes: the firmography recompute job skips a scenario while it is
   * manual, so the row it left behind can be arbitrarily old.
   */
  setTefMode: async ({ repo, deps }, riskScenarioId: string, tefMode: TefMode, tenantId: string): Promise<void> => {
    const current = await deps.riskScenarios.getTefMode(riskScenarioId);
    if (current === undefined || current === tefMode) {
      return;
    }
    await deps.riskScenarios.setTefMode(riskScenarioId, tefMode);
    if (tefMode === 'auto') {
      await computeAndPersistAutoTefEstimate(repo, deps, riskScenarioId, tenantId, async (stored) => {
        // The scenario may have run on a hand-entered triplet while it was away, and the estimate
        // it returns to is then a frequency that run never saw.
        const latestRun = await repo.findLatestRunByScenarioId(riskScenarioId);
        return latestRun === undefined || sampledEstimate(latestRun, stored);
      });
      return;
    }
    // Leaving auto hands the analyst the frequency it reached, ready to edit. It is stamped with
    // when the estimate came into force and not with the switch, or a run that already sampled
    // those very values would read as predating them.
    const reached = await readOrComputeAutoTefEstimate(repo, deps, riskScenarioId, tenantId);
    await repo.upsertTefInput({
      riskScenarioId,
      min: roundToDisplayedPrecision(reached.min),
      likely: roundToDisplayedPrecision(reached.likely),
      max: roundToDisplayedPrecision(reached.max),
      updatedAt: reached.createdAt,
    });
  },

  /** The newest `RUN_HISTORY_LIMIT` runs, newest first: the whole history is `listRunHistory`'s, a page at a time. */
  getRunHistory: async ({ repo }, riskScenarioId: string) =>
    repo.findRunHistoryPage(riskScenarioId, { limit: RUN_HISTORY_LIMIT, offset: 0, oldestFirst: false }),

  /** One page of the run history, newest first unless `sortDesc` is false, and the number of runs the scenario has. */
  listRunHistory: async ({ repo }, riskScenarioId: string, query: { page: number, limit: number, sortDesc: boolean }) => {
    const [items, total] = await Promise.all([
      repo.findRunHistoryPage(riskScenarioId, { limit: query.limit, offset: (query.page - 1) * query.limit, oldestFirst: !query.sortDesc }),
      repo.countRunsByScenarioId(riskScenarioId),
    ]);
    return { items, total };
  },

  /**
   * The Overview's curves over the past `windowDays`: the scenario's latest two runs, newest first,
   * and its quantified runs sampled as of `RUN_TIMELINE_SAMPLES` dates, oldest first, up to `until`.
   */
  getRunTimeline: async ({ repo }, riskScenarioId: string, windowDays: number) => {
    const until = new Date();
    const since = new Date(until.getTime() - windowDays * DAY_MS);
    const latest = await repo.findLatestTimelineRuns(riskScenarioId, 2);
    const sampled = await repo.findTimelineRunsAsOf(riskScenarioId, { since, now: until, samples: RUN_TIMELINE_SAMPLES });
    const asRun = <Row extends { runId: string, at: Date }>({ runId, at, ...columns }: Row) => ({ id: runId, createdAt: at, ...columns });
    return { latest: latest.map(asRun), points: sampled.map(asRun), until };
  },

  /** Each control's levers from the latest run that computed them. */
  getWhatIfResults: async ({ repo }, riskScenarioId: string) => {
    const runs = await repo.findFamilyRunsByScenarioIds('levers', [riskScenarioId]);
    const { owns, runIds } = familyRunOwnership(runs, 'levers');
    const rows = await repo.findWhatIfResultsByRunIds([...runIds]);
    return rows.filter((row) => owns(row.runId, row.controlId));
  },

  /**
   * Everything the attack outcome overview's CRQ card needs, computed once from the scenarios
   * naming this outcome: which controls reduce it (`topControls`), from the latest runs that
   * computed their levers, and what it costs (`ledger`), from the latest runs.
   *
   * A scenario with no run, and a scenario whose latest run produced no mean, both read `null` in
   * the ledger and are equally "named but unpriced" — the distinction has no reading downstream.
   * The ledger is ordered priced-first by descending cost, then unpriced by name: the order is the
   * procedure's contract, so no caller re-sorts.
   */
  getCrqSummaryForOutcome: async ({ repo, deps }, params: { attackOutcomeId: string, organizationId?: string, topControlsLimit?: number }) => {
    const emptyLedger = { rows: [], totalAleMean: null, pricedCount: 0, totalCount: 0 };
    const scenarios = await deps.riskScenarios.findRiskScenariosByAttackOutcomeIds([params.attackOutcomeId], params.organizationId);
    if (scenarios.length === 0) {
      return { topControls: [], ledger: emptyLedger };
    }

    const scenarioIds = scenarios.map((scenario) => scenario.id);
    const [latestRuns, leverRuns] = await Promise.all([
      repo.findLatestRunsByScenarioIds(scenarioIds),
      repo.findFamilyRunsByScenarioIds('levers', scenarioIds),
    ]);
    const { owns, runIds } = familyRunOwnership(leverRuns, 'levers');
    const whatIfRows = (await repo.findWhatIfResultsMeanByRunIds([...runIds]))
      .filter((row) => owns(row.runId, row.controlId));
    const topControls = aggregateTopControls(whatIfRows).slice(0, params.topControlsLimit ?? DEFAULT_TOP_CONTROLS_FOR_OUTCOME_LIMIT);

    const aleMeanByScenarioId = new Map(latestRuns.filter(hasAleMean).map((run) => [run.riskScenarioId, run.aleMean]));
    const rows = scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      organizationName: scenario.organizationName,
      aleMean: aleMeanByScenarioId.get(scenario.id) ?? null,
    }))
      .sort((a, b) => {
        if (a.aleMean === null && b.aleMean === null) {
          return a.scenarioName.localeCompare(b.scenarioName);
        }
        if (a.aleMean === null || b.aleMean === null) {
          return a.aleMean === null ? 1 : -1;
        }
        return (b.aleMean - a.aleMean) || a.scenarioName.localeCompare(b.scenarioName);
      });
    const pricedRows = rows.filter(hasAleMean);

    return {
      topControls,
      ledger: {
        rows,
        // `null`, never `0`, when nothing is priced: an outcome nobody has simulated does not
        // cost zero a year, and the page must be able to say so.
        totalAleMean: pricedRows.length === 0 ? null : pricedRows.reduce((sum, row) => sum + row.aleMean, 0),
        pricedCount: pricedRows.length,
        totalCount: rows.length,
      },
    };
  },

  /**
   * What OpenCRQ quantifies about objects another XTM product holds, for its "In OpenCRQ" card: per
   * threat analysis, supporting asset or CVE row id, the risk scenarios it drives and their summed mean
   * annual loss (`null` when none is priced, never `0`), and for a CVE what fixing it is worth summed
   * over those scenarios. One statement per call, never one per object.
   */
  getXtmExposure: async ({ repo }, kind: 'THREAT' | 'ASSET' | 'VULNERABILITY', objectIds: Array<string>): Promise<Map<string, XtmExposure>> => {
    if (kind === 'THREAT') {
      return summariseXtmExposure(await repo.findXtmThreatExposure(objectIds));
    }
    if (kind === 'ASSET') {
      return summariseXtmExposure(await repo.findXtmAssetExposure(objectIds));
    }
    return summariseXtmExposure(await repo.findXtmCveExposure(objectIds));
  },
});
