import {
  activityWeightFor,
  originMarkingScope,
  SEVERITY_BANDS,
  THREAT_CVE_PRESENCES,
  THREAT_ENTITY_TYPES,
  THREAT_LIST_SORT_KEYS,
  THREAT_SOURCE_KINDS,
  threatAnalyses,
  threatAnalysisCves,
  threatAnalysisLocations,
  threatAnalysisSectors,
  threatAnalysisTechniques,
} from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { estateInput, resolveMappedOrganizationId } from '../estate';
import { pagedInput, pagedOutput } from '../pagination';

const EntityTypeSchema = z.enum(THREAT_ENTITY_TYPES);

const ThreatAnalysisSchema = createSelectSchema(threatAnalyses, { entityType: EntityTypeSchema }).omit({ nameFolded: true });

const CatalogVolumesSchema = z.object({
  threatActors: z.number().int(),
  intrusionSets: z.number().int(),
  campaigns: z.number().int(),
  active: z.number().int(),
  citedCves: z.number().int(),
});

const AnchorProvenanceSchema = z.enum(['observed', 'authored', 'none']);

// Recency-based activity assessment, read from the columns the `threat-activity-recompute` job
// stores. Spread into the shared list/relevant row shapes; nested under `activity` on the detail.
// `lastActivityAt` is the blended anchor the risk engine consumes, so it falls back to an authoring
// date. A surface stating when an actor was seen reads `lastObservedAt`, the only date a recency
// grade is derived from.
const activityFields = {
  activityScore: z.number().min(0).max(1).nullable(),
  lastActivityAt: z.date().nullable(),
  lastObservedAt: z.date().nullable(),
  anchorProvenance: AnchorProvenanceSchema,
};

// Which attributed threat supplied `lastObservedAt`; null when the threat's own date is the latest
// or the source no longer resolves. Only the detail and the relevance proof state it.
const LastObservedViaSchema = z.object({
  id: z.uuid(),
  name: z.string(),
}).nullable();

const ThreatListItemSchema = z.object({
  id: z.uuid(),
  stixId: z.string(),
  name: z.string(),
  entityType: EntityTypeSchema,
  mitreGroupId: z.string().nullable(),
  stixCreated: z.date().nullable(),
  updatedAt: z.date(),
  cveCount: z.number().int(),
  techniqueCount: z.number().int(),
  ...activityFields,
});

// The outcome match displayed on the list: the winning outcome with no `outcomeId` filter, or the
// filtered outcome's own score (0 dropped by the service) when one is passed. `cveCount` /
// `techniqueCount` are overridden nullable here, unlike the base schema: this list reads them from
// a projection the recompute job may not have covered yet, where `null` means "not computed" and
// must not be shown as a real zero. `topOutcomeScore` follows the same rule. The CVE detail page's
// citing list (`ThreatCitingCveSchema`, also built on the base schema) aggregates its counts
// live instead, so it keeps the non-null base fields.
const ThreatListRowSchema = ThreatListItemSchema.extend({
  kind: z.enum(THREAT_SOURCE_KINDS),
  cveCount: z.number().int().nullable(),
  techniqueCount: z.number().int().nullable(),
  topOutcomeName: z.string().nullable(),
  topOutcomeScore: z.number().min(0).max(1).nullable(),
});

const ThreatListInputSchema = pagedInput(THREAT_LIST_SORT_KEYS).extend({
  outcomeId: z.uuid().optional(),
  search: z.string().trim().min(1).max(200).optional(),
  entityType: EntityTypeSchema.optional(),
  kind: z.enum(THREAT_SOURCE_KINDS).optional(),
});

const ThreatListResultSchema = pagedOutput(ThreatListRowSchema).extend({
  // Analyses the recompute has never covered yet, admitted to the page like any other row (see
  // `countPendingAnalyses`) but called out here so the UI can explain their blank columns.
  pending: z.number().int(),
  // OpenCTI did not say what the reader may read there, so the mirrored threats they see are only
  // the unmarked ones.
  readerScopeUnresolved: z.boolean(),
});

// The citing rows carry the STIX id of the vulnerability object the relationship pointed at, which
// is what the OpenCTI deep link on the card resolves.
const ThreatCitingCveSchema = ThreatListItemSchema.extend({
  vulnerabilityStixId: z.string().nullable(),
});

const OriginSchema = z.object({
  kind: z.enum(THREAT_SOURCE_KINDS),
  stixId: z.string(),
  firstIngestedAt: z.date(),
  lastIngestedAt: z.date(),
});

// Only a connector-origin actor's relationship ids resolve on the tenant's own OpenCTI, so the
// claim carries the id it may be linked by rather than the one it was stored under.
const claimLinkFields = {
  openctiStixRelationId: z.string().nullable(),
};

