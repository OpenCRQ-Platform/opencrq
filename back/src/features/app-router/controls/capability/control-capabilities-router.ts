import type { TenantProcedure } from '../../app-router-router';
import {
  ASSESSMENT_AXES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_MODES,
  ASSET_CATEGORY_VALUES,
  CAPABILITY_FUNCTIONS,
  CONTROL_DOMAINS,
  controlCapabilities,
  controlCapabilityAssessmentEvents,
  COVERAGE_BASES,
  COVERAGE_BUCKETS,
  EFFECTIVE_EDGE_SOURCES,
  EFFECTIVE_EDGE_STATES,
  IncompleteFirstDeclarationError,
  NoDerivedAssessmentError,
  STRENGTH_RUNGS,
} from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { router } from '../../../../trpc';
import { withBadRequestOn } from '../../structured-error-conflict';
import { userSessionOnly } from '../../user-session-only';
import { enqueueLeversOnTenantCrossings } from '../../../crq-indicators/levers-recompute';
import { enqueueCrqSimulationOnScopePostureChange } from './scope-posture-recompute';

const StrengthEnum = z.enum(STRENGTH_RUNGS);
const CoverageEnum = z.enum(COVERAGE_BUCKETS);

const ModeEnum = z.enum(ASSESSMENT_MODES);
const AxisEnum = z.enum(ASSESSMENT_AXES);

const AssessmentSchema = z.object({
  strengthRung: StrengthEnum,
  coverageBucket: CoverageEnum,
  strengthMode: ModeEnum,
  coverageMode: ModeEnum,
  coverageBasis: z.enum(COVERAGE_BASES),
  comment: z.string().nullable(),
});

const AssessedBySchema = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
});

const CapabilitySchema = createSelectSchema(controlCapabilities).extend({
  domain: z.enum(CONTROL_DOMAINS),
  assessment: AssessmentSchema.nullable(),
  lastAssessedAt: z.coerce.date().nullable(),
  lastAssessedBy: AssessedBySchema.nullable(),
  lastAssessedConnector: z.string().nullable(),
});

const FunctionEnum = z.enum(CAPABILITY_FUNCTIONS);

const RungSchema = z.object({ rung: z.string(), label: z.string() });
// `order` is the canonical ATT&CK kill-chain position, the tie-break the Overview function
// cards rank on.
const EdgeTacticSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  order: z.number().int(),
});
// The effective coverage of the control: catalogue recommendations overlaid with the tenant's
// per-technique overrides. `removed` rows stay in the list so the departure remains visible.
const EdgeSchema = z.object({
  techniqueId: z.uuid(),
  techniqueExternalId: z.string(),
  techniqueName: z.string(),
  function: FunctionEnum,
  source: z.enum(EFFECTIVE_EDGE_SOURCES),
  state: z.enum(EFFECTIVE_EDGE_STATES),
  tactics: z.array(EdgeTacticSchema),
});
const CrosswalkSchema = z.object({ framework: z.string(), externalId: z.string() });
const SecurityPlatformFamilySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  platformTypeKey: z.string(),
});
const RiskScenarioSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  sharedTtpCount: z.number().int(),
  mixturePending: z.boolean(),
});

// `frameworkTitle` names a framework source; `drata` and any source no framework claims carry none.
const AssessmentSourceSchema = z.object({
  axis: AxisEnum,
  source: z.string(),
  frameworkTitle: z.string().nullable(),
});

const CapabilityDetailSchema = CapabilitySchema.extend({
  lastDerivedAt: z.coerce.date().nullable(),
  lastDerivedBy: AssessedBySchema.nullable(),
  assessmentSources: z.array(AssessmentSourceSchema),
  rungs: z.array(RungSchema),
  edges: z.array(EdgeSchema),
  crosswalk: z.array(CrosswalkSchema),
  securityPlatformFamilies: z.array(SecurityPlatformFamilySchema),
  protectedFamilies: z.array(z.enum(ASSET_CATEGORY_VALUES)),
});

// One control naming the technique, read from the technique's side. `inheritedFrom` is the parent
// technique the edge is carried by, which is the grain the engine scores for a sub-technique.
const TechniqueCapabilitySchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  function: FunctionEnum,
  source: z.enum(EFFECTIVE_EDGE_SOURCES),
  state: z.enum(EFFECTIVE_EDGE_STATES),
  assessment: AssessmentSchema.nullable(),
  inheritedFrom: z.object({ id: z.uuid(), externalId: z.string(), name: z.string() }).nullable(),
});

