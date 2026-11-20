import type { MeasuredValidityPolicy } from '../finding-score/engine';
import type { ExpectationType } from '../supporting-assets/constants';
import type { ResolvedEstate } from '../organizations/estate-filter';
import type { EffectiveEdge } from '../controls/capability/effective-coverage';
import type { ExtractPublicFromDef, InferRepository } from '../../registry';
import type {
  ControlValidation,
  ControlValidationSummary,
  ProvenVerdict,
  ValidationCell,
  ValidationEvidenceRow,
} from './engine';
import type { ProtectingControl } from './asset-protection';
import type { ProvenPostureCounts } from './proven-posture-history';
import type { EvidenceLineFilters, EvidenceLineKey, EvidenceLinePageQuery, FleetNarrowing, ScoredTechniques, ValidationEvidenceNarrowing } from './repository';
import type { controlProvenPostureHistory } from './schema';
import type { CapabilityFunction } from '../controls/capability/constants';
import type { PostureCrossing } from '../controls/capability/service';
import type { TechniqueTestGrain, TechniqueTestResult } from './technique-test-results';
import type { EngineReaders } from './engine-reading';
import type { ScopeDeclaration, StoredTestResult } from './technique-test-booking';
import type {
  ControlTechniqueTestReading,
  TechniqueControlCell,
  TechniqueControlTestReading,
  TechniqueDeclaration,
  TechniqueFunctionCoverage,
  TechniqueReadingCell,
  TechniqueRemovedOn,
  TechniqueTestReading,
} from './technique-test-readings';
import { setImmediate } from 'node:timers/promises';
import { uuidv7 } from 'uuidv7';
import { requireTenantId } from '../../security';
import { RiskScopeNotFoundError } from '../organizations/errors';
import { SupportingAssetNotFoundError } from '../supporting-assets/service';
import { defineService } from '../../registry';
import { OPEN_ESTATE } from '../organizations/estate-filter';
import { organizationsService } from '../organizations';
import { attackSurfacesService } from '../attack-surfaces/service';
import { isScoredEdge, preferDirectEdges, resolveEffectiveEdges } from '../controls/capability/effective-coverage';
import { crossingRepricesScope, scopePinsAxis } from '../controls/capability/scope-posture';
import { diffRows } from '../../db/row-diff';
import { controlCapabilityService } from '../controls/capability/service';
import { crqIndicatorSettingsService } from '../crq-indicator-settings';
import { threatAnalysesService } from '../threat-analyses/service';
import { CAPABILITY_FUNCTIONS } from '../controls/capability/constants';
import { EXPECTATION_TYPE_VALUES } from '../supporting-assets/constants';
import { deriveAssetProtection } from './asset-protection';
import { EXPECTATION_TYPE_TO_FUNCTION, PROVEN_POSTURE_HISTORY_RETENTION_DAYS } from './constants';
import { deriveControlValidation } from './engine';
import {
  countCredited,
  countProvenPosture,
  evidenceAsOf,
  linesOwed,
  provenPostureKey,
  replayDays,
} from './proven-posture-history';
import { controlValidationRepository } from './repository';
import { techniqueTestKey, techniqueTestResultsOf } from './technique-test-results';
import { declarationAt, declarationsOf, engineReadersOf, engineReads } from './engine-reading';
import { planTechniqueTestBooking, TENANT_LEVEL } from './technique-test-booking';
import { coverageOfReadings, readTechniqueTests, readUncoveredTests } from './technique-test-readings';

/** `inScope` false: a closed risk scope that does not map the asset, which then lists nothing. */
export interface AssetProtection {
  inScope: boolean,
  controls: Array<ProtectingControl>,
}

export interface ProvenPostureHistoryLine {
  function: CapabilityFunction,
  at: Date,
  credited: number,
  tested: number,
  held: number,
}

export interface ControlValidationDetail {
  summary: ControlValidationSummary,
  cells: Array<ValidationCell>,
}

const EMPTY_SUMMARY: ControlValidationSummary = {
  validatedTechniques: 0,
  contradictedTechniques: 0,
  testedTechniques: 0,
  latestProofAt: null,
};

type Repo = InferRepository<typeof controlValidationRepository>;

interface Deps {
  crqIndicatorSettings: ExtractPublicFromDef<typeof crqIndicatorSettingsService>,
  organizations: ExtractPublicFromDef<typeof organizationsService>,
  controlCapabilities: ExtractPublicFromDef<typeof controlCapabilityService>,
  attackSurfaces: ExtractPublicFromDef<typeof attackSurfacesService>,
}

/** A scope that does not exist is not an empty one. */
const resolveScopeEstate = async (deps: Deps, organizationId: string | null | undefined): Promise<ResolvedEstate> => {
  if (organizationId === null || organizationId === undefined) {
    return OPEN_ESTATE;
  }
  const estate = await deps.organizations.resolveEstate(organizationId);
  if (estate === undefined) {
    throw new RiskScopeNotFoundError();
  }
  return estate;
};

const readEvidence = async (
  repo: Repo,
  estate: ResolvedEstate,
  narrowing?: ValidationEvidenceNarrowing,
): Promise<Array<ValidationEvidenceRow>> =>
  (await repo.findValidationEvidence(estate, narrowing)).flatMap((row): Array<ValidationEvidenceRow> => (
    row.expectationType === null ? [] : [{ ...row, expectationType: row.expectationType satisfies ExpectationType }]
  ));

const DAY_MS = 86_400_000;

/**
 * The oldest measurement `isFreshMeasurement` keeps at `now`, to narrow a read on. None for a window
 * reaching before the epoch: it narrows nothing, and its date can fall outside what `Date` and
 * `timestamptz` hold, while the derivation applies the window itself anyway.
 */
const freshSince = (policy: MeasuredValidityPolicy, now: Date): Date | undefined => {
  if (policy.measuredValidityDays === null) {
    return undefined;
  }
  const since = now.getTime() - policy.measuredValidityDays * DAY_MS;
  return since < 0 ? undefined : new Date(since);
};

