import {
  ASSET_CATEGORY_VALUES,
  ASSET_CRITICALITY_VALUES,
  CAPABILITY_FUNCTIONS,
  COVERAGE_BUCKETS,
  CVE_ID_PATTERN,
  DECLARED_CRITICALITY_VALUES,
  DISMISSAL_TYPE_VALUES,
  EVIDENCE_HISTORY_ORIGINS,
  EXPECTATION_TYPE_VALUES,
  FINDING_SORT_KEYS,
  FINDINGS_SEARCH_MAX_LENGTH,
  INTEGRATION_SOURCES,
  MAPPING_CONFIDENCE_VALUES,
  SEVERITY_BANDS,
  STRENGTH_REFERENCE_RUNGS,
  STRENGTH_RUNGS,
  TECHNIQUE_EXTERNAL_ID_MAX_LENGTH,
  TECHNIQUE_EXTERNAL_ID_PATTERN,
  UNIQUE_FINDING_PAGE_SORT_KEYS,
  UNKNOWN_EXPOSURE_COUNTS_AS_VALUES,
} from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { estateInput, resolveMappedOrganizationId } from '../estate';
import { UniqueFindingRowSchema } from '../unique-finding-row';
import { pagedInput, pagedOutput } from '../pagination';
import { router } from '../../../trpc';

// Closed vocabularies are restated here: the select-schema helper widens union text columns back
// to `string`.
const ASSET_EXPOSURE_VALUES = ['internet_facing', 'internal', 'unknown'] as const;
const EVIDENCE_STATE_VALUES = ['applicable', 'dismissed'] as const;
const SCORE_TERM_KEYS = ['reachabilityAndThreat', 'exploitationControls', 'potentialImpact', 'impactControls'] as const;
const MAPPING_ROLES = ['exploitation_technique', 'primary_impact', 'secondary_impact'] as const;
const CLAIM_LANES = ['supplied', 'curated', 'structural', 'topology'] as const;
const ATTACK_GROUPS = ['exploitation', 'primary_impact', 'secondary_impact', 'weakness'] as const;
const TECHNIQUE_GRAINS = ['sub_technique', 'parent'] as const;
const TECHNIQUE_RESOLUTION_STATES = ['resolved', 'unresolved'] as const;

const ScoredFactorSchema = z.object({ value: z.number() });

const ClaimJustificationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('supplied') }),
  z.object({ kind: z.literal('curated') }),
  z.object({ kind: z.literal('weakness'), cwe: z.array(z.string()) }),
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
]);

const THREAT_SIGNAL_FAMILIES = ['exploitation_probability', 'known_exploited', 'active_threat'] as const;

const TechniquePathSchema = ScoredFactorSchema.extend({
  techniqueId: z.uuid(),
  terms: z.object({
    claimConfidence: z.enum(MAPPING_CONFIDENCE_VALUES),
    declaredMu: z.number(),
    cappedResistance: z.boolean(),
    preventionLetThrough: z.number(),
    detectMu: z.number(),
    detectionCredit: z.number(),
  }),
});

const ControlsFactorSchema = ScoredFactorSchema.extend({
  aggregation: z.enum(['weakest', 'mean']),
  weakestPath: TechniquePathSchema.nullable(),
  paths: z.array(TechniquePathSchema),
});

/**
 * The terms each factor multiplied, which only the detail read carries: the list and the asset
 * section publish the factor values alone, and `ScoredFactorSchema` strips the rest for them.
 */
const ScoreTermsSchema = z.object({
  reachability: ScoredFactorSchema.extend({
    terms: z.object({
      exposureCountedAs: z.enum(UNKNOWN_EXPOSURE_COUNTS_AS_VALUES),
      exposureWeight: z.number(),
      cvssAccess: z.number().nullable(),
    }),
  }),
  threat: ScoredFactorSchema.extend({
    terms: z.object({
      baseFloor: z.number(),
      signals: z.array(z.object({
        family: z.enum(THREAT_SIGNAL_FAMILIES),
        floor: z.number(),
      })),
      maxFloor: z.number(),
      familyCount: z.number().int(),
      lifted: z.number(),
      cvssComplexity: z.number().nullable(),
      damped: z.number(),
      heldAtBaseFloor: z.boolean(),
    }),
  }),
  exploitationControls: ControlsFactorSchema,
  potentialImpact: ScoredFactorSchema.extend({
    terms: z.object({
      criticalityCountedAs: z.enum(DECLARED_CRITICALITY_VALUES),
      criticalityFactor: z.number(),
      cvssImpact: z.number().nullable(),
    }),
  }),
  impactControls: ControlsFactorSchema,
});

