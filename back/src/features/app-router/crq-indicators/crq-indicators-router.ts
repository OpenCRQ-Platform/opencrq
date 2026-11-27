import {
  COVERAGE_BUCKETS,
  crqControlWhatIfResults,
  crqIndicatorGroupScores,
  crqIndicatorRuns,
  crqIndicatorTefInputs,
  CVE_ID_PATTERN,
  cvesRunProfile,
  JOB_CATALOGUE,
  leversRunProfile,
  REVENUE_BAND_VALUES,
  STRENGTH_RUNGS,
  techniquesRunProfile,
  TEF_FALLBACK_REASONS,
  TEF_MODE_VALUES,
  TEF_NOT_MEASURED,
  TEF_SIZE_CLASSES,
  TEF_SIZE_SOURCES,
  TefCatalogProfileUnknownIdError,
  tefEstimates,
  THREAT_ENTITY_TYPES,
} from '@app/module';
import type { CrqRunProfile } from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { AppRouterTelemetry, TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { CveGainSchema } from '../cve-gain';
import { estateInput, resolveMappedOrganizationId } from '../estate';
import { pagedInput, pagedOutput } from '../pagination';
import { withNotFoundOn } from '../structured-error-conflict';
import { crqSimulationIdempotencyKey, enqueueRequestedCrqSimulation } from '../../crq-indicators/crq-simulation-queue';
import { FINANCIAL_ESTIMATES_RECOMPUTE_JOB } from '../../financial-estimates-recompute/financial-estimates-recompute-queue';

const CrqRunSchema = createSelectSchema(crqIndicatorRuns);
const CrqTimelineRunSchema = CrqRunSchema.pick({
  id: true,
  createdAt: true,
  aleMean: true,
  aleP10: true,
  aleP90: true,
  tefMin: true,
  tefLikely: true,
  tefMax: true,
  outcomeEvicted: true,
  outcomeImpactDetected: true,
  outcomeImpactUndetected: true,
  magnitudeMean: true,
});
const CrqRunHistoryRowSchema = CrqTimelineRunSchema.extend(CrqRunSchema.pick({
  vulnerabilityP5: true,
  vulnerabilityP50: true,
  vulnerabilityP95: true,
  lefMean: true,
  techniqueCount: true,
  coveredTechniqueCount: true,
}).shape);
const CrqRunHistoryPageRowSchema = CrqRunSchema.pick({
  id: true,
  createdAt: true,
  aleMean: true,
  vulnerabilityP5: true,
  vulnerabilityP50: true,
  vulnerabilityP95: true,
  lefMean: true,
  techniqueCount: true,
  coveredTechniqueCount: true,
});
const CrqRunTimelineSchema = z.object({
  latest: z.array(CrqTimelineRunSchema),
  points: z.array(CrqTimelineRunSchema),
  until: z.date(),
});
const CrqTefInputSchema = createSelectSchema(crqIndicatorTefInputs);
const TefModeEnum = z.enum(TEF_MODE_VALUES);
const TefCatalogSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  url: z.string().nullable(),
  licence: z.string().nullable(),
  attribution: z.string().nullable(),
  referencePeriod: z.string().nullable(),
});
const TefCatalogueRefSchema = z.object({ id: z.string(), version: z.string() });
const TefSizeClassShareSchema = z.object({ sizeClass: z.enum(TEF_SIZE_CLASSES), weight: z.number().min(0).max(1) });
const TefCatalogReadSchema = z.object({
  catalogue: TefCatalogueRefSchema,
  countryIsoAlpha3: z.string().nullable(),
  sectorName: z.string().nullable(),
  sizeSource: z.enum(TEF_SIZE_SOURCES),
  country: z.string(),
  sector: z.string().nullable(),
  sizeClasses: z.array(TefSizeClassShareSchema),
  low: z.number(),
  likely: z.number(),
  high: z.number(),
  notMeasured: z.array(z.enum(TEF_NOT_MEASURED)),
  sources: z.array(TefCatalogSourceSchema).nullable(),
});
const ScopeScenarioTefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  attackOutcomeId: z.uuid(),
  tefMode: TefModeEnum,
  likely: z.number().nullable(),
  read: TefCatalogReadSchema.nullable(),
});
const TefEstimateSchema = createSelectSchema(tefEstimates, {
  fallbackReason: z.enum(TEF_FALLBACK_REASONS).nullable(),
}).pick({
  id: true,
  riskScenarioId: true,
  catalogVintage: true,
  catalogId: true,
  catalogVersion: true,
  min: true,
  likely: true,
  max: true,
  positioned: true,
  fallbackReason: true,
  createdAt: true,
}).extend({ read: TefCatalogReadSchema.nullable() });

