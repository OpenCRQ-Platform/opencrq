import type { SupportingAssetExposure } from '@app/module';
import { ACTOR_CLASS_VALUES, ASSET_CATEGORY_VALUES, ASSET_CRITICALITY_VALUES, COVERAGE_BUCKETS, dashboardIdSchema, SEVERITY_BANDS, STRENGTH_RUNGS, THREAT_ENTITY_TYPES } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { RiskToleranceSchema } from '../risk-tolerance';
import { userSessionOnly } from '../user-session-only';

const DashboardInput = z.object({ organizationId: z.uuid().optional() });

const WindowedDashboardInput = DashboardInput.extend({
  /** Days back, today included; 90 when omitted. */
  windowDays: z.number().int().min(1).max(366).optional(),
});

const ScenarioSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  organizationId: z.uuid(),
  organizationName: z.string().nullable(),
  attackOutcomeName: z.string(),
  /** True when the scenario's scope maps nothing, which retires the run below rather than the row. */
  noMappedAsset: z.boolean(),
  latestRun: z.object({
    runId: z.uuid(),
    createdAt: z.date(),
    aleMean: z.number().nullable(),
    aleP10: z.number().nullable(),
    aleP90: z.number().nullable(),
    lefMean: z.number().nullable(),
  }).nullable(),
  trend: z.object({
    baselineAleMean: z.number(),
    currentAleMean: z.number(),
    delta: z.number(),
    deltaPct: z.number().nullable(),
  }).nullable(),
  likelihoodChange: z.number().nullable(),
});

const TrendPointSchema = z.object({
  date: z.iso.date(),
  ale: z.number().nullable(),
  lef: z.number().nullable(),
  likelihood: z.number().nullable(),
  magnitude: z.number().nullable(),
});

const RiskScopeFiguresInput = z.object({
  /** Days back, today included. */
  windowDays: z.number().int().min(1).max(366),
});

const RiskScopeFiguresSchema = z.object({
  organizationId: z.uuid(),
  name: z.string(),
  scenarioCount: z.number().int(),
  ale: z.number().nullable(),
  lef: z.number().nullable(),
  likelihood: z.number().nullable(),
  magnitude: z.number().nullable(),
  aleChange: z.number().nullable(),
  aleBaseline: z.object({ date: z.string(), ale: z.number() }).nullable(),
  windowStart: z.iso.date(),
});

const TopControlSchema = z.object({
  controlId: z.uuid(),
  name: z.string(),
  externalId: z.string(),
  suggestedDimension: z.enum(['strength', 'coverage', 'deploy'] as const),
  scenarioCount: z.number().int(),
  totalAleReduction: z.number(),
});

const TopControlMoveSchema = z.object({
  controlId: z.uuid(),
  name: z.string(),
  externalId: z.string(),
  dimension: z.enum(['strength', 'coverage', 'deploy'] as const),
  currentStrength: z.enum(STRENGTH_RUNGS),
  upgradedStrength: z.enum(STRENGTH_RUNGS),
  currentCoverage: z.enum(COVERAGE_BUCKETS),
  upgradedCoverage: z.enum(COVERAGE_BUCKETS),
  scenarioCount: z.number().int(),
  totalAleReduction: z.number(),
});

const RiskTreatmentInput = DashboardInput.extend({
  riskScenarioId: z.uuid().optional(),
});

const RiskTreatmentSeriesInput = z.object({
  riskScenarioId: z.uuid(),
  windowDays: z.number().int().min(1).max(731),
});

const RiskTreatmentSeriesSchema = z.object({
  windowStart: z.iso.date(),
  /** `null` when the latest run kept no distribution: an older run, or one not priced. */
  annualLoss: z.object({
    mean: z.number(),
    lossYearShare: z.number(),
    quantiles: z.array(z.object({ probability: z.number(), loss: z.number() })),
  }).nullable(),
  series: z.array(z.object({
    date: z.iso.date(),
    aleMean: z.number().nullable(),
    likelihood: z.number().nullable(),
    likelihoodP10: z.number().nullable(),
    likelihoodP90: z.number().nullable(),
    exceedance: z.number().nullable(),
  })),
});

const RiskTreatmentCardSchema = z.object({
  scenarioId: z.uuid(),
  name: z.string(),
  organizationId: z.uuid(),
  attackOutcomeName: z.string(),
  noMappedAsset: z.boolean(),
  simulated: z.boolean(),
  aleMean: z.number().nullable(),
  topControlMoves: z.array(TopControlMoveSchema),
  scopeTolerance: RiskToleranceSchema.nullable(),
  ownTolerance: RiskToleranceSchema.nullable(),
});

const ToleranceGapsSchema = z.object({
  rows: z.array(z.object({
    scenarioId: z.uuid(),
    name: z.string(),
    organizationId: z.uuid(),
    organizationName: z.string().nullable(),
    tolerance: RiskToleranceSchema,
    source: z.enum(['scenario', 'scope']),
    loss: z.number(),
    gap: z.number(),
    ratio: z.number(),
    outside: z.boolean(),
    scopeTolerance: RiskToleranceSchema.nullable(),
    ownTolerance: RiskToleranceSchema.nullable(),
  })),
  noToleranceCount: z.number().int(),
  noToleranceScopes: z.array(z.object({
    organizationId: z.uuid(),
    organizationName: z.string().nullable(),
  })),
});