const CvssMetricTermSchema = z.object({ value: z.string(), weight: z.number() });

/** The weights behind the vector's two contributions, so a surface can derive them rather than assert them. */
const CvssTermsSchema = z.object({
  access: z.object({
    attackVector: CvssMetricTermSchema,
    privilegesRequired: CvssMetricTermSchema,
    userInteraction: CvssMetricTermSchema,
    product: z.number(),
    maxProduct: z.number(),
  }),
  impact: z.object({
    confidentiality: CvssMetricTermSchema,
    integrity: CvssMetricTermSchema,
    availability: CvssMetricTermSchema,
    intact: z.number(),
    damage: z.number(),
    maxDamage: z.number(),
    heldAtFloor: z.boolean(),
  }),
});

const TechniqueResistanceTermsSchema = z.object({
  techniqueId: z.uuid(),
  base: z.number(),
  gamma: z.number(),
  contributions: z.array(z.object({
    capabilityId: z.uuid(),
    strengthRung: z.enum(STRENGTH_REFERENCE_RUNGS),
    coverageBucket: z.enum(COVERAGE_BUCKETS),
    familyWeight: z.number(),
    efficacy: z.number(),
    rank: z.number().int(),
    credited: z.number(),
  })),
  letThrough: z.number(),
  cveSusceptibility: z.number().nullable(),
  resistance: z.number(),
});

const WeakestPathResistanceSchema = z.object({
  declared: TechniqueResistanceTermsSchema,
  detection: TechniqueResistanceTermsSchema,
});

const CompositionSchema = z.object({
  exploitability: z.number(),
  impact: z.number(),
  product: z.number(),
  raw: z.number(),
  score: z.number(),
});

const ScoredFindingSchema = z.object({
  evidenceId: z.uuid(),
  supportingAssetId: z.uuid(),
  assetName: z.string().nullable(),
  assetDerivedName: z.string().nullable(),
  assetCriticality: z.enum(ASSET_CRITICALITY_VALUES),
  assetExposure: z.enum(ASSET_EXPOSURE_VALUES),
  cveId: z.string().nullable(),
  cveTitle: z.string().nullable(),
  assetCategoryId: z.enum(ASSET_CATEGORY_VALUES),
  assetLastSeenAt: z.date().nullable(),
  assetOwnerName: z.string().nullable(),
  epss: z.number().nullable(),
  knownExploited: z.boolean(),
  sources: z.array(z.string()),
  lastEvaluatedAt: z.date().nullable(),
  firstSeenAt: z.date(),
  currentState: z.enum(EVIDENCE_STATE_VALUES),
  currentStateSince: z.date().nullable(),
  cvssVector: z.string().nullable(),
  score: z.number(),
  band: z.enum(SEVERITY_BANDS),
  reachabilityAndThreat: z.number(),
  exploitability: z.number(),
  impact: z.number(),
  limitingTerm: z.enum(SCORE_TERM_KEYS),
  factors: z.object({
    reachability: ScoredFactorSchema,
    threat: ScoredFactorSchema,
    exploitationControls: ScoredFactorSchema,
    potentialImpact: ScoredFactorSchema,
    impactControls: ScoredFactorSchema,
  }),
});