const CrqGroupScoreRowSchema = createSelectSchema(crqIndicatorGroupScores, {
  groupEntityType: z.enum(THREAT_ENTITY_TYPES).nullable(),
});

const CrqTechniqueValueSchema = z.object({
  id: z.uuid(),
  mitreTechniqueId: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  /** What the ALE drops by when the technique never succeeds, then when its detection is fully covered. Null on a run that carries no price. */
  preventValueMean: z.number().nullable(),
  detectValueMean: z.number().nullable(),
});

const CrqReachGapSchema = z.object({
  id: z.uuid(),
  gap: z.enum(['estate', 'catalogue'] as const),
  family: z.string(),
  mitreTechniqueId: z.uuid(),
  externalId: z.string(),
  name: z.string(),
});

const CrqUnplayableObstacleSchema = z.object({
  id: z.uuid(),
  groupKey: z.uuid().nullable(),
  obstacleKey: z.string(),
});

// Zod strips what the output schema does not declare, so every row set the service resolves has to
// be declared here or it silently never reaches the client.
const CrqRunWithScoresSchema = CrqRunSchema.extend({
  groupScores: z.array(CrqGroupScoreRowSchema),
  /** One row per technique the run scored, most valuable to interdict first. */
  techniqueWhatIfResults: z.array(CrqTechniqueValueSchema),
  /** The run those technique values were computed by, older than this one after a price run. Null when none computed any. */
  techniqueSource: CrqRunSchema.pick({ id: true, createdAt: true, iterations: true, aleMean: true }).nullable(),
  /** The (technique, family) pairs the run could not score, in their two distinct columns. */
  reachGaps: z.array(CrqReachGapSchema),
  /** Per actor, the obstacles its repertoire could not play at all. */
  unplayableObstacles: z.array(CrqUnplayableObstacleSchema),
  annualLoss: z.object({
    years: z.number().int(),
    mean: z.number(),
    lossYearShare: z.number(),
    lossEventYearShare: z.number(),
    quantiles: z.array(z.object({ probability: z.number(), loss: z.number() })).readonly(),
  }).nullable(),
});

const StrengthEnum = z.enum(STRENGTH_RUNGS);
const CoverageEnum = z.enum(COVERAGE_BUCKETS);

const CrqWhatIfResultSchema = createSelectSchema(crqControlWhatIfResults, {
  controlKind: z.enum(['capability'] as const),
  dimension: z.enum(['strength', 'coverage', 'deploy'] as const),
  zeroReason: z.enum(['actor-repertoire', 'estate-families', 'already-maximal'] as const).nullable(),
  currentStrength: StrengthEnum,
  upgradedStrength: StrengthEnum,
  currentCoverage: CoverageEnum,
  upgradedCoverage: CoverageEnum,
});

const TopControlForOutcomeSchema = z.object({
  controlId: z.uuid(),
  name: z.string(),
  externalId: z.string(),
  suggestedDimension: z.enum(['strength', 'coverage', 'deploy'] as const),
  scenarioCount: z.number().int(),
  totalAleReduction: z.number(),
});

const ExposureLedgerRowSchema = z.object({
  scenarioId: z.uuid(),
  scenarioName: z.string(),
  organizationName: z.string(),
  // `null` when the scenario carries no price — never simulated, or simulated without a mean.
  // Named and left unpriced, never imputed.
  aleMean: z.number().nullable(),
});

const ExposureLedgerSchema = z.object({
  // Priced first by descending cost, then unpriced by name: the order is part of the contract.
  rows: z.array(ExposureLedgerRowSchema),
  // `null` when nothing is priced: an outcome nobody simulated does not cost zero a year.
  totalAleMean: z.number().nullable(),
  pricedCount: z.number().int(),
  totalCount: z.number().int(),
});