const CapabilityEventSchema = createSelectSchema(controlCapabilityAssessmentEvents, {
  createdAt: z.coerce.date(),
  type: z.enum(ASSESSMENT_EVENT_TYPES),
  oldStrength: StrengthEnum.nullable(),
  newStrength: StrengthEnum.nullable(),
  oldCoverage: CoverageEnum.nullable(),
  newCoverage: CoverageEnum.nullable(),
  strengthMode: ModeEnum.nullable(),
  coverageMode: ModeEnum.nullable(),
}).extend({
  userName: z.string().nullable(),
  sources: z.array(z.object({
    axis: AxisEnum,
    source: z.string(),
    frameworkTitle: z.string().nullable(),
    complianceAssessmentId: z.uuid().nullable(),
    complianceAssessmentName: z.string().nullable(),
  })),
});

const PooledAssessmentSchema = z.object({
  strengthRung: StrengthEnum.nullable(),
  coverageBucket: CoverageEnum,
  coverageBasis: z.enum(COVERAGE_BASES),
  assumedFromLevel: z.number().int().nullable(),
});

const POSTURE_SOURCES = ['tenant', 'scope'] as const;

const PostureSchema = z.object({
  strengthRung: StrengthEnum,
  coverageBucket: CoverageEnum,
  strengthSource: z.enum(POSTURE_SOURCES),
  coverageSource: z.enum(POSTURE_SOURCES),
});

// A null posture is a stretch where the control was not assessed, a null event the line bringing
// the replay to the live value.
const EffectivenessHistoryLineSchema = z.object({
  at: z.date(),
  posture: PostureSchema.nullable(),
  event: CapabilityEventSchema.nullable(),
});

const ResolvedPostureSchema = PostureSchema.extend({
  capabilityId: z.uuid(),
  comment: z.string().nullable(),
  tenantStrengthRung: StrengthEnum.nullable(),
  tenantCoverageBucket: CoverageEnum.nullable(),
  scopeDeclaredAt: z.date().nullable(),
});