const AssetTechniqueScoresSchema = z.object({
  techniques: z.array(z.object({
    mitreTechniqueId: z.uuid(),
    externalId: z.string(),
    name: z.string(),
    score: z.number().int(),
    evidenceId: z.uuid().nullable(),
    source: z.enum(['finding', 'susceptibility']),
    lane: z.enum(CLAIM_LANES).nullable(),
    susceptibility: z.object({ rate: z.number(), declared: z.boolean(), expired: z.boolean(), measuredOn: z.string().nullable() }).optional(),
  })),
  findings: z.array(z.object({
    evidenceId: z.uuid(),
    cveId: z.string(),
    cveTitle: z.string().nullable(),
    cvssVector: z.string(),
    epss: z.number().nullable(),
    knownExploited: z.boolean(),
    access: z.number(),
    threat: z.number(),
    impact: z.number(),
  })),
});

const PostureCountsByBandSchema = z.object({
  critical: z.number().int(),
  high: z.number().int(),
  medium: z.number().int(),
  low: z.number().int(),
});

const AssetPostureSchema = z.object({
  score: z.number().int(),
  worstFinding: z.object({
    evidenceId: z.uuid(),
    name: z.string(),
    exploitability: z.number().int(),
    impact: z.number().int(),
    score: z.number(),
  }),
  countsByBand: PostureCountsByBandSchema,
  composition: z.object({
    tail: z.array(z.object({ band: z.enum(SEVERITY_BANDS), count: z.number().int(), pointsPerFinding: z.number() })),
    tailPoints: z.number(),
    removedPoints: z.number(),
    capped: z.boolean(),
    unrounded: z.number(),
  }),
});

const AssetPostureChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first') }),
  z.object({ kind: z.literal('regained') }),
  z.object({ kind: z.literal('worst') }),
  z.object({ kind: z.literal('exploitability'), from: z.number().int() }),
  z.object({ kind: z.literal('tail'), fromApplicable: z.number().int(), toApplicable: z.number().int() }),
  z.object({ kind: z.literal('newWorst') }),
  z.object({ kind: z.literal('resolved'), resolvedName: z.string() }),
]);

const AssetPostureHistoryLineSchema = z.object({
  at: z.date(),
  score: z.number().int().nullable(),
  cause: z.object({
    worstFinding: z.object({ evidenceId: z.uuid(), name: z.string() }).nullable(),
    worstExploitability: z.number().int(),
    countsByBand: PostureCountsByBandSchema,
    change: AssetPostureChangeSchema.nullable(),
  }).nullable(),
});

const FindingScoreHistoryLineSchema = z.object({
  at: z.date(),
  score: z.number().int().nullable(),
  band: z.enum(SEVERITY_BANDS).nullable(),
});

const CvssMetricSchema = z.object({ metric: z.string(), value: z.string() });

const TestTallySchema = z.object({ held: z.number().int(), total: z.number().int() });

const TechniqueTestSectionSchema = z.object({
  here: TestTallySchema.nullable(),
  fleet: TestTallySchema.nullable(),
  platforms: z.array(TestTallySchema.extend({
    securityPlatformType: z.string().nullable(),
    lastRunAt: z.date().nullable(),
  })),
});

const TestScopeSchema = z.object({
  prevention: TestTallySchema.nullable(),
  detection: TestTallySchema.nullable(),
  lastRunAt: z.date().nullable(),
});

const DeclaredControlSchema = z.object({
  capabilityId: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  strengthRung: z.enum(STRENGTH_RUNGS),
  coverageBucket: z.enum(COVERAGE_BUCKETS),
  protectsAssetFamily: z.boolean(),
  scoredHere: z.boolean(),
  standsOn: z.array(z.object({
    mitreTechniqueId: z.uuid(),
    functions: z.array(z.enum(CAPABILITY_FUNCTIONS)),
  })),
  knockedDownHere: z.boolean(),
});

const WeakestPathSchema = z.object({
  externalId: z.string(),
  confidence: z.enum(MAPPING_CONFIDENCE_VALUES),
});

const SideTechniqueSchema = z.object({
  mitreTechniqueId: z.uuid(),
  externalId: z.string(),
  name: z.string().nullable(),
  group: z.enum(ATTACK_GROUPS).nullable(),
  preventingCapabilityIds: z.array(z.uuid()),
  detectingCapabilityIds: z.array(z.uuid()),
});