const LocationDetailSchema = createSelectSchema(threatAnalysisLocations)
  .pick({ id: true, stixId: true, name: true, country: true })
  .extend({
    countryId: z.uuid().nullable(),
    countryIsoAlpha2: z.string().nullable(),
    matchesOrganization: z.boolean(),
    ...claimLinkFields,
  });

const SectorDetailSchema = createSelectSchema(threatAnalysisSectors)
  .pick({ id: true, stixId: true, name: true })
  .extend({
    sectorId: z.uuid().nullable(),
    matchesOrganization: z.boolean(),
    ...claimLinkFields,
  });

const CveDetailSchema = createSelectSchema(threatAnalysisCves)
  .pick({ id: true, stixId: true, cveId: true })
  .extend(claimLinkFields);

const CveActivityEntrySchema = z.object({
  analysisId: z.uuid(),
  state: z.enum(['applicable', 'inactive']),
  stateChangedAt: z.date(),
});

const TacticRefSchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  name: z.string(),
});

const TechniqueDetailSchema = createSelectSchema(threatAnalysisTechniques)
  .pick({ id: true, stixId: true, name: true, mitreExternalId: true })
  .extend({
    // Every id the actor cited for it: the revoked ids it succeeds, and `mitreExternalId` when cited as it is.
    citedExternalIds: z.array(z.string()),
    mitreTechniqueId: z.uuid().nullable(),
    mitreTechniqueUrl: z.string().nullable(),
    tactics: z.array(TacticRefSchema),
    ...claimLinkFields,
  });

const DeclaredIntentValueSchema = z.object({ value: z.string() });

const DeclaredIntentSchema = z.object({
  primaryMotivations: z.array(DeclaredIntentValueSchema),
  secondaryMotivations: z.array(DeclaredIntentValueSchema),
  goals: z.array(DeclaredIntentValueSchema),
});

const ThreatReferenceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  entityType: EntityTypeSchema,
});

const AnalysisDetailSchema = z.object({
  analysis: ThreatAnalysisSchema,
  attributedTo: z.array(ThreatReferenceSchema),
  attributedFrom: z.array(ThreatReferenceSchema),
  // STIX open vocabularies, shown as the source stated them.
  threatActorTypes: z.array(z.string()),
  roles: z.array(z.string()),
  origin: OriginSchema,
  activity: z.object({ ...activityFields, lastObservedVia: LastObservedViaSchema }),
  locations: z.array(LocationDetailSchema),
  sectors: z.array(SectorDetailSchema),
  cves: z.array(CveDetailSchema),
  techniques: z.array(TechniqueDetailSchema),
  declaredIntent: DeclaredIntentSchema,
});

// The counter's stored percentage for the outcome, null on every outcome when `evidenceSufficient` is
// false: the threat's record is too thin for its percentages to say anything. `judgedOn` is the calendar
// date of the judgment set when a judgment gave this row's percentage, null when the counter did.
const OutcomeScoreDetailSchema = z.object({
  attackOutcomeId: z.uuid(),
  outcomeName: z.string(),
  score: z.number().min(0).max(1).nullable(),
  evidenceSufficient: z.boolean(),
  judgedOn: z.iso.date().nullable(),
});

const RelevantThreatSchema = z.object({
  id: z.uuid(),
  // The key OpenCTI and OpenAEV hold the same threat under: the row's pivots resolve it.
  stixId: z.string(),
  name: z.string(),
  entityType: EntityTypeSchema,
  mitreGroupId: z.string().nullable(),
  ...activityFields,
  activityWeight: z.number().min(0).max(1),
  countryMatch: z.boolean(),
  sectorMatch: z.boolean(),
  combinedRelevance: z.number().min(0).max(1),
  // STIX `resource_level` as the source stated it: an open vocabulary a tenant may extend, so it
  // is never translated and never ranked.
  resourceLevel: z.string().nullable(),
  countries: z.array(z.string()),
  sectors: z.array(z.string()),
  // The exact targeted name that matches the organization's country/sector, if any: lets the
  // frontend highlight it within `countries`/`sectors` without re-deriving the match itself.
  matchedCountry: z.string().nullable(),
  matchedSector: z.string().nullable(),
});

// Written by hand rather than derived from the `*DetailSchema` above: those omit `producerStixId`,
// `producerName` and `isInferred`, which is precisely the payload a proof
// exists to deliver.
const proofClaimFields = {
  stixRelationId: z.string(),
  producerStixId: z.string().nullable(),
  producerName: z.string().nullable(),
  isInferred: z.boolean(),
  relConfidence: z.number().int().nullable(),
  relCreated: z.date().nullable(),
  relStartTime: z.date().nullable(),
  relStopTime: z.date().nullable(),
  relModified: z.date().nullable(),
  openctiStixRelationId: z.string().nullable(),
};