/**
 * What one control's derivation reads: the results that can vote for it alone, from a family
 * implementing it, on a technique it scores or a sub-technique of one, and fresh.
 *
 * The family and technique conditions only narrow the derivation's read, since it applies them
 * again; the evidence lines, read in SQL, take the families as their filter and `scored` as their
 * cell rule. Freshness is decided by the read: a folded group carries only its latest date, so a
 * stale result folded beside a fresh one would vote. `freshSince`, with the repository's
 * `measuredSince`, must keep the rule of `isFreshMeasurement`.
 */
const readControl = async ({ repo, deps }: { repo: Repo, deps: Deps }, capabilityId: string) => {
  const [settings, platformControls, credited] = await Promise.all([
    deps.crqIndicatorSettings.getCrqIndicatorSettings(),
    repo.findControlsByPlatformType(),
    repo.findCreditedEdges([capabilityId]),
  ]);
  const policy: MeasuredValidityPolicy = { measuredValidityDays: settings.measuredValidityDays };
  const now = new Date();
  const ownPlatforms = platformControls.filter((pair) => pair.capabilityId === capabilityId);
  const edges = resolveEffectiveEdges(credited.catalogueEdges, credited.overrides);
  const scoredEdges = edges.filter(isScoredEdge);
  const scoredFor = (type: ExpectationType) => [...new Set(scoredEdges
    .filter((edge) => edge.function === EXPECTATION_TYPE_TO_FUNCTION[type])
    .map((edge) => edge.techniqueId))];
  const scored: ScoredTechniques = { detection: scoredFor('detection'), prevention: scoredFor('prevention') };
  const narrowing: ValidationEvidenceNarrowing = {
    securityPlatformTypes: ownPlatforms.map((pair) => pair.platformTypeKey),
    mitreTechniqueIds: await repo.findTechniquesWithSubTechniques([...new Set(scoredEdges.map((edge) => edge.techniqueId))]),
    measuredSince: freshSince(policy, now),
  };
  return { policy, now, edges, ownPlatforms, narrowing, scored };
};

/**
 * One control's derivation, on its results folded without their assets.
 *
 * Computed on read: the states are arithmetic over the control's own results, and a stored copy
 * would be one more thing that can disagree with the catalogue and the tenant's coverage edits it
 * reads. An estate no connector has reached yet derives to nothing rather than to an error: it is a
 * legitimate state of the product, not a failure.
 */
const deriveControl = async (
  { repo, deps }: { repo: Repo, deps: Deps },
  estate: ResolvedEstate,
  capabilityId: string,
): Promise<ControlValidation | undefined> => {
  const read = await readControl({ repo, deps }, capabilityId);
  const evidence = await repo.findFoldedValidationResults(estate, read.narrowing);
  if (evidence.length === 0) {
    return undefined;
  }
  const techniques = await repo.findTechniques([...new Set(evidence.flatMap((row) => (
    row.parentTechniqueId === null ? [row.mitreTechniqueId] : [row.mitreTechniqueId, row.parentTechniqueId]
  )))]);

  return deriveControlValidation(
    {
      rows: evidence,
      edges: read.edges,
      platformControls: read.ownPlatforms,
      techniqueExternalIds: new Map(techniques.map((technique) => [technique.id, technique.externalId])),
    },
    { policy: read.policy, now: read.now },
  ).find((control) => control.capabilityId === capabilityId);
};

export interface ValidationEvidenceAsset {
  id: string,
  name: string | null,
  derivedName: string | null,
  verdict: ProvenVerdict,
}

/** One (cell, scenario, family) group, the grain a CISO can go and replay in OpenAEV. */
export interface ValidationEvidenceLine {
  techniqueId: string,
  techniqueExternalId: string,
  function: CapabilityFunction,
  scenarioId: string | null,
  /** The scenario name and simulation of the line's latest result. */
  scenarioName: string | null,
  simulationId: string | null,
  securityPlatformType: string,
  verdict: ProvenVerdict,
  evaluatedAt: Date,
  assetCounts: { validated: number, contradicted: number },
}

export interface EvidenceLinesQuery extends Pick<EvidenceLinePageQuery, 'sortBy' | 'sortDesc' | 'limit'> {
  page: number,
  /** An ATT&CK external id, which keeps the lines of that technique and of its sub-techniques. */
  technique?: string,
  function?: CapabilityFunction,
  result?: ProvenVerdict,
  securityPlatformType?: string,
}

const toLineFilters = ({ technique, function: capabilityFunction, result, securityPlatformType }: EvidenceLinesQuery): EvidenceLineFilters => ({
  techniqueExternalId: technique,
  expectationType: capabilityFunction === undefined
    ? undefined
    : EXPECTATION_TYPE_VALUES.find((type) => EXPECTATION_TYPE_TO_FUNCTION[type] === capabilityFunction),
  verdict: result,
  securityPlatformType,
});

/**
 * A control's narrowing widened to the techniques it has a stored result on, and their sub-techniques,
 * a family row being measured on its sub-techniques' findings: the tests the control's tabs show as
 * tested but not declared, which its evidence lines list beside the scored ones.
 */
const withStoredTechniques = async (
  repo: Repo,
  narrowing: ValidationEvidenceNarrowing,
  capabilityId: string,
): Promise<ValidationEvidenceNarrowing> => {
  const stored = await repo.findTechniquesWithSubTechniques(await repo.findTechniqueTestResultTechniqueIds(capabilityId));
  return { ...narrowing, mitreTechniqueIds: [...new Set([...narrowing.mitreTechniqueIds ?? [], ...stored])] };
};

const keyText = (key: EvidenceLineKey): string =>
  `${key.techniqueId}:${key.expectationType}:${key.securityPlatformType}:${key.voteKey}`;

type EvidenceLineRow = Awaited<ReturnType<Repo['findEvidenceLinePage']>>[number];

