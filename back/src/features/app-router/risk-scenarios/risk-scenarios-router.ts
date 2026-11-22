import type { allServiceDefinitions, createServices, SupportingAssetExposure } from '@app/module';
import {
  ASSET_CATEGORY_VALUES,
  ASSET_CRITICALITY_VALUES,
  assetEvidence,
  attackOutcomes,
  COVERAGE_BUCKETS,
  CRITERION_INHERITANCES,
  CVE_ID_PATTERN,
  cveGainState,
  DEPENDENCY_GRAPH_DEFAULT_DEPTH,
  DEPENDENCY_GRAPH_FOLDS,
  DEPENDENCY_GRAPH_MAX_DEPTH,
  DEPENDENCY_LINK_KINDS,
  DISMISSAL_TYPE_VALUES,
  EVIDENCE_HEALTH_STATES,
  EVIDENCE_HISTORY_ORIGINS,
  organizations,
  riskScenarios,
  SCENARIO_FINDING_SEVERITY_FILTERS,
  SCENARIO_FINDING_SORT_KEYS,
  SCENARIO_FINDING_STATE_FILTERS,
  SCENARIO_INPUT_KINDS,
  SCENARIO_READINESS_STATUSES,
  SCENARIO_SUPPORTING_ASSET_SORT_KEYS,
  SEVERITY_BANDS,
  STRENGTH_RUNGS,
  SUPPORT_TO_PRIMARY_LINK_ROLES,
  THREAT_ENTITY_TYPES,
  UNIQUE_FINDING_SORT_KEYS,
} from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { AppRouterTelemetry, TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { CveGainSchema } from '../cve-gain';
import { resolveMappedOrganizationId } from '../estate';
import { pagedInput, pagedOutput } from '../pagination';
import { UniqueFindingRowSchema } from '../unique-finding-row';
import { createLogger } from '../../../utils/logger';
import { RiskToleranceSchema } from '../risk-tolerance';
import { enqueueScenarioRecompute } from '../../financial-estimates-recompute/financial-estimates-recompute-queue';

const { logFromError } = createLogger({ feature: 'risk-scenarios' });

// The derivation marker is internal bookkeeping, not part of a scenario's wire shape: it says which
// answers the estimates cover, which the Financial Impact summary already reports as a verdict.
const RiskScenariosSchema = createSelectSchema(riskScenarios).omit({ tenantId: true, derivedAnswersUpdatedAt: true, nameFolded: true });
const OrganizationsSchema = createSelectSchema(organizations);
const AttackOutcomesSchema = createSelectSchema(attackOutcomes).omit({ nameFolded: true });

const ControlCapabilityForScenarioSchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  strengthRung: z.enum(STRENGTH_RUNGS),
  coverageBucket: z.enum(COVERAGE_BUCKETS),
  strengthSource: z.enum(['tenant', 'scope']),
  coverageSource: z.enum(['tenant', 'scope']),
  isAssessed: z.boolean(),
  mitreTechniqueIds: z.array(z.uuid()),
});
const RelationSummarySchema = z.object({ id: z.uuid(), name: z.string() });
const NamedRefSchema = z.object({ id: z.uuid(), name: z.string().nullable() });
/** A supporting asset, or a primary one whose `derivedName` is always `null`. */
const AssetRefSchema = NamedRefSchema.extend({ derivedName: z.string().nullable() });
const CriterionGradeSchema = z.enum(CRITERION_INHERITANCES);
const CriteriaGradesSchema = z.object({
  availability: CriterionGradeSchema,
  integrity: CriterionGradeSchema,
  confidentiality: CriterionGradeSchema,
  traceability: CriterionGradeSchema,
});
const ScenarioSupportingAssetsSchema = z.object({
  attackOutcome: z.object({ id: z.uuid(), name: z.string(), criteriaReached: CriteriaGradesSchema }),
  primaryAssets: z.array(RelationSummarySchema),
  assets: z.array(z.object({
    supportingAssetId: z.uuid(),
    supportingAssetName: z.string().nullable(),
    supportingAssetDerivedName: z.string().nullable(),
    depth: z.number().int(),
    via: z.array(AssetRefSchema),
    roles: z.array(z.enum(SUPPORT_TO_PRIMARY_LINK_ROLES)),
    outOfScope: z.boolean(),
    impact: z.number(),
    contributions: z.array(z.object({
      primaryAssetId: z.uuid(),
      primaryAssetName: z.string(),
      hops: z.number().int(),
      chain: z.array(AssetRefSchema),
      roles: z.array(z.enum(SUPPORT_TO_PRIMARY_LINK_ROLES)),
      criteria: CriteriaGradesSchema,
      outcomeTotal: z.number(),
      transmittedTotal: z.number(),
      share: z.number(),
      contribution: z.number(),
    })),
  })),
});