const ToleranceCountSchema = z.object({
  organizationId: z.uuid(),
  assessed: z.number().int(),
  outside: z.number().int(),
});

const ScopeThreatSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  entityType: z.enum(THREAT_ENTITY_TYPES),
  activityScore: z.number().nullable(),
  lastObservedAt: z.date().nullable(),
  scenarioCount: z.number().int(),
});

const TacticGainsSchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  techniques: z.array(z.object({
    id: z.uuid(),
    externalId: z.string(),
    name: z.string(),
    prevention: z.number(),
    detection: z.number(),
    total: z.number(),
  })),
});

const ASSET_EXPOSURE_VALUES = ['internet_facing', 'internal', 'unknown'] as const satisfies ReadonlyArray<SupportingAssetExposure>;

const TechniqueFindingCountSchema = z.object({
  mitreTechniqueId: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  applicableFindings: z.number().int(),
});

const FindingsOverviewSchema = z.object({
  summary: z.object({
    activeCount: z.number().int(),
    criticalCount: z.number().int(),
    highCount: z.number().int(),
    kevCount: z.number().int(),
    impactedAssetCount: z.number().int(),
    severityDistribution: z.object({
      critical: z.number().int(),
      high: z.number().int(),
      medium: z.number().int(),
      low: z.number().int(),
      none: z.number().int(),
      unscored: z.number().int(),
    }),
  }),
  topFindings: z.array(z.object({
    evidenceId: z.uuid(),
    supportingAssetId: z.uuid(),
    assetName: z.string().nullable(),
    assetDerivedName: z.string().nullable(),
    cveId: z.string(),
    cvss: z.number().nullable(),
    epss: z.number().nullable(),
    kev: z.boolean().nullable(),
  })),
  topCves: z.array(z.object({
    cveId: z.string(),
    cvss: z.number().nullable(),
    epss: z.number().nullable(),
    kev: z.boolean(),
    impactedAssetCount: z.number().int(),
  })),
});

const RemediationPaceFiguresSchema = z.object({
  newInWindow: z.number().int(),
  closedInWindow: z.number().int(),
  newPerMonth: z.number(),
  closedPerMonth: z.number(),
  capacityPerMonth: z.number(),
  occupancy: z.number().nullable(),
  openCount: z.number().int(),
  openAtWindowStart: z.number().int(),
  medianDaysOpen: z.number().nullable(),
  meanDaysOpen: z.number().nullable(),
  occupancyHistory: z.array(z.number().nullable()),
  months: z.array(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    newCount: z.number().int(),
    closedCount: z.number().int(),
    openAtEnd: z.number().int(),
  })),
});

const RemediationPaceSchema = z.object({
  windowDays: z.number().int(),
  measurableFrom: z.iso.date().nullable(),
  measurable: z.boolean(),
  total: RemediationPaceFiguresSchema,
  bands: z.array(RemediationPaceFiguresSchema.extend({ band: z.enum(SEVERITY_BANDS) })),
});

const ScenarioRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  organizationId: z.uuid(),
});

const ExposureFlowSchema = z.object({
  scenarios: z.array(z.object({
    scenarioId: z.uuid(),
    name: z.string(),
    organizationId: z.uuid(),
    outcomeId: z.uuid(),
    outcomeName: z.string(),
    ale: z.number(),
    aleP10: z.number().nullable(),
    aleP90: z.number().nullable(),
    lefMean: z.number().nullable(),
    primaryAssets: z.array(z.object({
      id: z.uuid(),
      name: z.string(),
    })),
    groups: z.array(z.object({
      key: z.uuid().nullable(),
      name: z.string().nullable(),
      entityType: z.enum(THREAT_ENTITY_TYPES).nullable(),
      actorClass: z.enum(ACTOR_CLASS_VALUES).nullable(),
      share: z.number(),
      vulnerabilityMean: z.number(),
    })),
    techniques: z.array(z.object({
      techniqueId: z.uuid(),
      externalId: z.string(),
      name: z.string(),
      value: z.number(),
    })),
    driverExpectations: z.array(z.object({
      driverId: z.uuid(),
      name: z.string(),
      lossCategoryId: z.uuid(),
      lossCategoryName: z.string(),
      minValue: z.number(),
      likelyValue: z.number(),
      maxValue: z.number(),
    })),
  })),
  unsimulatedScenarios: z.array(ScenarioRefSchema),
  unpricedScenarios: z.array(ScenarioRefSchema),
  unmappedScenarios: z.array(ScenarioRefSchema),
  totals: z.object({
    aleMean: z.number().nullable(),
  }),
});

const ExposureBandInput = z.object({
  organizationId: z.uuid().optional(),
  /** Null means the whole history. */
  windowDays: z.number().int().positive().nullable(),
});