const toLine = (row: EvidenceLineRow): ValidationEvidenceLine => ({
  techniqueId: row.techniqueId,
  techniqueExternalId: row.techniqueExternalId,
  function: EXPECTATION_TYPE_TO_FUNCTION[row.expectationType],
  scenarioId: row.scenarioId,
  scenarioName: row.scenarioName,
  simulationId: row.simulationId,
  securityPlatformType: row.securityPlatformType,
  verdict: row.contradicted > 0 ? 'contradicted' : 'validated',
  evaluatedAt: row.evaluatedAt,
  assetCounts: { validated: row.validated, contradicted: row.contradicted },
});

/** The lines XTM One's validation tool can page through, and the assets it names on each. */
const XTM_ONE_EVIDENCE_LINES = 500;
const XTM_ONE_ASSETS_PER_LINE = 5;

interface EstateGroup {
  estate: ResolvedEstate,
  scopeKeys: Array<string>,
}

/** The tenant level and every open scope share the open estate, so it is read once for all. */
const groupScopesByEstate = async (repo: Repo, deps: Deps): Promise<Array<EstateGroup>> => {
  const scopesByEstate = new Map<string, EstateGroup>([
    [TENANT_LEVEL, { estate: OPEN_ESTATE, scopeKeys: [TENANT_LEVEL] }],
  ]);
  for (const organizationId of await repo.findRiskScopeIds()) {
    const estate = await deps.organizations.resolveEstate(organizationId);
    if (estate === undefined) {
      continue;
    }
    const estateKey = estate.mode === 'closed' ? estate.organizationId : TENANT_LEVEL;
    const group = scopesByEstate.get(estateKey) ?? { estate, scopeKeys: [] };
    group.scopeKeys.push(organizationId);
    scopesByEstate.set(estateKey, group);
  }
  return [...scopesByEstate.values()];
};

export interface TechniqueTestMeasurement {
  written: number,
  deleted: number,
  /** The controls whose levers some risk scope must book again, each naming those scopes. */
  crossings: Array<PostureCrossing>,
}

const storedKey = (row: StoredTestResult): string => [
  row.organizationId ?? TENANT_LEVEL,
  techniqueTestKey(row),
  row.grain,
  row.rate,
  row.tests,
  row.heldTests,
  row.hostsTested,
  row.scopeHosts,
  row.bookedRate ?? null,
  row.bookedHostsTested ?? null,
  row.bookedScopeHosts ?? null,
].join('|');

/** How the engine reads each control's stored rows, from the scored edges it compiles the control from. */
const findEngineReaders = async (repo: Repo, edges: ReadonlyArray<EffectiveEdge>): Promise<EngineReaders> => {
  const scoredEdges = edges.filter(isScoredEdge);
  const [techniques, capabilities] = await Promise.all([
    repo.findTechniques([...new Set(scoredEdges.map((edge) => edge.techniqueId))]),
    repo.findCapabilities([...new Set(scoredEdges.map((edge) => edge.capabilityId))]),
  ]);
  return engineReadersOf(scoredEdges, techniques, capabilities);
};

/** The effective edges of the given controls, removed ones included. */
const findEffectiveEdges = async (repo: Repo, capabilityIds: Array<string>): Promise<Array<EffectiveEdge>> => {
  const { catalogueEdges, overrides } = await repo.findCreditedEdges(capabilityIds);
  return resolveEffectiveEdges(catalogueEdges, overrides);
};

type StoredTechniqueResult = Awaited<ReturnType<Repo['findTechniqueTestResultsOfTechniques']>>[number];

interface ReadTechnique {
  mitreTechniqueId: string,
  /** A sub-technique's parent, none for a technique. */
  parentTechniqueId: string | null,
}

/**
 * A control on a technique and function: by an edge, `hasEdge` false for a removed one, or `tested`
 * by a stored result of the technique's own grain.
 */
interface ListedControl {
  capabilityId: string,
  function: CapabilityFunction,
  hasEdge: boolean,
  tested: boolean,
}

/** The controls a technique page lists: its edges, one per control and function, then the controls tested there. */
const listedControlsOf = (
  { mitreTechniqueId, parentTechniqueId }: ReadTechnique,
  edges: ReadonlyArray<Pick<EffectiveEdge, 'capabilityId' | 'function' | 'state'>>,
  results: ReadonlyArray<StoredTechniqueResult>,
): Array<ListedControl> => {
  const ownGrain: TechniqueTestGrain = parentTechniqueId === null ? 'technique' : 'sub_technique';
  return [
    ...edges.map((edge) => ({ capabilityId: edge.capabilityId, function: edge.function, hasEdge: isScoredEdge(edge), tested: false })),
    ...results
      .filter((result) => result.mitreTechniqueId === mitreTechniqueId && result.grain === ownGrain)
      .map((result) => ({ capabilityId: result.capabilityId, function: result.function, hasEdge: false, tested: true })),
  ];
};

/** Per control and function a technique's edges unlink, where the removal is recorded: the technique itself or its parent. */
const removedOnOf = (edges: ReadonlyArray<EffectiveEdge>, mitreTechniqueId: string): Map<string, TechniqueRemovedOn> =>
  new Map(edges
    .filter((edge) => edge.state === 'removed')
    .map((edge) => [`${edge.capabilityId}|${edge.function}`, edge.techniqueId === mitreTechniqueId ? 'technique' : 'parent']));

/**
 * Per control and function listed on a technique, its reading: where the engine reads the control's
 * family row, the efficacy against the level's declaration; elsewhere the result alone, and nothing for
 * a removed edge with no result.
 */