const FIGURE_FAMILIES = ['levers', 'techniques', 'cves'] as const;

const FAMILY_RUN_PROFILES: Record<typeof FIGURE_FAMILIES[number], CrqRunProfile> = {
  levers: leversRunProfile('all'),
  techniques: techniquesRunProfile,
  cves: cvesRunProfile,
};

const FigureFamilyDateSchema = z.object({
  computedAt: z.date(),
  olderThanHeadline: z.boolean(),
}).nullable();

const FigureFamilyDatesSchema = z.object({
  headlineAt: z.date(),
  levers: FigureFamilyDateSchema,
  techniques: FigureFamilyDateSchema,
  cves: FigureFamilyDateSchema,
});

const CrqSummaryForOutcomeSchema = z.object({
  topControls: z.array(TopControlForOutcomeSchema),
  ledger: ExposureLedgerSchema,
});

const TefCatalogOverviewSchema = z.object({
  id: z.string(),
  version: z.string(),
  builtOn: z.iso.date(),
  publisher: z.string(),
  sources: z.array(TefCatalogSourceSchema),
  sizeClasses: z.array(z.enum(TEF_SIZE_CLASSES)),
  outcomes: z.array(z.object({ id: z.uuid(), name: z.string() })),
  sectors: z.array(z.object({ id: z.uuid(), name: z.string(), measured: z.boolean() })),
  countries: z.array(z.object({ id: z.uuid(), name: z.string(), isoAlpha3: z.string(), readAs: z.string() })),
  revenueBands: z.array(z.object({ revenueBand: z.enum(REVENUE_BAND_VALUES), sizeClasses: z.array(TefSizeClassShareSchema) })),
});

const TefCatalogReadingSchema = z.object({
  outcomes: z.array(z.object({ attackOutcomeId: z.uuid(), name: z.string(), read: TefCatalogReadSchema })),
  total: z.object({ low: z.number(), likely: z.number(), high: z.number() }),
});

const TefScopeReadingSchema = TefCatalogReadingSchema.extend({ organizationId: z.uuid() });

const TefCatalogProfileInput = z.object({
  countryId: z.uuid().nullable(),
  sectorId: z.uuid().nullable(),
  employeeCount: z.number().int().min(0).nullable(),
  revenueBand: z.enum(REVENUE_BAND_VALUES).nullable(),
});

const CveScenarioGainsSchema = z.object({
  actorCount: z.number().int(),
  citedScenarioCount: z.number().int(),
  totalAle: z.number(),
  scenarios: z.array(z.object({
    id: z.uuid(),
    name: z.string(),
    organizationId: z.uuid(),
    aleMean: z.number().nullable(),
    aleP10: z.number().nullable(),
    aleP90: z.number().nullable(),
    noMappedAsset: z.boolean(),
    gain: CveGainSchema,
    olderThanHeadline: z.boolean(),
    computedAt: z.date().nullable(),
    mixturePending: z.boolean(),
  })),
});

