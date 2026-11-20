import {
  COVERAGE_BUCKETS,
  planRunProfile,
  SCENARIO_READINESS_STATUSES,
  STRENGTH_RUNGS,
  TREATMENT_PLAN_STATUSES,
  treatmentPlanMoves,
  treatmentPlans,
} from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { crqSimulationIdempotencyKey, enqueueRequestedCrqSimulation } from '../../crq-indicators/crq-simulation-queue';
import { enqueuePlanRecompute } from './plan-recompute';

const StatusEnum = z.enum(TREATMENT_PLAN_STATUSES);
const StrengthEnum = z.enum(STRENGTH_RUNGS);
const CoverageEnum = z.enum(COVERAGE_BUCKETS);

const TreatmentPlanMoveSchema = createSelectSchema(treatmentPlanMoves, {
  targetStrengthRung: StrengthEnum.nullable(),
  targetCoverageBucket: CoverageEnum.nullable(),
});

const NamedRefSchema = z.object({ id: z.uuid(), name: z.string().nullable() });

// Zod strips what the output schema does not declare, so every column both tables carry is named
// here or it silently never reaches the client.
const TreatmentPlanSchema = createSelectSchema(treatmentPlans, { status: StatusEnum })
  .extend({
    moves: z.array(TreatmentPlanMoveSchema),
    organization: NamedRefSchema,
    // Null when the plan names no owner, and when it names one the reader cannot see.
    owner: NamedRefSchema.nullable(),
  });

const PlanReturnSchema = z.object({
  costYear1: z.number().nullable(),
  returnPercent: z.number().nullable(),
});

const TreatmentPlanListRowSchema = TreatmentPlanSchema.pick({
  id: true,
  organizationId: true,
  name: true,
  status: true,
  startDate: true,
  endDate: true,
  moves: true,
  organization: true,
  owner: true,
}).extend({
  totalAleReduction: z.number().nullable(),
  expired: z.boolean(),
  pricedAt: z.coerce.date().nullable(),
}).extend(PlanReturnSchema.shape);

// A plan is created and edited as a draft. Moving it out of `draft` stamps the promise in the same
// write, and nothing here can stamp it, so the status is not writable until that transition exists.
const TreatmentPlanValuesSchema = z.object({
  name: z.string().min(1),
  ownerId: z.uuid().nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
  rationale: z.string().nullable().optional(),
  costOneOff: z.number().min(0).nullable().optional(),
  costRecurringAnnual: z.number().min(0).nullable().optional(),
});

const MoveTargetsSchema = z.object({
  capabilityId: z.uuid(),
  targetStrengthRung: StrengthEnum.nullable(),
  targetCoverageBucket: CoverageEnum.nullable(),
}).refine(
  (move) => move.targetStrengthRung !== null || move.targetCoverageBucket !== null,
  { message: 'A move must set a target strength or coverage' },
);

const MovesSchema = z.array(MoveTargetsSchema).refine(
  (moves) => new Set(moves.map((move) => move.capabilityId)).size === moves.length,
  { message: 'A plan takes one move per capability' },
);

// The scope is taken on create and left off the update: a plan's targets and the figures priced
// against them describe one scope, and moving it to another would keep neither.
const TreatmentPlanCreateSchema = TreatmentPlanValuesSchema.extend({
  organizationId: z.uuid(),
  moves: MovesSchema.optional(),
});

const PlanScenarioProjectionSchema = z.object({
  riskScenarioId: z.uuid(),
  name: z.string(),
  readinessStatus: z.enum(SCENARIO_READINESS_STATUSES),
  state: z.enum(['priced', 'expired', 'not-priced']),
  runId: z.uuid().nullable(),
  runCreatedAt: z.coerce.date().nullable(),
  lefMean: z.number().nullable(),
  aleMean: z.number().nullable(),
  aleTargetMean: z.number().nullable(),
  aleReductionMean: z.number().nullable(),
  aleReductionP10: z.number().nullable(),
  aleReductionP90: z.number().nullable(),
  olderThanHeadline: z.boolean(),
});

const PlanProjectionSchema = z.object({
  scenarios: z.array(PlanScenarioProjectionSchema),
  totalAleReduction: z.number().nullable(),
  pricedScenarioCount: z.number().int(),
  scopeScenarioCount: z.number().int(),
  expired: z.boolean(),
  pricedAt: z.coerce.date().nullable(),
}).extend(PlanReturnSchema.shape);

const PlanSimulationStateSchema = z.object({
  toRepriceCount: z.number().int(),
  runningCount: z.number().int(),
});