const readListedControls = (
  { mitreTechniqueId, parentTechniqueId }: ReadTechnique,
  listed: ReadonlyArray<ListedControl>,
  results: ReadonlyArray<StoredTechniqueResult>,
  readers: EngineReaders,
  declarationOf: ReadonlyMap<string, TechniqueDeclaration>,
): Array<TechniqueTestReading> => {
  const cells = new Map<string, TechniqueReadingCell & { hasEdge: boolean, tested: boolean }>();
  for (const { capabilityId, function: fn, hasEdge, tested } of listed) {
    const key = `${capabilityId}|${fn}`;
    const held = cells.get(key);
    cells.set(key, {
      capabilityId,
      function: fn,
      mitreTechniqueId,
      parentTechniqueId,
      hasEdge: hasEdge || held?.hasEdge === true,
      tested: tested || held?.tested === true,
    });
  }
  const read: Array<TechniqueControlCell> = [];
  const unread: Array<TechniqueReadingCell> = [];
  for (const { hasEdge, tested, ...cell } of cells.values()) {
    const family = { ...cell, mitreTechniqueId: parentTechniqueId ?? mitreTechniqueId };
    if (engineReads(readers, { ...family, grain: 'technique' })) {
      read.push({ ...cell, declaration: declarationAt(declarationOf.get(cell.capabilityId), readers, family) });
    } else if (hasEdge || tested) {
      unread.push(cell);
    }
  }
  return [...readTechniqueTests(read, results), ...readUncoveredTests(unread, results)];
};

/** Each reading named after its control and the rungs it is declared at on the level; a control the tenant cannot read is left out. */
const labelReadings = (
  readings: ReadonlyArray<TechniqueTestReading>,
  labelOf: ReadonlyMap<string, { externalId: string, name: string }>,
  declarationOf: ReadonlyMap<string, TechniqueDeclaration>,
): Array<TechniqueControlTestReading> => readings.flatMap((reading) => {
  const label = labelOf.get(reading.capabilityId);
  if (label === undefined) {
    return [];
  }
  const declaration = declarationOf.get(reading.capabilityId);
  const capabilityRungs = declaration === undefined ? null : { strengthRung: declaration.strengthRung, coverageBucket: declaration.coverageBucket };
  return [{ ...reading, capabilityExternalId: label.externalId, capabilityName: label.name, capabilityRungs }];
});

export interface ProvenPostureRecording {
  lines: number,
  replayedLines: number,
  replayedDays: number,
}

interface ReplayInput {
  repo: Repo,
  policy: MeasuredValidityPolicy,
  platformControls: Awaited<ReturnType<Repo['findControlsByPlatformType']>>,
  edges: Array<EffectiveEdge>,
  credited: ReadonlyMap<string, number>,
  reachableIds: ReadonlySet<string>,
  signal: AbortSignal | undefined,
}

interface ReplayedPast {
  days: number,
  lines: Array<{ changedAt: Date, counts: ProvenPostureCounts }>,
  last: Map<string, ProvenPostureCounts>,
}

/** One derivation per UTC day over the stored changes of state, with today's coverage and window. */
const replayProvenPosture = async (
  { repo, policy, platformControls, edges, credited, reachableIds, signal }: ReplayInput,
  estate: ResolvedEstate,
  now: Date,
): Promise<ReplayedPast> => {
  const timeline = (await repo.findValidationEvidenceTimeline(estate)).flatMap((row) => (
    row.expectationType === null ? [] : [{ ...row, expectationType: row.expectationType satisfies ExpectationType }]
  ));
  const firstVerdictAt = timeline.reduce<Date | null>((first, row) => {
    const at = row.verdicts.at(0)?.recordedAt;
    return at !== undefined && (first === null || at.getTime() < first.getTime()) ? at : first;
  }, null);
  const days = replayDays(firstVerdictAt, now);
  const replayed: ReplayedPast = { days: days.length, lines: [], last: new Map() };
  for (const day of days) {
    signal?.throwIfAborted();
    const derived = deriveControlValidation(
      { rows: evidenceAsOf(timeline, day), edges, platformControls, techniqueExternalIds: new Map() },
      { policy, now: day },
    );
    for (const counts of linesOwed(countProvenPosture(derived, credited, reachableIds), replayed.last)) {
      replayed.lines.push({ changedAt: day, counts });
      replayed.last.set(provenPostureKey(counts.capabilityId, counts.function), counts);
    }
    // Up to a year of passes over the estate's evidence: let the worker's other tenants through.
    await setImmediate();
  }
  return replayed;
};