export const crqIndicatorsRouter = (procedure: TenantProcedure, telemetry: AppRouterTelemetry = {}) => router({
  enqueueSimulation: procedure
    .input(z.object({
      riskScenarioId: z.uuid(),
      /** The first-visit auto-run, which must not add a second run to one the scenario already has. */
      onlyIfNoRun: z.boolean().optional(),
    }))
    .output(z.object({ jobId: z.uuid().nullable() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scenario = await services.withOrigin(origin).riskScenarios.getRiskScenario(input.riskScenarioId);
      if (!scenario) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      // Re-read here rather than trust the caller: the auto-run fires off a client cache that can
      // predate the run a scenario creation books through its recompute, and the idempotency key
      // only folds an ask into a run still in flight, never into one that already finished.
      if (input.onlyIfNoRun && await services.withOrigin(origin).crqIndicators.getLatestRun(input.riskScenarioId)) {
        return { jobId: null };
      }
      const { jobId } = await enqueueRequestedCrqSimulation(services.withOrigin(origin), origin, input.riskScenarioId);
      try {
        // Anonymous usage telemetry: one successful CRQ simulation launch,
        // no content. Recorded after the enqueue so failures don't count.
        telemetry.onCrqSimulationLaunched?.();
      } catch {
        // Telemetry must never break the business flow.
      }
      return { jobId };
    }),
  // The run in flight, if any. Read from the server so every Run control of the scenario agrees on
  // it — a second window, a reload and the page's two buttons included.
  getActiveSimulation: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(z.object({ jobId: z.uuid() }).nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scopedServices = services.withOrigin(origin);
      // A job carries its scenario in JSON, so the key alone would answer for a scenario the caller
      // cannot see and disclose that a run is in flight for it.
      const scenario = await scopedServices.riskScenarios.getRiskScenario(input.riskScenarioId);
      if (!scenario) {
        return null;
      }
      const active = await scopedServices.jobs.getActiveJobByIdempotencyKey(
        origin.tenantId,
        crqSimulationIdempotencyKey(input.riskScenarioId),
      );
      return active ? { jobId: active.id } : null;
    }),
  // Whether the scenario's figures are still on their way: its financial estimates recompute, a
  // tenant-wide one, or its simulation. Answers a boolean, never a job, since the payload names ids.
  // The mixture and price recomputes count too: a new outcome's simulation fails until its attacker
  // mixture exists, and the price recompute is then what prices the scenario.
  getPendingComputation: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(z.object({ pending: z.boolean() }))
    .query(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scopedServices = services.withOrigin(origin);
      if (!await scopedServices.riskScenarios.getRiskScenario(input.riskScenarioId)) {
        return { pending: false };
      }
      const pending = await scopedServices.jobs.hasActiveComputationForScenario(origin.tenantId, {
        riskScenarioId: input.riskScenarioId,
        recomputeKind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB,
        simulationKey: crqSimulationIdempotencyKey(input.riskScenarioId),
        tenantWideKinds: [JOB_CATALOGUE['attack-outcome-mixture-recompute'].kind, JOB_CATALOGUE['crq-price-recompute'].kind],
      });
      return { pending };
    }),
  enqueueFamilyRecompute: procedure
    .input(z.object({ riskScenarioId: z.uuid(), family: z.enum(FIGURE_FAMILIES) }))
    .output(z.object({ jobId: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scoped = services.withOrigin(origin);
      if (!await scoped.riskScenarios.getRiskScenario(input.riskScenarioId)) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return enqueueRequestedCrqSimulation(
        scoped,
        origin,
        input.riskScenarioId,
        FAMILY_RUN_PROFILES[input.family],
      );
    }),
  getCveScenarioGains: procedure
    .input(estateInput.extend({ cveId: z.string().regex(CVE_ID_PATTERN) }))
    .output(CveScenarioGainsSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      const cve = await svc.cve.getCveByCveId(input.cveId);
      if (cve === null) {
        return { actorCount: 0, citedScenarioCount: 0, totalAle: 0, scenarios: [] };
      }
      // Refuses an unknown scope; the scenario filter below is the scope itself, open or closed.
      await resolveMappedOrganizationId(svc, input.organizationId);
      return await svc.crqIndicators.getCveScenarioGains({
        cveId: cve.id,
        cveExternalId: cve.cveId,
        estates: await svc.findingScore.getCveEstates(cve.id),
        scopeOrganizationId: input.organizationId,
      });
    }),
  getFigureFamilyDates: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(FigureFamilyDatesSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) =>
      await services.withOrigin(origin).crqIndicators.getFigureFamilyDates(input.riskScenarioId) ?? null),
  getLatestRun: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(CrqRunSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const run = await services.withOrigin(origin).crqIndicators.getLatestRun(input.riskScenarioId);
      return run ?? null;
    }),
  // eslint-disable-next-line app/no-full-row-list-output -- nests whole crq_indicator_group_scores rows, not trimmed yet
  getRunWithScores: procedure
    .input(z.object({ runId: z.uuid() }))
    .output(CrqRunWithScoresSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const result = await services.withOrigin(origin).crqIndicators.getRunWithScores(input.runId);
      return result ?? null;
    }),
  getTefInput: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(CrqTefInputSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const tefInput = await services.withOrigin(origin).crqIndicators.getTefInput(input.riskScenarioId);
      return tefInput ?? null;
    }),
  upsertTefInput: procedure
    .input(z.object({
      riskScenarioId: z.uuid(),
      min: z.number().nonnegative(),
      likely: z.number().positive(),
      max: z.number().positive(),
    }).refine((d) => d.likely >= d.min && d.max >= d.likely, {
      error: 'Must satisfy: min <= likely <= max',
    }))
    .mutation(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).crqIndicators.upsertTefInput(input)),
  getTefMode: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(TefModeEnum)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).crqIndicators.getTefMode(input.riskScenarioId)),
  setTefMode: procedure
    .input(z.object({ riskScenarioId: z.uuid(), tefMode: TefModeEnum }))
    .mutation(({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return services.withOrigin(origin).crqIndicators.setTefMode(input.riskScenarioId, input.tefMode, origin.tenantId);
    }),
  getAutoTefEstimate: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(TefEstimateSchema)
    .query(({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return services.withOrigin(origin).crqIndicators.getAutoTefEstimate(input.riskScenarioId, origin.tenantId);
    }),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the scope's scenarios
  getScopeScenarioTefs: procedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.array(ScopeScenarioTefSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).crqIndicators.getScopeScenarioTefs(input.organizationId)),
  getTefCatalog: procedure
    .output(TefCatalogOverviewSchema)
    .query(({ ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return services.withOrigin(origin).crqIndicators.getTefCatalog(origin.tenantId);
    }),
  getTefCatalogReading: procedure
    .input(TefCatalogProfileInput)
    .output(TefCatalogReadingSchema)
    .query(({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const { tenantId } = origin;
      return withNotFoundOn(TefCatalogProfileUnknownIdError, () => services.withOrigin(origin).crqIndicators.getTefCatalogReading(input, tenantId));
    }),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's risk scopes, as getOrganizations does
  getTefCatalogScopeReadings: procedure
    .output(z.array(TefScopeReadingSchema))
    .query(({ ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return services.withOrigin(origin).crqIndicators.getTefCatalogScopeReadings(origin.tenantId);
    }),
  // bounded-by: the newest 500 runs of the scenario
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One reads the run history through it, by name, as a bare array; the UI pages through listRunHistory
  getRunHistory: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(z.array(CrqRunHistoryRowSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).crqIndicators.getRunHistory(input.riskScenarioId)),
  listRunHistory: procedure
    .input(pagedInput(['createdAt'] as const).omit({ sortBy: true }).extend({ riskScenarioId: z.uuid() }))
    .output(pagedOutput(CrqRunHistoryPageRowSchema))
    .query(async ({ input: { riskScenarioId, ...query }, ctx: { services, origin } }) => ({
      ...await services.withOrigin(origin).crqIndicators.listRunHistory(riskScenarioId, query),
      page: query.page,
      limit: query.limit,
    })),
  getRunTimeline: procedure
    .input(z.object({ riskScenarioId: z.uuid(), windowDays: z.int().min(1).max(366) }))
    .output(CrqRunTimelineSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).crqIndicators.getRunTimeline(input.riskScenarioId, input.windowDays)),
  // bounded-by: the control-capability catalogue, the latest lever result per control and dimension
  getWhatIfResults: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(z.array(CrqWhatIfResultSchema.pick({
      controlId: true,
      controlKind: true,
      dimension: true,
      currentStrength: true,
      upgradedStrength: true,
      currentCoverage: true,
      upgradedCoverage: true,
      aleReductionMean: true,
      aleReductionP10: true,
      aleReductionP90: true,
      zeroReason: true,
    })))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).crqIndicators.getWhatIfResults(input.riskScenarioId)),
  // Which controls reduce this outcome and what it costs, restricted to the scenarios naming it and
  // optionally narrowed to one organization.
  getCrqSummaryForOutcome: procedure
    .input(z.object({
      attackOutcomeId: z.uuid(),
      organizationId: z.uuid().optional(),
      topControlsLimit: z.number().int().positive().optional(),
    }))
    .output(CrqSummaryForOutcomeSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).crqIndicators.getCrqSummaryForOutcome(input)),
});