const ScenarioSupportingAssetsPageSchema = pagedOutput(ScenarioSupportingAssetsSchema.shape.assets.element).extend({
  attackOutcome: ScenarioSupportingAssetsSchema.shape.attackOutcome,
  primaryAssets: ScenarioSupportingAssetsSchema.shape.primaryAssets,
  directCount: z.number().int(),
  transitiveCount: z.number().int(),
});

const ASSET_EXPOSURE_VALUES = ['internet_facing', 'internal', 'unknown'] as const satisfies ReadonlyArray<SupportingAssetExposure>;
const RiskScenarioDependencyGraphSchema = z.object({
  primaryAssets: z.array(RelationSummarySchema),
  attackOutcome: z.object({ name: z.string(), criteriaReached: CriteriaGradesSchema }).nullable(),
  assets: z.array(z.object({
    id: z.uuid(),
    name: z.string().nullable(),
    derivedName: z.string().nullable(),
    categoryId: z.enum(ASSET_CATEGORY_VALUES),
    criticality: z.enum(ASSET_CRITICALITY_VALUES),
    exposure: z.enum(ASSET_EXPOSURE_VALUES),
    ownerName: z.string().nullable(),
    firstSeenAt: z.date().nullable(),
    lastSeenAt: z.date().nullable(),
    postureScore: z.number().int().nullable(),
    criticalFindingCount: z.number().int(),
    highFindingCount: z.number().int(),
    impact: z.number(),
    contributions: ScenarioSupportingAssetsSchema.shape.assets.element.shape.contributions,
  })),
  links: z.array(z.object({
    id: z.uuid(),
    dependentId: z.uuid(),
    providerId: z.uuid(),
    kind: z.enum(DEPENDENCY_LINK_KINDS),
    roles: z.array(z.enum(SUPPORT_TO_PRIMARY_LINK_ROLES)).nullable(),
    attackShare: z.object({ outcomeTotal: z.number(), transmittedTotal: z.number(), share: z.number() }).nullable(),
  })),
  truncated: z.array(z.object({ assetId: z.uuid(), hiddenProviderCount: z.number().int(), foldedBy: z.enum(DEPENDENCY_GRAPH_FOLDS) })),
  hiddenAssetCount: z.number().int(),
});

const ExploitationTechniqueSchema = z.object({
  techniqueExternalId: z.string(),
  techniqueName: z.string(),
  lane: z.enum(['supplied', 'curated', 'structural', 'topology']),
  confidence: z.enum(['high', 'medium', 'low']),
});
const ExploitationReadingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('named'), lanes: z.array(z.enum(['supplied', 'curated'])) }),
  z.object({
    kind: z.literal('topology'),
    reading: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('weakness'), cwe: z.string() }),
      z.object({
        kind: z.literal('vector'),
        attackVector: z.string(),
        userInteraction: z.string(),
        privilegesRequired: z.string(),
        exposure: z.enum(ASSET_EXPOSURE_VALUES),
      }),
    ]),
  }),
  z.object({ kind: z.literal('none') }),
]);
const CVE_EXPLOITATION_MAX_ASSETS = 500;
const CveExploitationSchema = z.object({
  cve: z.object({ cveId: z.string(), cveTitle: z.string().nullable(), cvss: z.number().nullable(), cvssVector: z.string().nullable() }),
  byExposure: z.array(z.object({
    exposure: z.enum(ASSET_EXPOSURE_VALUES),
    techniques: z.array(ExploitationTechniqueSchema),
    reading: ExploitationReadingSchema,
    assetCount: z.number().int(),
  })),
  assets: z.array(z.object({
    supportingAssetId: z.uuid(),
    supportingAssetName: z.string().nullable(),
    supportingAssetDerivedName: z.string().nullable(),
    depth: z.number().int(),
    impact: z.number(),
    exposure: z.enum(ASSET_EXPOSURE_VALUES),
    primaryAssets: z.array(RelationSummarySchema),
    techniques: z.array(ExploitationTechniqueSchema),
    reading: ExploitationReadingSchema,
  })),
  total: z.number().int(),
});