export const controlValidationService = defineService(
  'controlValidation',
  controlValidationRepository,
).dependsOn(() => [crqIndicatorSettingsService, organizationsService, controlCapabilityService, attackSurfacesService, threatAnalysesService]).implement({
  /**
   * One control's matrix: the cells that carry a vote, and what they add up to.
   *
   * Inside a risk scope the derivation runs on that scope's own assets, so a cell one failing asset
   * elsewhere contradicts can legitimately read as validated here.
   */
  getControlValidation: async (
    { repo, deps, eventOrigin },
    capabilityId: string,
    organizationId?: string | null,
  ): Promise<ControlValidationDetail> => {
    requireTenantId(eventOrigin);
    const control = await deriveControl({ repo, deps }, await resolveScopeEstate(deps, organizationId), capabilityId);
    return {
      summary: control?.summary ?? EMPTY_SUMMARY,
      cells: control?.cells ?? [],
    };
  },

  /**
   * One control's evidence for XTM One, which reads it as a bare array: its newest lines, each with
   * the first of its assets, the ones that gave way first.
   *
   * The ids of the scenario and of the simulation are returned raw: the deep link back into OpenAEV
   * is built by the surface, from the connector's own base URL.
   */
  getControlValidationEvidence: async (
    { repo, deps, eventOrigin },
    capabilityId: string,
    organizationId?: string | null,
  ): Promise<Array<ValidationEvidenceLine & { assets: Array<ValidationEvidenceAsset> }>> => {
    requireTenantId(eventOrigin);
    const estate = await resolveScopeEstate(deps, organizationId);
    const { narrowing, scored } = await readControl({ repo, deps }, capabilityId);
    const rows = await repo.findEvidenceLinePage(estate, narrowing, scored, {
      filing: 'scored',
      sortBy: 'evaluatedAt',
      sortDesc: true,
      offset: 0,
      limit: XTM_ONE_EVIDENCE_LINES,
    });
    const assets = Map.groupBy(await repo.findFirstEvidenceLineAssets(estate, narrowing, scored, rows, XTM_ONE_ASSETS_PER_LINE), keyText);
    return rows.map((row) => ({
      ...toLine(row),
      assets: (assets.get(keyText(row)) ?? []).map(({ id, name, derivedName, contradicted }) => ({
        id, name, derivedName, verdict: contradicted ? 'contradicted' : 'validated',
      })),
    }));
  },

  /**
   * One control's evidence lines, one per (technique cell, scenario, family, function), a page at a
   * time, each with how many of its assets held and gave way. A result of its families on a technique
   * it does not score but holds a stored result on is listed on that technique, so a test the
   * control's declaration misses can be read before the technique is added. `unfilteredTotal` counts
   * the lines whatever the filters.
   */
  listControlValidationEvidence: async (
    { repo, deps, eventOrigin },
    capabilityId: string,
    organizationId: string | null | undefined,
    query: EvidenceLinesQuery,
  ): Promise<{ items: Array<ValidationEvidenceLine>, total: number, unfilteredTotal: number }> => {
    requireTenantId(eventOrigin);
    const estate = await resolveScopeEstate(deps, organizationId);
    const { narrowing, scored } = await readControl({ repo, deps }, capabilityId);
    const tested = await withStoredTechniques(repo, narrowing, capabilityId);
    const filters = toLineFilters(query);
    const rows = await repo.findEvidenceLinePage(estate, tested, scored, {
      ...filters,
      filing: 'tested',
      sortBy: query.sortBy,
      sortDesc: query.sortDesc,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    const { total, unfilteredTotal } = rows[0] ?? await repo.countEvidenceLines(estate, tested, scored, 'tested', filters);
    return { items: rows.map(toLine), total, unfilteredTotal };
  },

  /**
   * The techniques one control's evidence lines are filed on and their parents, by external id: the
   * techniques {@link listControlValidationEvidence} can keep lines of.
   */
  listControlValidationEvidenceTechniques: async (
    { repo, deps, eventOrigin },
    capabilityId: string,
    organizationId?: string | null,
  ): Promise<Array<{ externalId: string, name: string }>> => {
    requireTenantId(eventOrigin);
    const estate = await resolveScopeEstate(deps, organizationId);
    const { narrowing, scored } = await readControl({ repo, deps }, capabilityId);
    const tested = await withStoredTechniques(repo, narrowing, capabilityId);
    const filed = await repo.findTechniques(await repo.findEvidenceLineTechniqueIds(estate, tested, scored, 'tested'));
    const filedIds = new Set(filed.map((technique) => technique.id));
    const parents = await repo.findTechniques([...new Set(filed.flatMap((technique) => (
      technique.parentTechniqueId === null || filedIds.has(technique.parentTechniqueId) ? [] : [technique.parentTechniqueId]
    )))]);
    return [...filed, ...parents]
      .map(({ externalId, name }) => ({ externalId, name }))
      .toSorted((first, second) => first.externalId.localeCompare(second.externalId));
  },

  /**
   * Reads stored evidence only. A scope key with no line at all gets its past replayed first, and the
   * present is compared with the last replayed line. An open scope is recorded under its own key with
   * the tenant's counts, so a scope later closed keeps one continuous history.
   *
   * `signal` is read on every replayed day and before the write: an aborted run throws, so its
   * transaction rolls back instead of committing for an attempt the job runtime already ended.
   */
  recordProvenPostureHistory: async (
    { atomic, eventOrigin },
    { now, signal }: { now: Date, signal?: AbortSignal },
  ): Promise<ProvenPostureRecording> => {
    const tenantId = requireTenantId(eventOrigin);
    // One transaction, or a reader between two scopes sees a run half recorded.
    return atomic(async ({ repo, deps }) => {
      const platformControls = await repo.findControlsByPlatformType();
      const reachableIds = new Set(platformControls.map((pair) => pair.capabilityId));
      const coverage = await repo.findCreditedEdges([...reachableIds]);
      const edges = resolveEffectiveEdges(coverage.catalogueEdges, coverage.overrides);
      const credited = countCredited(edges);
      const settings = await deps.crqIndicatorSettings.getCrqIndicatorSettings();
      const policy: MeasuredValidityPolicy = { measuredValidityDays: settings.measuredValidityDays };

      const scopesByEstate = await groupScopesByEstate(repo, deps);

      const lastByScope = new Map<string, Map<string, ProvenPostureCounts>>();
      for (const line of await repo.findLatestProvenPostureLines()) {
        const scopeKey = line.organizationId ?? TENANT_LEVEL;
        const last = lastByScope.get(scopeKey) ?? new Map<string, ProvenPostureCounts>();
        last.set(provenPostureKey(line.capabilityId, line.function), line);
        lastByScope.set(scopeKey, last);
      }

      const rows: Array<typeof controlProvenPostureHistory.$inferInsert> = [];
      const toRow = (scopeKey: string, counts: ProvenPostureCounts, changedAt: Date, replayed: boolean) => ({
        id: uuidv7(),
        tenantId,
        capabilityId: counts.capabilityId,
        organizationId: scopeKey === TENANT_LEVEL ? null : scopeKey,
        function: counts.function,
        credited: counts.credited,
        tested: counts.tested,
        held: counts.held,
        changedAt,
        replayed,
      });
      let replayedLines = 0;
      let replayedDays = 0;
      for (const { estate, scopeKeys } of scopesByEstate) {
        const unrecorded = scopeKeys.filter((scopeKey) => !lastByScope.has(scopeKey));
        if (unrecorded.length > 0) {
          const replay = await replayProvenPosture({ repo, policy, platformControls, edges, credited, reachableIds, signal }, estate, now);
          replayedDays += replay.days;
          for (const scopeKey of unrecorded) {
            rows.push(...replay.lines.map((line) => toRow(scopeKey, line.counts, line.changedAt, true)));
            replayedLines += replay.lines.length;
            lastByScope.set(scopeKey, replay.last);
          }
        }
        const derived = deriveControlValidation(
          {
            rows: await readEvidence(repo, estate, { measuredSince: freshSince(policy, now) }),
            edges,
            platformControls,
            techniqueExternalIds: new Map(),
          },
          { policy, now },
        );
        const present = countProvenPosture(derived, credited, reachableIds);
        for (const scopeKey of scopeKeys) {
          rows.push(...linesOwed(present, lastByScope.get(scopeKey) ?? new Map()).map((counts) => toRow(scopeKey, counts, now, false)));
        }
      }

      signal?.throwIfAborted();
      await repo.insertProvenPostureHistoryBatch(rows);
      await repo.trimProvenPostureHistory(new Date(now.getTime() - PROVEN_POSTURE_HISTORY_RETENTION_DAYS * DAY_MS));
      return { lines: rows.length - replayedLines, replayedLines, replayedDays };
    });
  },

  /**
   * Counts OpenAEV's results per control, function and technique, at the tenant level on the open
   * estate and in every risk scope on its own, and stores what is left of them. A risk scope's control
   * has its levers booked again when a technique the engine reads of it, read at the scope's
   * declaration, moved by `TESTED_REBOOK_STEP` from the result the levers were last priced on; a row
   * the engine does not read is stored unbooked. `crossings`: the posture moves
   * this run books anyway; a scope they reprice prices those controls on today's results, and a scope
   * they leave out, by its own declaration, keeps the result its levers were priced on.
   */
  measureTechniqueTestResults: async (
    { atomic, repo, deps, eventOrigin },
    { now, crossings = [] }: { now: Date, crossings?: ReadonlyArray<PostureCrossing> },
  ): Promise<TechniqueTestMeasurement> => {
    const tenantId = requireTenantId(eventOrigin);
    // Counted before the transaction, which only diffs and writes: the reads walk every fresh result
    // of the estate, and resolving a posture reads in parallel, which one connection cannot.
    const [settings, platformControls] = await Promise.all([
      deps.crqIndicatorSettings.getCrqIndicatorSettings(),
      repo.findControlsByPlatformType(),
    ]);
    const policy: MeasuredValidityPolicy = { measuredValidityDays: settings.measuredValidityDays };
    const coverage = await repo.findCreditedEdges([...new Set(platformControls.map((pair) => pair.capabilityId))]);
    const edges = resolveEffectiveEdges(coverage.catalogueEdges, coverage.overrides);
    const readers = await findEngineReaders(repo, edges);
    const narrowing: FleetNarrowing = {
      securityPlatformTypes: [...new Set(platformControls.map((pair) => pair.platformTypeKey))],
      measuredSince: freshSince(policy, now),
    };

    const wantedByScope = new Map<string, Array<TechniqueTestResult>>();
    const declarationByScope = new Map<string, ScopeDeclaration>();
    const storedScopes = new Set(await repo.findTechniqueTestResultScopeIds());
    for (const { estate, scopeKeys } of await groupScopesByEstate(repo, deps)) {
      const [counts, scopeHosts] = await Promise.all([
        repo.countTechniqueTests(estate, narrowing),
        repo.countScopeHosts(estate),
      ]);
      const results = techniqueTestResultsOf(counts, scopeHosts);
      for (const scopeKey of scopeKeys) {
        wantedByScope.set(scopeKey, results);
        // A scope with neither a result nor a stored row has nothing to book, nor a declaration to read it at.
        if (scopeKey !== TENANT_LEVEL && (results.length > 0 || storedScopes.has(scopeKey))) {
          const postures = new Map((await deps.controlCapabilities.getResolvedPosture(scopeKey)).map((posture) => [posture.capabilityId, posture]));
          const repriced = crossings.filter((crossing) => {
            const posture = postures.get(crossing.capabilityId);
            return crossingRepricesScope(crossing, scopeKey, (axis) => posture !== undefined && scopePinsAxis(posture, axis));
          });
          declarationByScope.set(scopeKey, { postures, repriced: new Set(repriced.map((crossing) => crossing.capabilityId)) });
        }
      }
    }

    return atomic(async ({ repo: writer }) => {
      const held = await writer.findTechniqueTestResults();
      const { wanted, rebooked } = planTechniqueTestBooking({ wantedByScope, declarationByScope, held, readers });

      const { stale, missing } = diffRows(held, wanted, storedKey, storedKey);
      await writer.deleteTechniqueTestResults(stale.map((row) => row.id));
      await writer.insertTechniqueTestResults(missing.map((row) => ({ ...row, id: uuidv7(), tenantId })));

      const scopesByCapability = new Map<string, Array<string>>();
      for (const [scopeKey, capabilities] of rebooked) {
        for (const capabilityId of capabilities) {
          scopesByCapability.set(capabilityId, [...scopesByCapability.get(capabilityId) ?? [], scopeKey]);
        }
      }
      return {
        written: missing.length,
        deleted: stale.length,
        crossings: [...scopesByCapability].map(([capabilityId, organizationIds]) => ({ capabilityId, axes: [], organizationIds })),
      };
    });
  },

  /**
   * Per control and function listed on a technique, at one level (the tenant's open estate when no
   * scope is given): OpenAEV's stored result there and, where the engine reads the control's family
   * row ({@link engineReads}), its efficacy against the level's declaration on the engine's scale. A
   * technique reads its family's row; a sub-technique reads its own, beside its parent's efficacy. A
   * control the engine does not read there, an edge removed or on a sub-technique alone, or a result
   * with no edge, reads its result alone; a removed edge with no result reads nothing.
   */
  getTechniqueTestReadings: async (
    { repo, deps, eventOrigin },
    mitreTechniqueId: string,
    organizationId?: string | null,
  ): Promise<Array<TechniqueControlTestReading>> => {
    requireTenantId(eventOrigin);
    await resolveScopeEstate(deps, organizationId);
    const [controls, postures, [technique]] = await Promise.all([
      deps.controlCapabilities.getCapabilitiesForTechnique(mitreTechniqueId),
      deps.controlCapabilities.getResolvedPosture(organizationId ?? null),
      repo.findTechniques([mitreTechniqueId]),
    ]);
    const subject: ReadTechnique = { mitreTechniqueId, parentTechniqueId: technique?.parentTechniqueId ?? null };
    const results = await repo.findTechniqueTestResultsOfTechniques(
      subject.parentTechniqueId === null ? [mitreTechniqueId] : [mitreTechniqueId, subject.parentTechniqueId],
      organizationId ?? null,
    );
    const listed = listedControlsOf(subject, controls.map((control) => ({ capabilityId: control.id, function: control.function, state: control.state })), results);
    const capabilityIds = [...new Set(listed.map((cell) => cell.capabilityId))];
    const readers = await findEngineReaders(repo, await findEffectiveEdges(repo, capabilityIds));
    const declarationOf = declarationsOf(postures);
    const labelOf = new Map((await repo.findCapabilities(capabilityIds)).map((capability) => [capability.id, capability]));
    return labelReadings(readListedControls(subject, listed, results, readers, declarationOf), labelOf, declarationOf);
  },

  /**
   * {@link getTechniqueTestReadings} for each catalogue technique a threat plays, each function of each
   * one ranked into the best control the engine counts as present and the others (`coverageOfReadings`),
   * on a fixed number of reads whatever the techniques. A threat the tenant cannot read has none.
   */
  getTechniquesCoverage: async (
    { repo, deps, eventOrigin },
    threatId: string,
    organizationId?: string | null,
  ): Promise<Array<TechniqueFunctionCoverage>> => {
    requireTenantId(eventOrigin);
    await resolveScopeEstate(deps, organizationId);
    const mitreTechniqueIds = await deps.threatAnalyses.getMatchedTechniqueIds(threatId);
    if (mitreTechniqueIds.length === 0) {
      return [];
    }
    const techniques: Array<ReadTechnique> = (await repo.findTechniques(mitreTechniqueIds))
      .map((technique) => ({ mitreTechniqueId: technique.id, parentTechniqueId: technique.parentTechniqueId }));
    const familyIds = [...new Set(techniques.flatMap((technique) => (
      technique.parentTechniqueId === null ? [technique.mitreTechniqueId] : [technique.mitreTechniqueId, technique.parentTechniqueId]
    )))];
    const [coverage, postures, results] = await Promise.all([
      repo.findEdgesForTechniques(familyIds),
      deps.controlCapabilities.getResolvedPosture(organizationId ?? null),
      repo.findTechniqueTestResultsOfTechniques(familyIds, organizationId ?? null),
    ]);
    const edgesOn = Map.groupBy(resolveEffectiveEdges(coverage.catalogueEdges, coverage.overrides), (edge) => edge.techniqueId);
    const listedOf = new Map(techniques.map((technique) => {
      const edges = preferDirectEdges([
        ...edgesOn.get(technique.mitreTechniqueId) ?? [],
        ...(technique.parentTechniqueId === null ? [] : edgesOn.get(technique.parentTechniqueId) ?? []),
      ], technique.mitreTechniqueId);
      return [technique.mitreTechniqueId, { listed: listedControlsOf(technique, edges, results), removedOn: removedOnOf(edges, technique.mitreTechniqueId) }];
    }));
    const capabilityIds = [...new Set([...listedOf.values()].flatMap(({ listed }) => listed).map((cell) => cell.capabilityId))];
    const [readers, capabilities] = await Promise.all([
      findEffectiveEdges(repo, capabilityIds).then((edges) => findEngineReaders(repo, edges)),
      repo.findCapabilities(capabilityIds),
    ]);
    const declarationOf = declarationsOf(postures);
    const labelOf = new Map(capabilities.map((capability) => [capability.id, capability]));
    return techniques.flatMap((technique) => {
      const { listed, removedOn } = listedOf.get(technique.mitreTechniqueId) ?? { listed: [], removedOn: new Map<string, TechniqueRemovedOn>() };
      const linked = new Set(listed.filter((control) => control.hasEdge).map((control) => `${control.capabilityId}|${control.function}`));
      const readings = labelReadings(readListedControls(technique, listed, results, readers, declarationOf), labelOf, declarationOf)
        .map((reading) => {
          const key = `${reading.capabilityId}|${reading.function}`;
          return { ...reading, linked: linked.has(key), removedOn: removedOn.get(key) ?? null };
        });
      return CAPABILITY_FUNCTIONS.map((fn) => coverageOfReadings(technique.mitreTechniqueId, fn, readings));
    });
  },

  /**
   * The converse of `getTechniqueTestReadings`: one control on one function, at one level, every
   * technique it has an edge on and every technique OpenAEV tested it on, each read at its own grain.
   * A sub-technique's own result where the engine reads its family is left to the family's row.
   */
  getControlTechniqueTestReadings: async (
    { repo, deps, eventOrigin },
    capabilityId: string,
    capabilityFunction: CapabilityFunction,
    organizationId?: string | null,
  ): Promise<Array<ControlTechniqueTestReading>> => {
    requireTenantId(eventOrigin);
    await resolveScopeEstate(deps, organizationId);
    const [edges, postures, results] = await Promise.all([
      findEffectiveEdges(repo, [capabilityId]),
      deps.controlCapabilities.getResolvedPosture(organizationId ?? null),
      repo.findTechniqueTestResultsOfControl(capabilityId, capabilityFunction, organizationId ?? null),
    ]);
    const readers = await findEngineReaders(repo, edges);
    const functionEdges = edges.filter((edge) => edge.function === capabilityFunction);
    const withEdge = new Set(functionEdges.filter(isScoredEdge).map((edge) => edge.techniqueId));
    const techniqueIds = [...new Set([...functionEdges.map((edge) => edge.techniqueId), ...results.map((result) => result.mitreTechniqueId)])];
    const techniques = new Map((await repo.findTechniques(techniqueIds)).map((technique) => [technique.id, technique]));
    const testedIds = new Set(results.map((result) => result.mitreTechniqueId));
    const declaration = declarationsOf(postures).get(capabilityId);
    const read: Array<TechniqueControlCell> = [];
    const unread: Array<TechniqueReadingCell> = [];
    for (const techniqueId of techniqueIds) {
      const parentTechniqueId = techniques.get(techniqueId)?.parentTechniqueId ?? null;
      const cell = { capabilityId, function: capabilityFunction, mitreTechniqueId: techniqueId, parentTechniqueId };
      const hasEdge = functionEdges.some((edge) => edge.techniqueId === techniqueId);
      const family = { ...cell, mitreTechniqueId: parentTechniqueId ?? techniqueId };
      if (engineReads(readers, { ...family, grain: 'technique' })) {
        if (hasEdge || parentTechniqueId === null) {
          read.push({ ...cell, declaration: declarationAt(declaration, readers, family) });
        }
      } else if (withEdge.has(techniqueId) || testedIds.has(techniqueId)) {
        unread.push(cell);
      }
    }
    const readings = [...readTechniqueTests(read, results), ...readUncoveredTests(unread, results)];
    return readings.flatMap((reading) => {
      const technique = techniques.get(reading.mitreTechniqueId);
      return technique === undefined
        ? []
        : [{ ...reading, techniqueExternalId: technique.externalId, techniqueName: technique.name }];
    });
  },

  /** Never the tenant's lines for a scope: the recording writes even an open scope under its own key. */
  getProvenPostureHistory: async (
    { repo, deps, eventOrigin },
    capabilityId: string,
    organizationId?: string | null,
  ): Promise<Array<ProvenPostureHistoryLine>> => {
    requireTenantId(eventOrigin);
    await resolveScopeEstate(deps, organizationId);
    const since = new Date(Date.now() - PROVEN_POSTURE_HISTORY_RETENTION_DAYS * DAY_MS);
    return repo.findProvenPostureHistory(capabilityId, organizationId ?? null, since);
  },

  /**
   * The scope changes the values and never the list: the posture reads the scope's declaration before
   * the tenant's, and the fleet counts only the assets a closed scope maps.
   */
  getAssetProtectingControls: async (
    { repo, deps, eventOrigin },
    supportingAssetId: string,
    organizationId?: string | null,
  ): Promise<AssetProtection> => {
    requireTenantId(eventOrigin);
    const asset = await repo.findSupportingAsset(supportingAssetId);
    if (asset === undefined) {
      throw new SupportingAssetNotFoundError();
    }
    const estate = await resolveScopeEstate(deps, organizationId);
    if (estate.mode === 'closed' && !await repo.isAssetInEstate(supportingAssetId, estate)) {
      return { inScope: false, controls: [] };
    }

    const [categoryTechniques, findingTechniqueIds, hereRows] = await Promise.all([
      deps.attackSurfaces.getApplicableTechniques(asset.categoryId),
      repo.findApplicableFindingTechniqueIds(supportingAssetId),
      repo.findAssetValidationEvidence(estate, supportingAssetId),
    ]);
    const assetTechniqueIds = [...new Set([...categoryTechniques.map((technique) => technique.id), ...findingTechniqueIds])];
    const readTechniqueIds = [...new Set([...assetTechniqueIds, ...hereRows.map((row) => row.mitreTechniqueId)])];
    const techniques = await repo.findTechniques(readTechniqueIds);
    const parentIds = techniques.flatMap((technique) => (technique.parentTechniqueId === null ? [] : [technique.parentTechniqueId]));

    const [coverage, platformControls, settings, postures] = await Promise.all([
      repo.findEdgesForTechniques([...new Set([...readTechniqueIds, ...parentIds])]),
      repo.findControlsByPlatformType(),
      deps.crqIndicatorSettings.getCrqIndicatorSettings(),
      deps.controlCapabilities.getResolvedPosture(organizationId ?? null),
    ]);
    const policy: MeasuredValidityPolicy = { measuredValidityDays: settings.measuredValidityDays };
    const now = new Date();
    const edges = resolveEffectiveEdges(coverage.catalogueEdges, coverage.overrides);
    const candidateIds = [...new Set([
      ...edges.map((edge) => edge.capabilityId),
      ...platformControls.map((pair) => pair.capabilityId),
    ])];
    const fleetNarrowing: FleetNarrowing = {
      mitreTechniqueIds: readTechniqueIds,
      securityPlatformTypes: [...new Set(platformControls.map((pair) => pair.platformTypeKey))],
      measuredSince: freshSince(policy, now),
    };
    const [protectedFamilies, capabilities, fleetTallies, fleetCoverage] = await Promise.all([
      deps.controlCapabilities.getProtectedFamilies(candidateIds),
      repo.findCapabilities(candidateIds),
      repo.findFleetTallies(estate, fleetNarrowing),
      repo.findFleetCoverage(estate, fleetNarrowing),
    ]);

    const controls = deriveAssetProtection(
      {
        categoryId: asset.categoryId,
        assetTechniqueIds,
        techniques: new Map(techniques.map((technique) => [technique.id, technique])),
        edges,
        protectedFamilies,
        platformControls,
        postures,
        capabilities,
        rows: hereRows.flatMap((row): Array<ValidationEvidenceRow> => (
          row.expectationType === null ? [] : [{ ...row, expectationType: row.expectationType satisfies ExpectationType }]
        )),
        fleet: { tallies: fleetTallies, coverage: fleetCoverage },
      },
      { policy, now },
    );
    return { inScope: true, controls };
  },
});