const DimensionClaimSchema = z.object({ ...proofClaimFields, name: z.string() });

// What was stored for the threat on this outcome: the percentage (null when none was) and whether the
// threat's record had enough data for the percentage to weigh. `judgedOn` is the calendar date of the
// judgment set the percentage comes from, null when the counter gave it. The panel states these and nothing
// about how the model reached them.
const OutcomeAssessmentSchema = z.object({
  probability: z.number().min(0).max(1).nullable(),
  evidenceSufficient: z.boolean(),
  modelVersion: z.string().nullable(),
  judgedOn: z.iso.date().nullable(),
});

const DimensionExplanationSchema = z.object({
  matched: z.boolean(),
  matchedValue: z.string().nullable(),
  organizationValue: z.string().nullable(),
  claims: z.array(DimensionClaimSchema),
});

const RelevanceProofSchema = z.object({
  gate: z.number().int(),
  unstatedConfidence: z.number().int(),
  ...activityFields,
  activityWeight: z.number().min(0).max(1),
  unknownActivityAgeDays: z.number().int(),
  lastObservedVia: LastObservedViaSchema,
  // Null only for an outcome row the tenant no longer carries; every surface falls back to the
  // generic wording rather than inventing a name.
  attackOutcomeName: z.string().nullable(),
  // The actor's own STIX id, for the panel header's OpenCTI link. Its kind travels with it: only a
  // connector origin guarantees the id resolves on the tenant's platform.
  origin: OriginSchema.pick({ stixId: true, kind: true }).extend({ entityType: EntityTypeSchema }),
  outcome: OutcomeAssessmentSchema,
  // Null for a caller with no organization behind it, which argues an outcome score alone.
  relevance: z.object({
    score: z.number().min(0).max(1),
    country: DimensionExplanationSchema,
    sector: DimensionExplanationSchema,
  }).nullable(),
});

const RelevantForScenarioSchema = z.object({
  items: z.array(RelevantThreatSchema),
});

const MatchingActorForOutcomeSchema = z.object({
  analysisId: z.uuid(),
  analysisName: z.string(),
  entityType: EntityTypeSchema,
  score: z.number().min(0).max(1),
});

const OutcomeDistributionBucketSchema = z.object({
  value: z.string().nullable(),
  count: z.number().int(),
  share: z.number().min(0).max(1),
});

const MatchingActorsForOutcomeSchema = z.object({
  gate: z.number().int(),
  matchingCount: z.number().int(),
  // Computed over every matching actor, never just the ones `topActors` carries.
  distributions: z.object({
    resourceLevel: z.array(OutcomeDistributionBucketSchema),
    primaryMotivation: z.array(OutcomeDistributionBucketSchema),
  }),
  topActors: z.array(MatchingActorForOutcomeSchema),
});

const ThreatCveFindingSchema = z.object({
  cveId: z.string(),
  cveTitle: z.string().nullable(),
  knownExploited: z.boolean().nullable(),
  epss: z.number().nullable(),
  presence: z.enum(THREAT_CVE_PRESENCES),
  score: z.number().int().nullable(),
  band: z.enum(SEVERITY_BANDS).nullable(),
  worstScore: z.number().int().nullable(),
  worstBand: z.enum(SEVERITY_BANDS).nullable(),
  pendingVector: z.boolean(),
  affectedAssetCount: z.number().int(),
  sources: z.array(z.string()),
  firstSeenAt: z.date().nullable(),
  openctiStixRelationId: z.string().nullable(),
});