export const controlCapabilitiesRouter = (authProcedure: TenantProcedure) => router({
  // bounded-by: the control-capability catalogue, 51 controls, one platform-wide copy
  getControlCapabilities: authProcedure
    .output(z.array(CapabilitySchema.pick({
      id: true,
      externalId: true,
      name: true,
      description: true,
      domain: true,
      position: true,
      assessment: true,
      lastAssessedAt: true,
      lastAssessedBy: true,
      lastAssessedConnector: true,
    })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .controlCapabilities.getControlCapabilities()),
  getControlCapability: authProcedure
    .input(z.object({ id: z.uuid() }))
    .output(CapabilityDetailSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const capability = await services.withOrigin(origin).controlCapabilities.getControlCapability(input.id);
      return capability ?? null;
    }),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's scenarios sharing a technique with the control
  getControlCapabilityRiskScenarios: authProcedure
    .input(z.object({ id: z.uuid(), organizationId: z.uuid().optional() }))
    .output(z.array(RiskScenarioSummarySchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .controlCapabilities.getControlCapabilityRiskScenarios(input.id, input.organizationId)),
  // bounded-by: one row per catalogue control and CAPABILITY_FUNCTIONS value
  getCapabilitiesForTechnique: authProcedure
    .input(z.object({ techniqueId: z.uuid() }))
    .output(z.array(TechniqueCapabilitySchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .controlCapabilities.getCapabilitiesForTechnique(input.techniqueId)),
  // A null axis is left as it stands, so declaring coverage alone keeps the strength derived.
  upsertAssessment: authProcedure
    .use(userSessionOnly)
    .input(z.object({
      capabilityId: z.uuid(),
      strengthRung: StrengthEnum.nullable(),
      coverageBucket: CoverageEnum.nullable(),
      reattach: z.array(AxisEnum).default([]),
      comment: z.string().trim().min(1).nullable(),
    }).refine(
      (input) => input.strengthRung !== null || input.coverageBucket !== null || input.reattach.length > 0,
      { message: 'A save names at least one axis' },
    ).refine(
      (input) => !(input.reattach.includes('strength') && input.strengthRung !== null)
        && !(input.reattach.includes('coverage') && input.coverageBucket !== null),
      { message: 'An axis is either declared or re-attached' },
    ))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin, tenantId } }) => {
      const svc = services.withOrigin(origin);
      const crossings = await withBadRequestOn(NoDerivedAssessmentError, () =>
        withBadRequestOn(IncompleteFirstDeclarationError, () =>
          svc.controlCapabilities.upsertAssessment(
            input.capabilityId,
            input.strengthRung,
            input.coverageBucket,
            input.comment,
            input.reattach,
          )));
      await enqueueLeversOnTenantCrossings(svc, origin, tenantId, crossings);
    }),
  // What the derivation would write for this control right now: the re-attach previews read it.
  getPooledAssessment: authProcedure
    .input(z.object({ capabilityId: z.uuid() }))
    .output(PooledAssessmentSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const pooled = await services.withOrigin(origin).controlCapabilities.getPooledAssessments();
      const entry = pooled.find((candidate) => candidate.capabilityId === input.capabilityId);
      return entry === undefined ? null : {
        strengthRung: entry.strengthRung,
        coverageBucket: entry.coverageBucket,
        coverageBasis: entry.coverageBasis,
        assumedFromLevel: entry.assumedFromLevel,
      };
    }),
  addTechniqueOverride: authProcedure
    .use(userSessionOnly)
    .input(z.object({
      capabilityId: z.uuid(),
      techniqueId: z.uuid(),
      function: FunctionEnum,
    }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      await svc.controlCapabilities.addTechnique(input.capabilityId, input.techniqueId, input.function);
    }),
  removeTechnique: authProcedure
    .use(userSessionOnly)
    .input(z.object({ capabilityId: z.uuid(), techniqueId: z.uuid(), function: FunctionEnum }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      await svc.controlCapabilities.removeTechnique(input.capabilityId, input.techniqueId, input.function);
    }),
  restoreTechnique: authProcedure
    .use(userSessionOnly)
    .input(z.object({ capabilityId: z.uuid(), techniqueId: z.uuid(), function: FunctionEnum }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      await svc.controlCapabilities.restoreTechnique(input.capabilityId, input.techniqueId, input.function);
    }),
  // Scoped to one function: every surface that can reset works inside a single function, and an
  // unscoped reset over the API would be the one remaining way to change both without saying so.
  resetTechniqueOverrides: authProcedure
    .use(userSessionOnly)
    .input(z.object({ capabilityId: z.uuid(), function: FunctionEnum }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      await svc.controlCapabilities.resetTechniqueOverrides(input.capabilityId, input.function);
    }),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the control's assessment journal, never trimmed, not capped yet
  getCapabilityEvents: authProcedure
    .input(z.object({ capabilityId: z.uuid(), organizationId: z.uuid().nullish() }))
    .output(z.array(CapabilityEventSchema.pick({
      id: true,
      capabilityId: true,
      tenantId: true,
      organizationId: true,
      userId: true,
      connector: true,
      type: true,
      oldStrength: true,
      newStrength: true,
      oldCoverage: true,
      newCoverage: true,
      strengthMode: true,
      coverageMode: true,
      comment: true,
      createdAt: true,
      userName: true,
      sources: true,
    })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .controlCapabilities.getCapabilityEvents(input.capabilityId, input.organizationId)),

  // eslint-disable-next-line app/no-unbounded-list-query, app/no-full-row-list-output -- grows with the control's assessment journal, never trimmed, not capped yet; nests whole assessment events, not trimmed yet
  getEffectivenessHistory: authProcedure
    .input(z.object({ capabilityId: z.uuid(), organizationId: z.uuid().nullish() }))
    .output(z.array(EffectivenessHistoryLineSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .controlCapabilities.getEffectivenessHistory(input.capabilityId, input.organizationId ?? null)),

  // bounded-by: the control-capability catalogue, one posture per control
  getResolvedControlPosture: authProcedure
    .input(z.object({ organizationId: z.uuid().nullish() }))
    .output(z.array(ResolvedPostureSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .controlCapabilities.getResolvedPosture(input.organizationId ?? null)),

  declareScopeControlPosture: authProcedure
    .use(userSessionOnly)
    .input(z.object({
      organizationId: z.uuid(),
      capabilityId: z.uuid(),
      strengthRung: StrengthEnum.nullable(),
      coverageBucket: CoverageEnum.nullable(),
      comment: z.string().trim().min(1).nullable(),
    }).refine(
      (input) => input.strengthRung !== null || input.coverageBucket !== null,
      { message: 'A declaration names at least one dimension' },
    ))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin, tenantId } }) => {
      const svc = services.withOrigin(origin);
      const { before, after } = await svc.controlCapabilities.declareScopePosture(
        input.organizationId,
        input.capabilityId,
        { strengthRung: input.strengthRung, coverageBucket: input.coverageBucket, comment: input.comment },
      );
      await enqueueCrqSimulationOnScopePostureChange(
        svc, origin, tenantId, input.organizationId, input.capabilityId, before, after,
      );
    }),

  clearScopeControlPosture: authProcedure
    .use(userSessionOnly)
    .input(z.object({
      organizationId: z.uuid(),
      capabilityId: z.uuid(),
      dimension: AxisEnum,
    }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin, tenantId } }) => {
      const svc = services.withOrigin(origin);
      const { before, after } = await svc.controlCapabilities.clearScopePostureDimension(
        input.organizationId,
        input.capabilityId,
        input.dimension,
      );
      await enqueueCrqSimulationOnScopePostureChange(
        svc, origin, tenantId, input.organizationId, input.capabilityId, before, after,
      );
    }),
});