const ExposureBandSchema = z.array(z.object({
  date: z.iso.date(),
  aleMean: z.number().nullable(),
  lefMean: z.number().nullable(),
}));

const AssetsOverviewSchema = z.object({
  topAssets: z.array(z.object({
    id: z.uuid(),
    name: z.string().nullable(),
    derivedName: z.string().nullable(),
    criticality: z.enum(ASSET_CRITICALITY_VALUES),
    score: z.number(),
    applicableCount: z.number().int(),
    criticalOrHighCount: z.number().int(),
  })),
  byCategory: z.array(z.object({
    categoryId: z.enum(ASSET_CATEGORY_VALUES),
    assetCount: z.number().int(),
    impactedAssetCount: z.number().int(),
  })),
  byExposure: z.array(z.object({
    exposure: z.enum(ASSET_EXPOSURE_VALUES),
    assetCount: z.number().int(),
    impactedAssetCount: z.number().int(),
  })),
});

export const dashboardRouter = (procedure: TenantProcedure) => router({
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's scenarios
  getScenarioSummaries: procedure
    .input(WindowedDashboardInput)
    .output(z.array(ScenarioSummarySchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getScenarioSummaries(input.organizationId, input.windowDays)),
  // bounded-by: windowDays, one point per day, 366 at most
  getExposureTrend: procedure
    .input(WindowedDashboardInput)
    .output(z.array(TrendPointSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getExposureTrend(input.organizationId, input.windowDays)),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's risk scopes
  getRiskScopeFigures: procedure
    .input(RiskScopeFiguresInput)
    .output(z.array(RiskScopeFiguresSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getRiskScopeFigures(input.windowDays)),
  getExposureFlow: procedure
    .input(DashboardInput)
    .output(ExposureFlowSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getExposureFlow(input.organizationId)),
  // bounded-by: the timeline's axis, MAX_AXIS_POINTS days at most
  getExposureBand: procedure
    .input(ExposureBandInput)
    .output(ExposureBandSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getExposureBand(input)),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's scenarios, one headline card each
  getRiskTreatment: procedure
    .input(RiskTreatmentInput)
    .output(z.array(RiskTreatmentCardSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getRiskTreatment(input)),
  // bounded-by: windowDays, one point per day, 731 at most
  getRiskTreatmentSeries: procedure
    .input(RiskTreatmentSeriesInput)
    .output(RiskTreatmentSeriesSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getRiskTreatmentSeries(input)),
  // eslint-disable-next-line app/no-unbounded-list-query -- one row per risk scope of the tenant
  getToleranceCounts: procedure
    .input(DashboardInput)
    .output(z.array(ToleranceCountSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getToleranceCounts(input.organizationId)),
  getToleranceGaps: procedure
    .input(DashboardInput)
    .output(ToleranceGapsSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getToleranceGaps(input.organizationId)),
  // bounded-by: TOP_CONTROLS_LIMIT, applied after ranking
  getTopControls: procedure
    .input(DashboardInput)
    .output(z.array(TopControlSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getTopControls(input.organizationId)),
  // bounded-by: TOP_CONTROLS_LIMIT, applied after ranking
  getTopControlMoves: procedure
    .input(DashboardInput)
    .output(z.array(TopControlMoveSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getTopControlMoves(input.organizationId)),
  // bounded-by: MOST_ACTIVE_THREATS_LIMIT, applied after ranking
  getMostActiveThreats: procedure
    .input(DashboardInput)
    .output(z.array(ScopeThreatSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getMostActiveThreats(input.organizationId)),
  // bounded-by: the ATT&CK catalogue, each priced technique once under each of its tactics
  getTechniqueGains: procedure
    .input(DashboardInput)
    .output(z.array(TacticGainsSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getTechniqueGains(input.organizationId)),
  // bounded-by: the ATT&CK catalogue, each technique with an applicable finding once
  getTechniqueFindingCounts: procedure
    .input(DashboardInput)
    .output(z.array(TechniqueFindingCountSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getTechniqueFindingCounts(input.organizationId)),
  getFindingsOverview: procedure
    .input(DashboardInput)
    .output(FindingsOverviewSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getFindingsOverview(input.organizationId)),
  getRemediationPace: procedure
    .input(DashboardInput.extend({ windowDays: z.union([z.literal(30), z.literal(90)]) }))
    .output(RemediationPaceSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getRemediationPace(input)),
  getAssetsOverview: procedure
    .input(DashboardInput)
    .output(AssetsOverviewSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboard.getAssetsOverview(input.organizationId)),
  getTenantHomeDashboard: procedure
    .output(z.string().nullable())
    .query(({ ctx: { services, origin } }) =>
      services.withOrigin(origin).dashboardSettings.getTenantHomeDashboard()),
  setTenantHomeDashboard: procedure
    .use(userSessionOnly)
    .input(z.object({ dashboardId: dashboardIdSchema }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      if (!await scoped.capabilities.hasManageSecurity()) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await scoped.dashboardSettings.setTenantHomeDashboard(input.dashboardId);
    }),
});