const EVIDENCE_HEALTH_MAX_ASSETS = 500;
const EvidenceHealthSchema = z.object({
  assets: z.array(z.object({
    supportingAssetId: z.uuid(),
    supportingAssetName: z.string().nullable(),
    supportingAssetDerivedName: z.string().nullable(),
    impact: z.number(),
    state: z.enum(EVIDENCE_HEALTH_STATES),
    lastEvidenceAt: z.date().nullable(),
    sources: z.array(z.object({ connectorId: z.uuid().nullable(), origin: z.enum(['connector', 'user']), lastSeenAt: z.date().nullable() })),
  })),
  counts: z.record(z.enum(EVIDENCE_HEALTH_STATES), z.number().int()),
  sources: z.array(z.object({
    kind: z.string(),
    lastRunAt: z.date().nullable(),
    latestTotal: z.number().int(),
    previousTotal: z.number().int().nullable(),
    emptied: z.boolean(),
  })),
  total: z.number().int(),
});

const RiskScenarioWithRelationsSchema = RiskScenariosSchema.extend({
  organization: OrganizationsSchema.pick({ id: true, name: true }).nullable(),
  attackOutcome: AttackOutcomesSchema.pick({ id: true, name: true }),
  primaryAssets: z.array(RelationSummarySchema),
  // Null when the scenario names no owner, and when it names one the reader cannot see.
  owner: NamedRefSchema.nullable(),
});

/** The scenario's loss scope, ordered by the catalogue. `code` is what the frontend translates on. */
const RiskScenarioDetailSchema = RiskScenarioWithRelationsSchema.extend({
  businessValueCategories: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
});

const ScenarioInputKindSchema = z.enum(SCENARIO_INPUT_KINDS);

// XTM One's scenario list tool prints the description.
const RiskScenarioOverviewSchema = RiskScenarioWithRelationsSchema.pick({
  id: true,
  organizationId: true,
  name: true,
  description: true,
  organization: true,
  attackOutcome: true,
  primaryAssets: true,
  owner: true,
}).extend({
  /** True when the scenario's scope maps nothing, which retires the run below rather than the row. */
  noMappedAsset: z.boolean(),
  latestRun: z.object({
    runId: z.uuid(),
    createdAt: z.date(),
    aleMean: z.number().nullable(),
    aleP10: z.number().nullable(),
    aleP90: z.number().nullable(),
    lefMean: z.number().nullable(),
    techniqueCount: z.number().int(),
    coveredTechniqueCount: z.number().int(),
  }).nullable(),
  /** Oldest first, one per distinct run: the quantified runs in force at instants spread over the window, for the sparkline. */
  lifeline: z.array(z.object({
    at: z.date(),
    aleMean: z.number(),
    aleP10: z.number().nullable(),
    aleP90: z.number().nullable(),
  })),
  /** The lifeline's oldest point against its newest, absent until it carries two priced points. */
  changeOverLifeline: z.object({
    delta: z.number(),
    deltaPct: z.number().nullable(),
    spanDays: z.number(),
  }).nullable(),
  readiness: z.object({
    status: z.enum(SCENARIO_READINESS_STATUSES),
    missing: z.array(ScenarioInputKindSchema),
    outdated: z.array(ScenarioInputKindSchema),
  }),
});

const RiskScenarioFindingPathSchema = z.object({
  viaAssetId: z.uuid(),
  viaAssetName: z.string().nullable(),
  viaAssetDerivedName: z.string().nullable(),
  depth: z.number().int(),
});

const RiskScenarioFindingExploitedBySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  entityType: z.enum(THREAT_ENTITY_TYPES),
  mitreGroupId: z.string().nullable(),
  activityScore: z.number().min(0).max(1).nullable(),
});

