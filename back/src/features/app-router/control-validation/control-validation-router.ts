import {
  CAPABILITY_FUNCTIONS,
  COVERAGE_BUCKETS,
  EVIDENCE_LINE_SORT_KEYS,
  PHISHING_STAGE_NAMES,
  RiskScopeNotFoundError,
  STRENGTH_RUNGS,
  TECHNIQUE_EXTERNAL_ID_PATTERN,
  VALIDATION_STATES,
} from '@app/module';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { pagedInput, pagedOutput } from '../pagination';
import { withNotFoundOn } from '../structured-error-conflict';

// Closed vocabularies are restated here: the select-schema helper widens union text columns back
// to `string`.
const PROVEN_VERDICTS = ['validated', 'contradicted'] as const;

const SECURITY_PLATFORM_TYPE_MAX_LENGTH = 256;

const ValidationCellSchema = z.object({
  techniqueId: z.uuid(),
  techniqueExternalId: z.string(),
  function: z.enum(CAPABILITY_FUNCTIONS),
  state: z.enum(VALIDATION_STATES),
  validatedVotes: z.number().int(),
  totalVotes: z.number().int(),
  latestProofAt: z.date().nullable(),
});

const ControlValidationSummarySchema = z.object({
  validatedTechniques: z.number().int(),
  contradictedTechniques: z.number().int(),
  testedTechniques: z.number().int(),
  latestProofAt: z.date().nullable(),
});

const ValidationEvidenceAssetSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  derivedName: z.string().nullable(),
  verdict: z.enum(PROVEN_VERDICTS),
});

const ValidationEvidenceLineHeaderSchema = z.object({
  techniqueId: z.uuid(),
  techniqueExternalId: z.string(),
  function: z.enum(CAPABILITY_FUNCTIONS),
  scenarioId: z.string().nullable(),
  scenarioName: z.string().nullable(),
  simulationId: z.string().nullable(),
  securityPlatformType: z.string(),
  verdict: z.enum(PROVEN_VERDICTS),
  evaluatedAt: z.date(),
});

const ValidationEvidenceLineSummarySchema = ValidationEvidenceLineHeaderSchema.extend({
  assetCounts: z.object({ validated: z.number().int(), contradicted: z.number().int() }),
});

const ValidationEvidenceLineSchema = ValidationEvidenceLineSummarySchema.extend({
  assets: z.array(ValidationEvidenceAssetSchema),
});

const ControlScopeInput = z.object({ capabilityId: z.uuid(), organizationId: z.uuid().nullish() });

const ProvenPostureHistoryLineSchema = z.object({
  function: z.enum(CAPABILITY_FUNCTIONS),
  at: z.date(),
  credited: z.number().int(),
  tested: z.number().int(),
  held: z.number().int(),
});

const TechniqueTestOutcomeSchema = z.object({
  tests: z.number().int(),
  heldTests: z.number().int(),
  rate: z.number(),
  hostsTested: z.number().int(),
  scopeHosts: z.number().int(),
  share: z.number(),
});

/** A reading, `covered` false where the engine does not read the control's family row, with its result alone. */
const techniqueTestReadingSchema = <Shape extends z.ZodRawShape>(identity: Shape) => {
  const key = z.object({
    capabilityId: z.uuid(),
    function: z.enum(CAPABILITY_FUNCTIONS),
    mitreTechniqueId: z.uuid(),
    familyTechniqueId: z.uuid(),
  }).extend(identity);
  return z.discriminatedUnion('covered', [
    key.extend({
      covered: z.literal(true),
      declaration: z.object({
        strengthRung: z.enum(STRENGTH_RUNGS),
        coverageBucket: z.enum(COVERAGE_BUCKETS),
        strength: z.number(),
        coverage: z.number(),
        phishingStage: z.enum(PHISHING_STAGE_NAMES).nullable(),
      }).nullable(),
      declared: z.number(),
      efficacy: z.number(),
      tested: TechniqueTestOutcomeSchema.nullable(),
      parentEfficacy: z.number().nullable(),
    }),
    key.extend({
      covered: z.literal(false),
      tested: TechniqueTestOutcomeSchema.nullable(),
    }),
  ]);
};

const controlIdentity = {
  capabilityExternalId: z.string(),
  capabilityName: z.string(),
  capabilityRungs: z.object({ strengthRung: z.enum(STRENGTH_RUNGS), coverageBucket: z.enum(COVERAGE_BUCKETS) }).nullable(),
};

const TechniqueControlTestReadingSchema = techniqueTestReadingSchema(controlIdentity);

const TechniqueCoverageReadingSchema = techniqueTestReadingSchema({
  ...controlIdentity,
  linked: z.boolean(),
  removedOn: z.enum(['technique', 'parent']).nullable(),
});