const FindingScoreColumnsSchema = z.object({
  reachability: z.object({
    exposure: z.enum(ASSET_EXPOSURE_VALUES),
    categoryId: z.enum(ASSET_CATEGORY_VALUES),
    assetLastSeenAt: z.date().nullable(),
    cvssMetrics: z.array(CvssMetricSchema),
  }),
  threat: z.object({
    exploitationProbability: z.number().nullable(),
    knownExploited: z.boolean(),
    activeThreatCount: z.number().int(),
    attackComplexity: z.string().nullable(),
  }),
  validation: z.object({
    techniquesTested: z.number().int(),
    techniquesInReach: z.number().int(),
    prevention: TestTallySchema.nullable(),
    detection: TestTallySchema.nullable(),
    lastRunAt: z.date().nullable(),
  }).nullable(),
  mitigations: z.array(DeclaredControlSchema).nullable(),
  techniqueTests: z.array(z.object({
    mitreTechniqueId: z.uuid(),
    externalId: z.string(),
    name: z.string().nullable(),
    here: TestScopeSchema,
    fleet: TestScopeSchema.extend({ assetCount: z.number().int() }),
  })),
  uncoveredTechniqueExternalIds: z.array(z.string()),
  weakestPath: WeakestPathSchema.nullable(),
  exploitationTechniques: z.array(SideTechniqueSchema),
  impactControls: z.object({
    mitigations: z.array(DeclaredControlSchema).nullable(),
    weakestPath: WeakestPathSchema.nullable(),
    techniques: z.array(SideTechniqueSchema),
  }),
  techniques: z.object({
    state: z.enum(TECHNIQUE_RESOLUTION_STATES),
    rows: z.array(z.object({
      mitreTechniqueId: z.uuid(),
      externalId: z.string(),
      name: z.string(),
      role: z.enum(MAPPING_ROLES),
      lane: z.enum(CLAIM_LANES),
      group: z.enum(ATTACK_GROUPS),
      justification: ClaimJustificationSchema,
      grain: z.enum(TECHNIQUE_GRAINS),
      carriedByAssetFamily: z.boolean(),
    })),
  }).nullable(),
  potentialImpact: z.object({
    criticality: z.enum(ASSET_CRITICALITY_VALUES),
    ownerName: z.string().nullable(),
    cvssMetrics: z.array(CvssMetricSchema),
  }),
});

const FindingBaselinesSchema = z.object({
  windowStart: z.date(),
  findingsStockBefore: z.number().int(),
  impactedAssetsStockBefore: z.number().int(),
  newInPreviousWindow: z.number().int(),
});

const FindingListRowSchema = z.object({
  evidenceId: z.uuid(),
  supportingAssetId: z.uuid(),
  score: z.number().nullable(),
  band: z.enum(SEVERITY_BANDS).nullable(),
  pendingVector: z.boolean(),
  nvdRecordMissing: z.boolean(),
  currentState: z.enum(EVIDENCE_STATE_VALUES),
  /** Of the latest history row, null on a finding that has none. */
  stateOrigin: z.enum(EVIDENCE_HISTORY_ORIGINS).nullable(),
  dismissalType: z.enum(DISMISSAL_TYPE_VALUES).nullable(),
  cveId: z.string().nullable(),
  cveTitle: z.string().nullable(),
  mitreTechniqueExternalId: z.string().nullable(),
  mitreTechniqueName: z.string().nullable(),
  expectationType: z.enum(EXPECTATION_TYPE_VALUES).nullable(),
  assetName: z.string().nullable(),
  assetDerivedName: z.string().nullable(),
  assetCategoryId: z.enum(ASSET_CATEGORY_VALUES),
  assetCriticality: z.enum(ASSET_CRITICALITY_VALUES),
  assetPlatforms: z.array(z.string()),
  assetExposure: z.enum(ASSET_EXPOSURE_VALUES),
  sources: z.array(z.string()),
  sourceCount: z.number().int(),
  lastEvaluatedAt: z.date().nullable(),
  firstSeenAt: z.date(),
});

/** 'user' names a finding with no reporting connector, not a connector: a real sentinel, not a hole in the vocabulary. */
const FindingSourceFilterSchema = z.enum([...INTEGRATION_SOURCES, 'user']).nullable().default(null);

const VulnerabilityFilterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cve'), cveId: z.string().regex(CVE_ID_PATTERN) }),
  z.object({
    kind: z.literal('technique'),
    externalId: z.string().regex(TECHNIQUE_EXTERNAL_ID_PATTERN),
    expectationType: z.enum(EXPECTATION_TYPE_VALUES),
  }),
]);

const UniqueTechniqueFindingSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  expectationType: z.enum(EXPECTATION_TYPE_VALUES),
  tactics: z.array(z.object({ externalId: z.string(), name: z.string() })),
  affectedAssetCount: z.number().int(),
  platforms: z.array(z.string()),
  sources: z.array(z.string()),
  firstSeenAt: z.date().nullable(),
  lastSeenAt: z.date().nullable(),
});

const UniqueCveFindingSchema = z.object({
  cveId: z.string(),
  cveTitle: z.string().nullable(),
  knownExploited: z.boolean(),
  epss: z.number().nullable(),
  score: z.number().int().nullable(),
  band: z.enum(SEVERITY_BANDS).nullable(),
  worstScore: z.number().int().nullable(),
  worstBand: z.enum(SEVERITY_BANDS).nullable(),
  pendingVector: z.boolean(),
  nvdRecordMissing: z.boolean(),
  affectedAssetCount: z.number().int(),
  sources: z.array(z.string()),
  firstSeenAt: z.date().nullable(),
  composition: z.object({
    worst: z.number(),
    levels: z.array(z.object({
      score: z.number().int(),
      band: z.enum(SEVERITY_BANDS),
      assetCount: z.number().int(),
      equivalent: z.number(),
    })),
    equivalentSum: z.number(),
    breadth: z.number(),
    unrounded: z.number(),
  }).nullable(),
});

const UniqueCveFindingAttackSchema = z.object({
  assetCount: z.number().int(),
  rows: z.array(z.object({
    mitreTechniqueId: z.uuid(),
    externalId: z.string(),
    name: z.string(),
    role: z.enum(MAPPING_ROLES),
    lane: z.enum(CLAIM_LANES),
    group: z.enum(ATTACK_GROUPS),
    justification: ClaimJustificationSchema,
    grain: z.enum(TECHNIQUE_GRAINS),
    exposures: z.array(z.enum(ASSET_EXPOSURE_VALUES)),
    assetCount: z.number().int(),
    setAside: z.array(z.object({ categoryId: z.enum(ASSET_CATEGORY_VALUES), assetCount: z.number().int() })),
  })),
  waysIn: z.array(z.object({
    mitreTechniqueId: z.uuid(),
    externalId: z.string(),
    name: z.string(),
    exposures: z.array(z.enum(ASSET_EXPOSURE_VALUES)),
    setAsideOn: z.array(z.enum(ASSET_CATEGORY_VALUES)),
  })),
});

const UniqueFindingReadingSchema = z.object({
  score: z.number().int().nullable(),
  band: z.enum(SEVERITY_BANDS).nullable(),
  worstScore: z.number().int().nullable(),
  affectedAssetCount: z.number().int().nullable(),
});

const UniqueFindingEventSchema = UniqueFindingReadingSchema.extend({
  id: z.uuid(),
  at: z.date(),
  kind: z.enum(['first', 'regained', 'rise', 'fall', 'lost']),
  previous: UniqueFindingReadingSchema.nullable(),
});

const TOP_VULNERABILITIES_LIMIT = 5;

const TopVulnerabilitySchema = z.object({
  cveId: z.string().nullable(),
  cveTitle: z.string().nullable(),
  mitreTechniqueExternalId: z.string().nullable(),
  mitreTechniqueName: z.string().nullable(),
  expectationType: z.enum(EXPECTATION_TYPE_VALUES).nullable(),
  score: z.number().nullable(),
  impactedAssetCount: z.number().int(),
  worstEvidenceId: z.uuid(),
  sources: z.array(z.string()),
});