const RiskScenarioFindingSchema = createSelectSchema(assetEvidence).pick({
  id: true,
  supportingAssetId: true,
  userId: true,
  createdAt: true,
}).extend({
  supportingAssetName: z.string().nullable(),
  supportingAssetDerivedName: z.string().nullable(),
  cveId: z.string(),
  cveTitle: z.string().nullable(),
  cvss: z.number().nullable(),
  epss: z.number().nullable(),
  kev: z.boolean(),
  currentState: z.enum(['applicable', 'dismissed']).nullable(),
  stateChangedAt: z.date().nullable(),
  stateReason: z.string().nullable(),
  stateOrigin: z.enum(EVIDENCE_HISTORY_ORIGINS).nullable(),
  dismissalType: z.enum(DISMISSAL_TYPE_VALUES).nullable(),
  // The walk is breadth first, so the first way in is a shortest one.
  firstPath: RiskScenarioFindingPathSchema.nullable(),
  pathCount: z.number().int(),
  exploitedBy: z.array(RiskScenarioFindingExploitedBySchema),
  // Null together until the finding's first score lands: they are read from its projection row, and
  // an empty `sources` would read as a finding no connector reports.
  score: z.number().nullable(),
  band: z.enum(SEVERITY_BANDS).nullable(),
  assetCategoryId: z.enum(ASSET_CATEGORY_VALUES).nullable(),
  sources: z.array(z.string()).nullable(),
  lastEvaluatedAt: z.date().nullable(),
  firstSeenAt: z.date().nullable(),
});

const ScenarioUniqueCveSchema = UniqueFindingRowSchema.pick({
  key: true,
  cveId: true,
  cveTitle: true,
  knownExploited: true,
  epss: true,
  score: true,
  band: true,
  worstScore: true,
  worstBand: true,
  pendingVector: true,
  affectedAssetCount: true,
  sources: true,
  firstSeenAt: true,
}).extend({ gain: CveGainSchema });

const ScenarioUniqueCvesSchema = pagedOutput(ScenarioUniqueCveSchema).extend({
  // The latest run's mean annual loss, which a gain reads as a share of.
  baselineAle: z.number().nullable(),
  mixturePending: z.boolean(),
});

const normalizeCveId = (cveId: string) => cveId.trim().toUpperCase();

type ScopedServices = Pick<
  ReturnType<ReturnType<typeof createServices<typeof allServiceDefinitions>>['withOrigin']>,
  'riskScenarios' | 'organizations' | 'threatAnalyses' | 'findingScore'
>;
type ScenarioFindingRow = Awaited<ReturnType<ScopedServices['riskScenarios']['listFindingsForRiskScenario']>>['items'][number];

/**
 * Adds to each finding its score and the threat analyses relevant to the scenario that exploit its
 * CVE. Read for `findings` alone, so a page costs its own rows, not the scenario's.
 */