export const controlValidationRouter = (procedure: TenantProcedure) => router({
  // bounded-by: one row per control covering or tested on the technique and CAPABILITY_FUNCTIONS value
  getTechniqueTestReadings: procedure
    .input(z.object({ techniqueId: z.uuid(), organizationId: z.uuid().nullish() }))
    .output(z.array(TechniqueControlTestReadingSchema))
    .query(({ input, ctx: { services, origin } }) => withNotFoundOn(RiskScopeNotFoundError, () =>
      services.withOrigin(origin).controlValidation.getTechniqueTestReadings(input.techniqueId, input.organizationId))),

  // bounded-by: one row per catalogue technique the threat plays and CAPABILITY_FUNCTIONS value
  getTechniquesCoverage: procedure
    .input(z.object({ threatId: z.uuid(), organizationId: z.uuid().nullish() }))
    .output(z.array(z.object({
      mitreTechniqueId: z.uuid(),
      function: z.enum(CAPABILITY_FUNCTIONS),
      best: TechniqueCoverageReadingSchema.options[0].nullable(),
      others: z.array(TechniqueCoverageReadingSchema),
    })))
    .query(({ input, ctx: { services, origin } }) => withNotFoundOn(RiskScopeNotFoundError, () =>
      services.withOrigin(origin).controlValidation.getTechniquesCoverage(input.threatId, input.organizationId))),

  // bounded-by: one row per technique the control covers or is tested on, on the function
  getControlTechniqueTestReadings: procedure
    .input(z.object({ capabilityId: z.uuid(), function: z.enum(CAPABILITY_FUNCTIONS), organizationId: z.uuid().nullish() }))
    .output(z.array(techniqueTestReadingSchema({ techniqueExternalId: z.string(), techniqueName: z.string() })))
    .query(({ input, ctx: { services, origin } }) => withNotFoundOn(RiskScopeNotFoundError, () =>
      services.withOrigin(origin).controlValidation.getControlTechniqueTestReadings(input.capabilityId, input.function, input.organizationId))),

  getControlValidation: procedure
    .input(z.object({ capabilityId: z.uuid(), organizationId: z.uuid().nullish() }))
    .output(z.object({ summary: ControlValidationSummarySchema, cells: z.array(ValidationCellSchema) }))
    .query(({ input, ctx: { services, origin } }) => withNotFoundOn(RiskScopeNotFoundError, () =>
      services.withOrigin(origin).controlValidation.getControlValidation(input.capabilityId, input.organizationId))),

  // bounded-by: the newest 500 lines of the control, the first 5 assets of each
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One reads the evidence through it, by name, as a bare array; the UI pages through listControlValidationEvidence
  getControlValidationEvidence: procedure
    .input(ControlScopeInput)
    .output(z.array(ValidationEvidenceLineSchema))
    .query(({ input, ctx: { services, origin } }) => withNotFoundOn(RiskScopeNotFoundError, () =>
      services.withOrigin(origin).controlValidation.getControlValidationEvidence(input.capabilityId, input.organizationId))),

  listControlValidationEvidence: procedure
    .input(pagedInput(EVIDENCE_LINE_SORT_KEYS).extend(ControlScopeInput.shape).extend({
      technique: z.string().regex(TECHNIQUE_EXTERNAL_ID_PATTERN).optional(),
      function: z.enum(CAPABILITY_FUNCTIONS).optional(),
      result: z.enum(PROVEN_VERDICTS).optional(),
      securityPlatformType: z.string().min(1).max(SECURITY_PLATFORM_TYPE_MAX_LENGTH).optional(),
    }))
    .output(pagedOutput(ValidationEvidenceLineSummarySchema).extend({ unfilteredTotal: z.number().int() }))
    .query(({ input: { capabilityId, organizationId, ...query }, ctx: { services, origin } }) => withNotFoundOn(RiskScopeNotFoundError, async () => ({
      ...await services.withOrigin(origin).controlValidation.listControlValidationEvidence(capabilityId, organizationId, query),
      page: query.page,
      limit: query.limit,
    }))),

  // bounded-by: one row per technique the control scores or holds a stored result on, their sub-techniques, and per parent of one
  listControlValidationEvidenceTechniques: procedure
    .input(ControlScopeInput)
    .output(z.array(z.object({ externalId: z.string(), name: z.string() })))
    .query(({ input, ctx: { services, origin } }) => withNotFoundOn(RiskScopeNotFoundError, () =>
      services.withOrigin(origin).controlValidation.listControlValidationEvidenceTechniques(input.capabilityId, input.organizationId))),

  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the recording runs that change the control's proven posture, a year kept
  getProvenPostureHistory: procedure
    .input(z.object({ capabilityId: z.uuid(), organizationId: z.uuid().nullish() }))
    .output(z.array(ProvenPostureHistoryLineSchema))
    .query(({ input, ctx: { services, origin } }) => withNotFoundOn(RiskScopeNotFoundError, () =>
      services.withOrigin(origin).controlValidation.getProvenPostureHistory(input.capabilityId, input.organizationId))),
});