const PlanCandidateSchema = z.object({
  capabilityId: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  currentStrengthRung: StrengthEnum,
  currentCoverageBucket: CoverageEnum,
  targetStrengthRung: StrengthEnum.nullable(),
  targetCoverageBucket: CoverageEnum.nullable(),
  inPlan: z.boolean(),
  strengthAleReduction: z.number().nullable(),
  coverageAleReduction: z.number().nullable(),
  deployAleReduction: z.number().nullable(),
});

export const treatmentPlansRouter = (procedure: TenantProcedure) => router({
  // eslint-disable-next-line app/no-unbounded-list-query, app/no-full-row-list-output -- grows with the scope's or the tenant's plans, never archived, not capped yet; nests whole treatment_plan_moves rows, not trimmed yet
  getTreatmentPlans: procedure
    .input(z.object({ organizationId: z.uuid().optional() }))
    .output(z.array(TreatmentPlanListRowSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .treatmentPlans.getTreatmentPlans(input.organizationId)),
  // eslint-disable-next-line app/no-full-row-list-output -- nests whole treatment_plan_moves rows, not trimmed yet
  getTreatmentPlan: procedure
    .input(z.object({ id: z.uuid() }))
    .output(TreatmentPlanSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .treatmentPlans.getTreatmentPlan(input.id) ?? null),
  // bounded-by: the control-capability catalogue, one move per control of the plan
  getTreatmentPlanMoves: procedure
    .input(z.object({ planId: z.uuid() }))
    .output(z.array(TreatmentPlanMoveSchema.pick({
      capabilityId: true,
      targetStrengthRung: true,
      targetCoverageBucket: true,
    })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .treatmentPlans.getTreatmentPlanMoves(input.planId)),
  getTreatmentPlanProjection: procedure
    .input(z.object({ planId: z.uuid() }))
    .output(PlanProjectionSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .treatmentPlans.getTreatmentPlanProjection(input.planId) ?? null),
  getTreatmentPlanSimulationState: procedure
    .input(z.object({ planId: z.uuid() }))
    .output(PlanSimulationStateSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scoped = services.withOrigin(origin);
      const scope = await scoped.treatmentPlans.getTreatmentPlanSimulationScope(input.planId);
      if (!scope) {
        return null;
      }
      const running = await scoped.jobs.getActiveIdempotencyKeys(
        origin.tenantId,
        scope.riskScenarioIds.map(crqSimulationIdempotencyKey),
      );
      return { toRepriceCount: scope.toReprice.length, runningCount: running.size };
    }),
  resimulateTreatmentPlanScenarios: procedure
    .input(z.object({ planId: z.uuid() }))
    .output(z.object({ queuedCount: z.number().int() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scoped = services.withOrigin(origin);
      const scope = await scoped.treatmentPlans.getTreatmentPlanSimulationScope(input.planId);
      if (!scope) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await Promise.all(scope.toReprice.map((riskScenarioId) =>
        enqueueRequestedCrqSimulation(scoped, origin, riskScenarioId, planRunProfile(input.planId))));
      return { queuedCount: scope.toReprice.length };
    }),
  // bounded-by: the control-capability catalogue, one candidate per control
  getTreatmentPlanCandidates: procedure
    .input(z.object({ planId: z.uuid() }))
    .output(z.array(PlanCandidateSchema))
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .treatmentPlans.getTreatmentPlanCandidates(input.planId) ?? []),
  // bounded-by: the control-capability catalogue, one candidate per control
  getScopeTreatmentPlanCandidates: procedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.array(PlanCandidateSchema))
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .treatmentPlans.getScopeTreatmentPlanCandidates(input.organizationId) ?? []),
  createTreatmentPlan: procedure
    .input(TreatmentPlanCreateSchema)
    .output(z.uuid())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      const planId = await scoped.treatmentPlans.createTreatmentPlan(input);
      if ((input.moves ?? []).length > 0) {
        await enqueuePlanRecompute(scoped, origin, planId);
      }
      return planId;
    }),
  updateTreatmentPlan: procedure
    .input(z.object({ id: z.uuid(), values: TreatmentPlanValuesSchema.partial() }))
    .mutation(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .treatmentPlans.updateTreatmentPlan(input.id, input.values)),
  deleteTreatmentPlans: procedure
    .input(z.array(z.uuid()))
    .mutation(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .treatmentPlans.deleteTreatmentPlans(input)),
  setTreatmentPlanScope: procedure
    .input(z.object({ planId: z.uuid(), moves: MovesSchema }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      await scoped.treatmentPlans.setTreatmentPlanScope(input.planId, input.moves);
      await enqueuePlanRecompute(scoped, origin, input.planId);
    }),
  addTreatmentPlanMoves: procedure
    .input(z.object({ planId: z.uuid(), moves: MovesSchema.min(1) }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      await scoped.treatmentPlans.addTreatmentPlanMoves(input.planId, input.moves);
      await enqueuePlanRecompute(scoped, origin, input.planId);
    }),
});