export const threatsRouter = (procedure: TenantProcedure) => router({
  list: procedure
    .input(ThreatListInputSchema)
    .output(ThreatListResultSchema)
    .query(async ({ input, ctx: { services, origin } }) => ({
      ...await services.withOrigin(origin).threatAnalyses.list(input),
      readerScopeUnresolved: originMarkingScope(origin) === null,
    })),

  deleteImported: procedure
    .input(z.array(z.uuid()).min(1))
    .output(z.object({ deleted: z.number().int() }))
    .mutation(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .threatAnalyses.deleteImported(input)),

  // Existence only, for a caller that needs to distinguish "no threats imported" from "no matches"
  // without paying for the tenant's whole catalog.
  hasAny: procedure
    .output(z.boolean())
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .threatAnalyses.hasAny()),

  getCatalogVolumes: procedure
    .output(CatalogVolumesSchema)
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .threatAnalyses.getCatalogVolumes()),

  getCatalogKpis: procedure
    .output(CatalogVolumesSchema.omit({ citedCves: true }).extend({
      strongOutcomeMatches: z.number().int(),
      targetedCves: z.number().int(),
      targetedCvesOnEstate: z.number().int(),
    }))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .threatAnalyses.getCatalogKpis()),

  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the threat analyses citing the CVE
  getByCveId: procedure
    .input(z.object({ cveId: z.string() }))
    .output(z.array(ThreatCitingCveSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .threatAnalyses.getByCveId(input.cveId)),

  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the targeting windows of the analyses citing the CVE
  getActivityForCve: procedure
    .input(z.object({ cveId: z.string() }))
    .output(z.array(CveActivityEntrySchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .threatAnalyses.getActivityForCve(input.cveId)),

  // bounded-by: the CVEs one threat targets
  listCveFindings: procedure
    .input(estateInput.extend({ threatId: z.uuid() }))
    .output(z.array(ThreatCveFindingSchema).nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return await svc.findingScore.listThreatCveFindings({
        threatId: input.threatId,
        mappedToOrganizationId: await resolveMappedOrganizationId(svc, input.organizationId),
      }) ?? null;
    }),

  getDetail: procedure
    .input(z.object({ id: z.uuid() }))
    .output(AnalysisDetailSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .threatAnalyses.getDetail(input.id) ?? null),

  // bounded-by: the attack-outcome catalogue, one score per outcome
  getOutcomeScoresForAnalysis: procedure
    .input(z.object({ analysisId: z.uuid() }))
    .output(z.array(OutcomeScoreDetailSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .threatAnalyses.getOutcomeScoresForAnalysis(input.analysisId)),

  // The attack outcome overview's sole owner of "who is coming for this outcome": the threat
  // distribution is computed over every matching actor server-side, the table gets only the top
  // ones — never the whole matching set shipped to the client.
  getMatchingActorsForOutcome: procedure
    .input(z.object({ attackOutcomeId: z.uuid() }))
    .output(MatchingActorsForOutcomeSchema)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .threatAnalyses.getMatchingActorsForOutcome(input.attackOutcomeId)),

  getRelevantForScenario: procedure
    .input(z.object({ scenarioId: z.uuid() }))
    .output(RelevantForScenarioSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);

      const scenario = await scoped.riskScenarios.getRiskScenario(input.scenarioId);
      if (!scenario) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scenario not found' });
      }

      const organization = await scoped.organizations.getOrganization(scenario.organizationId);
      if (!organization) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scope not found' });
      }

      return scoped.threatAnalyses.getRelevantForScenario({
        attackOutcomeId: scenario.attackOutcomeId,
        countryIds: organization.countryId ? [organization.countryId] : [],
        sectorIds: organization.sectorId ? [organization.sectorId] : [],
        organizationCountryName: organization.country?.name ?? null,
        organizationSectorName: organization.sector?.name ?? null,
      });
    }),

  // Paid for only when a reader opens a row: the claims travel on no list payload. The scenario's
  // organization is resolved into the country/sector claims the proof argues from.
  getRelevanceProof: procedure
    .input(z.object({ analysisId: z.uuid(), scenarioId: z.uuid() }))
    .output(RelevanceProofSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);

      const resolveTarget = async () => {
        const scenario = await scoped.riskScenarios.getRiskScenario(input.scenarioId);
        if (!scenario) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scenario not found' });
        }

        const organization = await scoped.organizations.getOrganization(scenario.organizationId);
        if (!organization) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scope not found' });
        }

        return {
          attackOutcomeId: scenario.attackOutcomeId,
          countryIds: organization.countryId ? [organization.countryId] : [],
          sectorIds: organization.sectorId ? [organization.sectorId] : [],
          countryName: organization.country?.name ?? null,
          sectorName: organization.sector?.name ?? null,
        };
      };

      const [proof, detail] = await Promise.all([
        scoped.threatAnalyses.getRelevanceProof({
          analysisId: input.analysisId,
          ...await resolveTarget(),
        }),
        scoped.threatAnalyses.getDetail(input.analysisId),
      ]);
      if (!proof) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Threat not found' });
      }
      // Read fresh alongside the rest of the proof, never from the list row: the masthead's score
      // and the Overview's activity badge blend this with `relevance`, read at the same moment.
      if (detail) {
        return { ...proof, ...detail.activity };
      }
      const { unknownActivityAgeDays } = await scoped.threatRelevanceSettings.getThreatRelevanceSettings();
      return {
        ...proof,
        activityScore: null,
        activityWeight: activityWeightFor({ lastObservedAt: null, activityScore: null }, unknownActivityAgeDays),
        unknownActivityAgeDays,
        lastActivityAt: null,
        lastObservedAt: null,
        lastObservedVia: null,
        anchorProvenance: 'none' as const,
      };
    }),
});