const withScoreAndThreats = async (
  scoped: ScopedServices,
  riskScenarioId: string,
  findings: Array<ScenarioFindingRow>,
): Promise<Array<z.infer<typeof RiskScenarioFindingSchema>>> => {
  if (findings.length === 0) {
    return [];
  }

  const scenario = await scoped.riskScenarios.getRiskScenario(riskScenarioId);
  if (!scenario) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scenario not found' });
  }
  const organization = await scoped.organizations.getOrganization(scenario.organizationId);
  if (!organization) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scope not found' });
  }

  const cveTargets = await scoped.threatAnalyses.getAnalysesTargetingCves(
    [...new Set(findings.map((finding) => normalizeCveId(finding.cveId)))],
  );

  const exploitedByCve = new Map<string, Array<z.infer<typeof RiskScenarioFindingExploitedBySchema>>>();
  if (cveTargets.length > 0) {
    const { items: relevant } = await scoped.threatAnalyses.getRelevantForScenario({
      attackOutcomeId: scenario.attackOutcomeId,
      countryIds: organization.countryId ? [organization.countryId] : [],
      sectorIds: organization.sectorId ? [organization.sectorId] : [],
      organizationCountryName: organization.country?.name ?? null,
      organizationSectorName: organization.sector?.name ?? null,
      analysisIds: [...new Set(cveTargets.map((target) => target.analysisId))],
    });

    const cveIdsByAnalysisId = new Map<string, Array<string>>();
    for (const target of cveTargets) {
      const cveIds = cveIdsByAnalysisId.get(target.analysisId) ?? [];
      cveIds.push(normalizeCveId(target.cveId));
      cveIdsByAnalysisId.set(target.analysisId, cveIds);
    }

    for (const analysis of relevant) {
      for (const cveId of cveIdsByAnalysisId.get(analysis.id) ?? []) {
        const entries = exploitedByCve.get(cveId) ?? [];
        if (!entries.some((entry) => entry.id === analysis.id)) {
          entries.push({
            id: analysis.id,
            name: analysis.name,
            entityType: analysis.entityType,
            mitreGroupId: analysis.mitreGroupId,
            activityScore: analysis.activityScore,
          });
        }
        exploitedByCve.set(cveId, entries);
      }
    }
  }

  const scored = await scoped.findingScore.getScoredFindingsByEvidenceIds(findings.map((finding) => finding.id));
  const scoredById = new Map(scored.map((row) => [row.evidenceId, row]));

  return findings.map((finding) => {
    const score = scoredById.get(finding.id);
    return {
      ...finding,
      exploitedBy: exploitedByCve.get(normalizeCveId(finding.cveId)) ?? [],
      score: score?.score ?? null,
      band: score?.band ?? null,
      assetCategoryId: score?.assetCategoryId ?? null,
      sources: score?.sources ?? null,
      lastEvaluatedAt: score?.lastEvaluatedAt ?? null,
      firstSeenAt: score?.firstSeenAt ?? null,
    };
  });
};

const ScenarioFindingsSummarySchema = z.object({
  critical: z.number().int(),
  high: z.number().int(),
  medium: z.number().int(),
  low: z.number().int(),
  unscored: z.number().int(),
  dismissed: z.number().int(),
  total: z.number().int(),
  unfiltered: z.number().int(),
});

const ScenarioFindingSeveritiesSchema = z.object({
  critical: z.number().int(),
  high: z.number().int(),
  medium: z.number().int(),
  low: z.number().int(),
  none: z.number().int(),
  unscored: z.number().int(),
  kev: z.number().int(),
  dismissed: z.number().int(),
  total: z.number().int(),
});

const TOP_FINDINGS_CAP = 20;

const NAMES_BY_IDS_CAP = 200;
const NameByIdSchema = z.object({ id: z.string(), name: z.string() });