const FindingsPanelCountsSchema = z.object({
  windowStart: z.date(),
  findings: z.number().int(),
  impactedAssets: z.number().int(),
  newInWindow: z.number().int(),
  estateAssetCount: z.number().int(),
  bands: z.array(z.object({
    band: z.enum(SEVERITY_BANDS),
    total: z.number().int(),
    newInWindow: z.number().int(),
  })),
  pendingVector: z.number().int(),
});

const UniqueFindingsPanelCountsSchema = z.object({
  windowStart: z.date(),
  uniqueFindings: z.number().int(),
  techniqueGroups: z.number().int(),
  newInWindow: z.number().int(),
  bands: z.array(z.object({
    band: z.enum(SEVERITY_BANDS),
    total: z.number().int(),
    newInWindow: z.number().int(),
  })),
  baselines: z.object({
    cveGroupsBefore: z.number().int(),
    bandsBefore: z.array(z.object({ band: z.enum(SEVERITY_BANDS), total: z.number().int() })),
    newInPreviousWindow: z.number().int().nullable(),
  }).nullable(),
});

const OpenFindingFiguresSchema = z.object({
  open: z.number().int(),
  critical: z.number().int(),
  internetExposed: z.number().int(),
  knownExploited: z.number().int(),
  aged: z.number().int(),
});

const TechniqueTestTallySchema = z.object({ held: z.number().int(), total: z.number().int() }).nullable();

const TechniqueTestExpectationSchema = z.object({ current: TechniqueTestTallySchema, previous: TechniqueTestTallySchema });

const TechniqueTestPostureSchema = z.object({
  testedAssetCount: z.number().int(),
  expectations: z.object({ prevention: TechniqueTestExpectationSchema, detection: TechniqueTestExpectationSchema }),
});