export const riskScenariosRouter = (procedure: TenantProcedure, telemetry: AppRouterTelemetry = {}) => router({
  createRiskScenario: procedure
    .input(z.object({
      id: z.uuid(),
      organizationId: z.uuid(),
      name: z.string().min(1),
      description: z.string().nullable(),
      ownerId: z.uuid().nullable().optional(),
      attackOutcomeId: z.uuid(),
      primaryAssetIds: z.array(z.uuid()).optional().default([]),
      businessValueCategoryIds: z.array(z.uuid()).optional(),
    }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scopedServices = services.withOrigin(origin);
      const result = await scopedServices.riskScenarios.createRiskScenario(input);
      // A scoped ask on top of the dispatcher's own: the analyst lands on this scenario's
      // Financial Impact tab straight after the wizard, and the dispatcher's debounce is a
      // latency budget, not a catch-up one. It costs one extra run, the scoped payload being
      // undedupable against the dispatcher's `payload: {}`.
      //
      // Caught, since the scenario is already committed: reporting the creation as failed would
      // send the wizard to retry the same client-generated id onto a row that exists, and the
      // dispatcher books the recompute anyway.
      try {
        await enqueueScenarioRecompute(scopedServices, origin, origin.tenantId, input.id);
      } catch (error) {
        logFromError(error, 'Could not ask for a recompute after a risk scenario creation', { riskScenarioId: input.id });
      }
      try {
        // Anonymous usage telemetry: one successful risk scenario creation,
        // no content. Recorded after the service call so failures don't count.
        telemetry.onRiskScenarioCreated?.();
      } catch {
        // Telemetry must never break the business flow.
      }
      return result;
    }),
  // The attack outcome is fixed at creation: it carries the scenario's timing assumptions and the
  // threat intelligence attached to it, so changing it after the fact invalidates both silently.
  // Absent from the input object, a stale client payload carrying it is refused by zod.
  updateRiskScenario: procedure
    .input(z.object({
      id: z.uuid(),
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      ownerId: z.uuid().nullable().optional(),
      primaryAssetIds: z.array(z.uuid()).optional(),
      businessValueCategoryIds: z.array(z.uuid()).optional(),
    }).strict())
    .mutation(async ({ input: { id, ...values }, ctx: { services, origin } }) => services.withOrigin(origin)
      .riskScenarios.updateRiskScenario(id, values)),
  setRiskTolerance: procedure
    .input(z.object({ riskScenarioId: z.uuid(), tolerance: RiskToleranceSchema.nullable() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      if (!await services.withOrigin(origin).riskScenarios.setRiskTolerance(input.riskScenarioId, input.tolerance)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scenario not found' });
      }
    }),
  deleteRiskScenarios: procedure
    .input(z.array(z.uuid()))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scopedServices = services.withOrigin(origin);
      // A simulation outlives the scenario it prices: queued it would dead-letter on it, running it
      // holds the tenant's one simulation slot pricing something nobody can read any more.
      await scopedServices.jobs.cancelByPayloadId('crq-simulation', 'riskScenarioId', input);
      return await scopedServices.riskScenarios.deleteRiskScenarios(input);
    }),
  getRiskScenario: procedure
    .input(z.object({ id: z.uuid() }))
    .output(RiskScenarioDetailSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .riskScenarios.getRiskScenario(input.id) ?? null),
  // bounded-by: NAMES_BY_IDS_CAP input ids, at most one scenario per id
  getNamesByIds: procedure
    .input(z.object({ ids: z.array(z.uuid()).max(NAMES_BY_IDS_CAP) }))
    .output(z.array(NameByIdSchema))
    .query(({ input, ctx: { services, origin } }) => (input.ids.length === 0
      ? []
      : services.withOrigin(origin).riskScenarios.getRiskScenarioNamesByIds(input.ids))),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the scope's or the tenant's scenarios, not capped yet
  getRiskScenariosOverview: procedure
    .input(z.object({ organizationId: z.uuid().optional() }))
    .output(z.array(RiskScenarioOverviewSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .riskScenarios.getRiskScenariosOverview(input.organizationId)),
  // bounded-by: the control-capability catalogue, each control once
  getControlCapabilitiesForRiskScenario: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(z.array(ControlCapabilityForScenarioSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .riskScenarios.getControlCapabilitiesForRiskScenario(input.riskScenarioId)),
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One reads a scenario's whole walk through it, by name; the UI pages through listDerivedSupportingAssets
  getDerivedSupportingAssets: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(ScenarioSupportingAssetsSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .riskScenarios.getDerivedSupportingAssets(input.riskScenarioId) ?? null),
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One's CTEM fleets read it through their OpenCRQ tool, by name
  getCveExploitation: procedure
    .input(z.object({
      riskScenarioId: z.uuid(),
      cveId: z.string().regex(CVE_ID_PATTERN),
      limit: z.number().int().min(1).max(CVE_EXPLOITATION_MAX_ASSETS).default(50),
    }))
    .output(CveExploitationSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const read = await services.withOrigin(origin).riskScenarios.getCveExploitation(input.riskScenarioId, input.cveId, input.limit);
      if ('missing' in read) {
        throw new TRPCError({ code: 'NOT_FOUND', message: read.missing === 'scenario' ? 'Risk scenario not found' : `${input.cveId} is not in this platform's vulnerability catalogue` });
      }
      return { cve: read.cve, ...read.answer };
    }),
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One's CTEM loop polls it for evidence decay and blind spots, by name
  getEvidenceHealth: procedure
    .input(z.object({
      riskScenarioId: z.uuid(),
      maxAgeDays: z.number().int().min(1).max(3650).default(30),
      limit: z.number().int().min(1).max(EVIDENCE_HEALTH_MAX_ASSETS).default(100),
    }))
    .output(EvidenceHealthSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const read = await services.withOrigin(origin).riskScenarios.getEvidenceHealth(input.riskScenarioId, input.maxAgeDays, input.limit);
      if (!read) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scenario not found' });
      }
      return read;
    }),
  listDerivedSupportingAssets: procedure
    .input(pagedInput(SCENARIO_SUPPORTING_ASSET_SORT_KEYS).extend({ riskScenarioId: z.uuid() }))
    .output(ScenarioSupportingAssetsPageSchema.nullable())
    .query(async ({ input: { riskScenarioId, ...query }, ctx: { services, origin } }) => {
      const page = await services.withOrigin(origin).riskScenarios.listDerivedSupportingAssets(riskScenarioId, query);
      return page ? { ...page, page: query.page, limit: query.limit } : null;
    }),
  getDependencyGraph: procedure
    .input(z.object({
      riskScenarioId: z.uuid(),
      depth: z.number().int().min(1).max(DEPENDENCY_GRAPH_MAX_DEPTH).default(DEPENDENCY_GRAPH_DEFAULT_DEPTH),
    }))
    .output(RiskScenarioDependencyGraphSchema)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .riskScenarios.getDependencyGraph(input.riskScenarioId, input.depth)),
  listFindingsForRiskScenario: procedure
    .input(pagedInput(SCENARIO_FINDING_SORT_KEYS).extend({
      riskScenarioId: z.uuid(),
      state: z.enum(SCENARIO_FINDING_STATE_FILTERS).default('applicable'),
      severity: z.enum(SCENARIO_FINDING_SEVERITY_FILTERS).default('all'),
    }))
    .output(pagedOutput(RiskScenarioFindingSchema).extend({ summary: ScenarioFindingsSummarySchema }))
    .query(async ({ input: { riskScenarioId, ...query }, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      const { items, summary } = await scoped.riskScenarios.listFindingsForRiskScenario(riskScenarioId, query);
      return {
        items: await withScoreAndThreats(scoped, riskScenarioId, items),
        total: summary.total,
        page: query.page,
        limit: query.limit,
        summary,
      };
    }),
  listUniqueCvesForRiskScenario: procedure
    .input(pagedInput(UNIQUE_FINDING_SORT_KEYS).extend({ riskScenarioId: z.uuid() }))
    .output(ScenarioUniqueCvesSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      const scenario = await svc.riskScenarios.getRiskScenario(input.riskScenarioId);
      if (!scenario) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scenario not found' });
      }
      const mappedToOrganizationId = await resolveMappedOrganizationId(svc, scenario.organizationId);
      const source = await svc.crqIndicators.getCveGainSource(input.riskScenarioId);
      const requestedSort = input.sortBy ?? 'gain';
      const page = await svc.findingScore.listUniqueFindings({
        page: input.page,
        limit: input.limit,
        source: null,
        mappedToOrganizationId,
        sortBy: requestedSort === 'gain' && source.run === null ? 'score' : requestedSort,
        sortDesc: input.sortDesc,
        cveOnly: true,
        gainRunId: source.run?.id ?? null,
      });
      return {
        ...page,
        items: page.items.map(({ cveRef, gainMean, gainP10, gainP90, ...item }) => ({
          ...item,
          gain: cveGainState({
            row: gainMean == null ? null : { mean: gainMean, p10: gainP10 ?? null, p90: gainP90 ?? null },
            source: source.run,
            pricedNow: cveRef != null && source.pricedNow.has(cveRef),
          }),
        })),
        baselineAle: source.baselineAle,
        mixturePending: source.mixturePending,
      };
    }),
  getFindingsSummaryForRiskScenario: procedure
    .input(z.object({ riskScenarioId: z.uuid(), topLimit: z.number().int().min(1).max(TOP_FINDINGS_CAP).default(5) }))
    .output(z.object({ counts: ScenarioFindingSeveritiesSchema, top: z.array(RiskScenarioFindingSchema) }))
    .query(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      const { counts, top } = await scoped.riskScenarios.getFindingsSummaryForRiskScenario(input.riskScenarioId, input.topLimit);
      return { counts, top: await withScoreAndThreats(scoped, input.riskScenarioId, top) };
    }),
});