export const findingScoreRouter = (procedure: TenantProcedure) => router({
  getFindingBaselines: procedure
    .output(FindingBaselinesSchema)
    .query(({ ctx: { services, origin } }) =>
      services.withOrigin(origin).findingScore.getFindingBaselines()),

  listScoredFindings: procedure
    .input(pagedInput(FINDING_SORT_KEYS).extend(estateInput.shape).extend({
      state: z.enum(EVIDENCE_STATE_VALUES).nullable().default('applicable'),
      source: FindingSourceFilterSchema,
      vulnerability: VulnerabilityFilterSchema.nullable().default(null),
      technique: z.string().regex(TECHNIQUE_EXTERNAL_ID_PATTERN).nullable().default(null),
      search: z.string().trim().min(1).max(FINDINGS_SEARCH_MAX_LENGTH).nullable().default(null),
    }).refine((input) => input.technique === null || input.vulnerability?.kind === 'cve', {
      error: 'A technique narrows the findings of one CVE',
      path: ['technique'],
    }))
    .output(pagedOutput(FindingListRowSchema).extend({ unscored: z.number().int() }))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      if (input.technique !== null && !(await svc.mitreAttack.getTechniqueIdsByExternalIds([input.technique])).has(input.technique)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No ATT&CK technique has this external id' });
      }
      return svc.findingScore.listScoredFindings({
        page: input.page,
        limit: input.limit,
        state: input.state,
        source: input.source,
        vulnerability: input.vulnerability,
        technique: input.technique,
        search: input.search,
        mappedToOrganizationId: await resolveMappedOrganizationId(svc, input.organizationId),
        sortBy: input.sortBy ?? 'score',
        sortDesc: input.sortDesc,
      });
    }),

  listUniqueFindings: procedure
    .input(pagedInput(UNIQUE_FINDING_PAGE_SORT_KEYS).extend(estateInput.shape).extend({
      source: FindingSourceFilterSchema,
      search: z.string().trim().min(1).max(FINDINGS_SEARCH_MAX_LENGTH).nullable().default(null),
    }))
    .output(pagedOutput(UniqueFindingRowSchema))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.findingScore.listUniqueFindings({
        page: input.page,
        limit: input.limit,
        source: input.source,
        search: input.search,
        mappedToOrganizationId: await resolveMappedOrganizationId(svc, input.organizationId),
        sortBy: input.sortBy ?? 'score',
        sortDesc: input.sortDesc,
      });
    }),

  getUniqueTechniqueFinding: procedure
    .input(estateInput.extend({
      externalId: z.string().regex(TECHNIQUE_EXTERNAL_ID_PATTERN),
      expectationType: z.enum(EXPECTATION_TYPE_VALUES),
    }))
    .output(UniqueTechniqueFindingSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return await svc.findingScore.getUniqueTechniqueFinding({
        externalId: input.externalId,
        expectationType: input.expectationType,
        mappedToOrganizationId: await resolveMappedOrganizationId(svc, input.organizationId),
      }) ?? null;
    }),

  /** Its figures never depend on a source: the source filter picks rows of the tab and leaves their figures whole. */
  getUniqueCveFinding: procedure
    .input(estateInput.extend({ cveId: z.string().regex(CVE_ID_PATTERN) }))
    .output(UniqueCveFindingSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return await svc.findingScore.getUniqueCveFinding({
        cveId: input.cveId,
        mappedToOrganizationId: await resolveMappedOrganizationId(svc, input.organizationId),
      }) ?? null;
    }),

  getUniqueCveFindingAttack: procedure
    .input(estateInput.extend({ cveId: z.string().regex(CVE_ID_PATTERN) }))
    .output(UniqueCveFindingAttackSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return await svc.findingScore.getUniqueCveFindingAttack({
        cveId: input.cveId,
        mappedToOrganizationId: await resolveMappedOrganizationId(svc, input.organizationId),
      }) ?? null;
    }),

  listUniqueFindingEvents: procedure
    .input(pagedInput(['changedAt'] as const).omit({ sortBy: true, sortDesc: true }).extend(estateInput.shape).extend({
      cveId: z.string().regex(CVE_ID_PATTERN),
    }))
    .output(pagedOutput(UniqueFindingEventSchema))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.findingScore.listUniqueFindingEvents({
        cveId: input.cveId,
        mappedToOrganizationId: await resolveMappedOrganizationId(svc, input.organizationId),
        page: input.page,
        limit: input.limit,
      });
    }),

  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the recomputes, a line each for a widespread CVE, a year kept, not capped yet
  getUniqueFindingScoreHistory: procedure
    .input(estateInput.extend({ cveId: z.string().regex(CVE_ID_PATTERN) }))
    .output(z.array(UniqueFindingEventSchema))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.findingScore.getUniqueFindingScoreHistory({
        cveId: input.cveId,
        mappedToOrganizationId: await resolveMappedOrganizationId(svc, input.organizationId),
      });
    }),

  /** Every source that reports a finding in the estate the page reads, with its own count — never a hardcoded connector list. */
  // bounded-by: INTEGRATION_SOURCES, one row per connector plus one for findings no connector wrote
  getFindingCountsBySource: procedure
    .input(estateInput.extend({ applicableOnly: z.boolean().default(false) }))
    .output(z.array(z.object({ source: z.string(), findingCount: z.number().int() })))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.findingScore.getFindingCountsBySource(await resolveMappedOrganizationId(svc, input.organizationId), input.applicableOnly);
    }),

  // bounded-by: TOP_VULNERABILITIES_LIMIT, applied as the SQL limit
  getTopVulnerabilities: procedure
    .input(estateInput)
    .output(z.array(TopVulnerabilitySchema))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.findingScore.getTopVulnerabilities(await resolveMappedOrganizationId(svc, input.organizationId), TOP_VULNERABILITIES_LIMIT);
    }),

  getFindingsPanelCounts: procedure
    .input(estateInput)
    .output(FindingsPanelCountsSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.findingScore.getFindingsPanelCounts(await resolveMappedOrganizationId(svc, input.organizationId));
    }),

  getUniqueFindingsPanelCounts: procedure
    .input(estateInput)
    .output(UniqueFindingsPanelCountsSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.findingScore.getUniqueFindingsPanelCounts(await resolveMappedOrganizationId(svc, input.organizationId));
    }),

  getOpenFindingFigures: procedure
    .input(estateInput)
    .output(OpenFindingFiguresSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.findingScore.getOpenFindingFigures(await resolveMappedOrganizationId(svc, input.organizationId));
    }),

  getTechniqueTestPosture: procedure
    .input(estateInput)
    .output(TechniqueTestPostureSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.findingScore.getTechniqueTestPosture(await resolveMappedOrganizationId(svc, input.organizationId));
    }),

  /** One asset's findings: a CVE finding not scored yet is listed with no score rather than counted apart. */
  listAssetFindings: procedure
    .input(pagedInput(FINDING_SORT_KEYS).extend({
      supportingAssetId: z.uuid(),
      state: z.enum(EVIDENCE_STATE_VALUES).nullable().default('applicable'),
      mitreTechniqueExternalId: z.string().min(1).max(TECHNIQUE_EXTERNAL_ID_MAX_LENGTH).nullable().default(null),
      expectationType: z.enum(EXPECTATION_TYPE_VALUES).nullable().default(null),
      search: z.string().trim().min(1).max(FINDINGS_SEARCH_MAX_LENGTH).nullable().default(null),
    }))
    .output(pagedOutput(FindingListRowSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).findingScore.listAssetFindings({ ...input, sortBy: input.sortBy ?? 'score' })),

  getAssetPosture: procedure
    .input(z.object({ supportingAssetId: z.uuid() }))
    .output(AssetPostureSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) =>
      await services.withOrigin(origin).findingScore.getAssetPosture(input.supportingAssetId) ?? null),

  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the recomputes that move the asset's posture, a year kept
  getAssetPostureHistory: procedure
    .input(z.object({ supportingAssetId: z.uuid() }))
    .output(z.array(AssetPostureHistoryLineSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).findingScore.getAssetPostureHistory(input.supportingAssetId)),

  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the recomputes that move the finding's score, a year kept by default
  getFindingScoreHistory: procedure
    .input(z.object({ evidenceId: z.uuid() }))
    .output(z.array(FindingScoreHistoryLineSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).findingScore.getFindingScoreHistory(input.evidenceId)),

  getAssetTechniqueScores: procedure
    .input(z.object({ supportingAssetId: z.uuid() }))
    .output(AssetTechniqueScoresSchema)
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).findingScore.getAssetTechniqueScores(input.supportingAssetId)),

  getAssetTechniqueTests: procedure
    .input(z.object({ supportingAssetId: z.uuid() }))
    .output(z.object({
      prevention: TestTallySchema.nullable(),
      detection: TestTallySchema.nullable(),
      techniques: z.array(z.object({
        mitreTechniqueId: z.uuid(),
        prevention: TestTallySchema.nullable(),
        detection: TestTallySchema.nullable(),
      })),
    }))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).findingScore.getAssetTechniqueTests(input.supportingAssetId)),

  getAssetTechniqueTestDetail: procedure
    .input(z.object({ supportingAssetId: z.uuid(), mitreTechniqueId: z.uuid() }))
    .output(z.object({ prevention: TechniqueTestSectionSchema, detection: TechniqueTestSectionSchema }))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).findingScore.getAssetTechniqueTestDetail(input.supportingAssetId, input.mitreTechniqueId)),

  getFindingScoreBreakdown: procedure
    .input(z.object({ evidenceId: z.uuid() }))
    .output(z.union([
      ScoredFindingSchema.extend({
        columns: FindingScoreColumnsSchema,
        otherImpactedAssetCount: z.number().int(),
        factors: ScoreTermsSchema,
        composition: CompositionSchema,
        resistance: z.object({
          exploitation: WeakestPathResistanceSchema.nullable(),
          impact: WeakestPathResistanceSchema.nullable(),
        }),
        cvss: CvssTermsSchema.nullable(),
      }),
      ScoredFindingSchema.omit({
        score: true,
        band: true,
        reachabilityAndThreat: true,
        exploitability: true,
        impact: true,
        limitingTerm: true,
        factors: true,
      }).extend({
        score: z.null(),
        band: z.null(),
        pendingVector: z.boolean(),
        columns: FindingScoreColumnsSchema,
        otherImpactedAssetCount: z.number().int(),
      }),
    ]).nullable())
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).findingScore.getFindingScoreBreakdown(input.evidenceId)),
});
