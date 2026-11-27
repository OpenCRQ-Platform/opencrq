import {
  BUDGET_LINE_MAX_AMORTIZATION_YEARS,
  BUDGET_LINE_NATURES,
  BUDGET_REVIEW_BASKETS,
  BUDGET_REVIEW_FIGURE_STATES,
  BUDGET_REVIEW_STATUSES,
  BUDGET_REVIEW_TOLERANCE_REFERENCES,
  BudgetReviewClosedError,
  BudgetReviewInvalidInputError,
  budgetReviewLines,
  BudgetReviewNotClosedError,
  BudgetReviewNotFoundError,
  BudgetReviewNotPricedError,
  BudgetReviewOutdatedError,
  budgetReviews,
  COVERAGE_BUCKETS,
  CSF_FUNCTIONS,
  STRENGTH_RUNGS,
} from '@app/module';
import { TOLERANCE_SOURCES } from '@app/module/client';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { crqSimulationIdempotencyKey, enqueueRequestedCrqSimulation } from '../../crq-indicators/crq-simulation-queue';
import { withBadRequestOn, withConflictOn, withNotFoundOn } from '../structured-error-conflict';

const StatusEnum = z.enum(BUDGET_REVIEW_STATUSES);
const NatureEnum = z.enum(BUDGET_LINE_NATURES);
const BasketEnum = z.enum(BUDGET_REVIEW_BASKETS);
const FigureStateEnum = z.enum(BUDGET_REVIEW_FIGURE_STATES);

const NamedRefSchema = z.object({ id: z.uuid(), name: z.string().nullable() });

const PostureSchema = z.object({
  strengthRung: z.enum(STRENGTH_RUNGS),
  coverageBucket: z.enum(COVERAGE_BUCKETS),
});

// Zod strips what the output schema does not declare, so every column is named here or it silently
// never reaches the client.
const BudgetReviewSchema = createSelectSchema(budgetReviews, { status: StatusEnum, periodStart: z.iso.date() }).extend({
  // The last day the period covers, so a reader never derives it.
  periodEnd: z.iso.date(),
  organization: NamedRefSchema,
  // Null when the review names no owner, and when it names one the reader cannot see.
  owner: NamedRefSchema.nullable(),
});

const BudgetReviewLineSchema = createSelectSchema(budgetReviewLines, { nature: NatureEnum }).extend({
  capabilityIds: z.array(z.uuid()),
  csfFunctions: z.array(z.enum(CSF_FUNCTIONS)),
});

const BudgetReviewDetailSchema = BudgetReviewSchema.extend({ lines: z.array(BudgetReviewLineSchema) });

const BudgetReviewHeadlineSchema = z.object({
  spent: z.number(),
  aleReductionMean: z.number().nullable(),
  aleReductionP10: z.number().nullable(),
  aleReductionP90: z.number().nullable(),
  returnPercent: z.number().nullable(),
  state: FigureStateEnum,
});

const BudgetReviewListRowSchema = BudgetReviewSchema.pick({
  id: true,
  organizationId: true,
  name: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  organization: true,
  owner: true,
}).extend(BudgetReviewHeadlineSchema.shape).extend({
  lineCount: z.number().int(),
  pricedAt: z.coerce.date().nullable(),
  build: BudgetReviewHeadlineSchema,
});

const BudgetReviewFigureSchema = z.object({
  basket: BasketEnum,
  lineId: z.uuid().nullable(),
  state: FigureStateEnum,
  aleReductionMean: z.number().nullable(),
  aleReductionP10: z.number().nullable(),
  aleReductionP90: z.number().nullable(),
  spent: z.number(),
  returnPercent: z.number().nullable(),
  annualSpent: z.number(),
  amortizedReturnPercent: z.number().nullable(),
  pricedScenarioCount: z.number().int(),
  pricedAt: z.coerce.date().nullable(),
});

const BudgetReviewFiguresSchema = z.object({
  status: StatusEnum,
  closedAt: z.coerce.date().nullable(),
  figures: z.array(BudgetReviewFigureSchema),
  scopeScenarioCount: z.number().int(),
  toRepriceCount: z.number().int(),
  olderThanHeadlineNames: z.array(z.string()),
});

const BudgetReviewControlPosturesSchema = z.object({
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  logStartsAt: z.coerce.date().nullable(),
  logCoversPeriodStart: z.boolean(),
  controls: z.array(z.object({
    capabilityId: z.uuid(),
    externalId: z.string(),
    name: z.string(),
    start: PostureSchema,
    end: PostureSchema,
    moved: z.boolean(),
    buildLine: NamedRefSchema.nullable(),
    runLines: z.array(NamedRefSchema),
  })),
});

const BudgetReviewSimulationStateSchema = z.object({
  toRepriceCount: z.number().int(),
  runningCount: z.number().int(),
});

const ExceedancePointSchema = z.object({ loss: z.number(), probability: z.number() });

// `probability` and `beyondTail` are null exactly when the scenario applies no tolerance.
const ToleranceReadingSchema = z.object({
  probability: z.number().nullable(),
  beyondTail: z.boolean().nullable(),
  curve: z.array(ExceedancePointSchema),
});

const BudgetReviewToleranceSchema = z.object({
  reference: z.enum(BUDGET_REVIEW_TOLERANCE_REFERENCES),
  state: FigureStateEnum,
  scenarios: z.array(z.object({
    // Null on a closed review for a scenario deleted since its closing.
    scenarioId: z.uuid().nullable(),
    name: z.string(),
    tolerance: z.object({
      annualLoss: z.number(),
      maxExceedanceProbability: z.number(),
      source: z.enum(TOLERANCE_SOURCES),
    }).nullable(),
    reference: ToleranceReadingSchema.nullable(),
    withoutBuild: ToleranceReadingSchema.nullable(),
    olderThanHeadline: z.boolean(),
  })),
});

const BudgetReviewRiskSeriesSchema = z.object({
  points: z.array(z.object({
    date: z.iso.date(),
    ale: z.number(),
    without: z.number().nullable(),
  })),
  moves: z.array(z.object({
    date: z.iso.date(),
    lines: z.array(z.object({ lineId: z.uuid(), capabilityIds: z.array(z.string()), finished: z.boolean() })),
  })),
  pricedAt: z.coerce.date().nullable(),
});

const BudgetReviewValuesSchema = z.object({
  name: z.string().trim().min(1).max(200),
  ownerId: z.uuid().nullable().optional(),
  context: z.string().nullable().optional(),
});

// The first day of a month, which the service checks.
const PeriodStartSchema = z.iso.date();

// The scope is taken on create and left off the update: every figure is priced for one scope, and
// moving it would keep none of them.
const BudgetReviewCreateSchema = BudgetReviewValuesSchema.extend({
  organizationId: z.uuid(),
  periodStart: PeriodStartSchema,
});

const BudgetReviewUpdateSchema = BudgetReviewValuesSchema.partial().extend({
  periodStart: PeriodStartSchema.optional(),
});

const BudgetReviewLineValuesSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nature: NatureEnum,
  amountSpent: z.number().min(0),
  amortizationYears: z.number().int().min(1).max(BUDGET_LINE_MAX_AMORTIZATION_YEARS).nullable().optional(),
  capabilityIds: z.array(z.uuid()).refine(
    (capabilityIds) => new Set(capabilityIds).size === capabilityIds.length,
    { error: 'A budget line names each control once' },
  ),
});

const reviewErrors = <T>(fn: () => Promise<T>) =>
  withNotFoundOn(BudgetReviewNotFoundError, () =>
    withConflictOn(BudgetReviewClosedError, () =>
      withConflictOn(BudgetReviewNotClosedError, () =>
        withConflictOn(BudgetReviewNotPricedError, () =>
          withConflictOn(BudgetReviewOutdatedError, () =>
            withBadRequestOn(BudgetReviewInvalidInputError, fn))))));

export const budgetReviewsRouter = (procedure: TenantProcedure) => router({
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the reviews users create, about one per scope a year
  getBudgetReviews: procedure
    .input(z.object({ organizationId: z.uuid().optional() }))
    .output(z.array(BudgetReviewListRowSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .budgetReviews.getBudgetReviews(input.organizationId)),

  // eslint-disable-next-line app/no-full-row-list-output -- nests whole budget_review_lines rows, not trimmed yet
  getBudgetReview: procedure
    .input(z.object({ id: z.uuid() }))
    .output(BudgetReviewDetailSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .budgetReviews.getBudgetReview(input.id) ?? null),

  getBudgetReviewControlPostures: procedure
    .input(z.object({ reviewId: z.uuid(), including: z.array(z.uuid()).optional() }))
    .output(BudgetReviewControlPosturesSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .budgetReviews.getBudgetReviewControlPostures(input.reviewId, input.including) ?? null),

  getBudgetReviewFigures: procedure
    .input(z.object({ reviewId: z.uuid() }))
    .output(BudgetReviewFiguresSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const figures = await services.withOrigin(origin).budgetReviews.getBudgetReviewFigures(input.reviewId);
      if (!figures) {
        return null;
      }
      const { toReprice, ...rest } = figures;
      return { ...rest, toRepriceCount: toReprice.length };
    }),

  getBudgetReviewTolerance: procedure
    .input(z.object({ reviewId: z.uuid() }))
    .output(BudgetReviewToleranceSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .budgetReviews.getBudgetReviewTolerance(input.reviewId) ?? null),

  // bounded-by: the period's days, one point and at most one move day each, 731 at most
  getBudgetReviewRiskSeries: procedure
    .input(z.object({ reviewId: z.uuid() }))
    .output(BudgetReviewRiskSeriesSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .budgetReviews.getBudgetReviewRiskSeries(input.reviewId) ?? null),

  getBudgetReviewSimulationState: procedure
    .input(z.object({ reviewId: z.uuid() }))
    .output(BudgetReviewSimulationStateSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scoped = services.withOrigin(origin);
      const scope = await scoped.budgetReviews.getBudgetReviewSimulationScope(input.reviewId);
      if (!scope) {
        return null;
      }
      const running = await scoped.jobs.getActiveIdempotencyKeys(
        origin.tenantId,
        scope.riskScenarioIds.map(crqSimulationIdempotencyKey),
      );
      return { toRepriceCount: scope.toReprice.length, runningCount: running.size };
    }),

  createBudgetReview: procedure
    .input(BudgetReviewCreateSchema)
    .output(z.uuid())
    .mutation(({ input, ctx: { services, origin } }) => reviewErrors(() => services.withOrigin(origin)
      .budgetReviews.createBudgetReview(input))),

  updateBudgetReview: procedure
    .input(z.object({ id: z.uuid(), values: BudgetReviewUpdateSchema }))
    .mutation(({ input, ctx: { services, origin } }) => reviewErrors(() => services.withOrigin(origin)
      .budgetReviews.updateBudgetReview(input.id, input.values))),

  deleteBudgetReviews: procedure
    .input(z.array(z.uuid()))
    .mutation(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .budgetReviews.deleteBudgetReviews(input)),

  createBudgetReviewLine: procedure
    .input(z.object({ reviewId: z.uuid(), values: BudgetReviewLineValuesSchema }))
    .output(z.uuid())
    .mutation(({ input, ctx: { services, origin } }) => reviewErrors(() => services.withOrigin(origin)
      .budgetReviews.createBudgetReviewLine(input.reviewId, input.values))),

  updateBudgetReviewLine: procedure
    .input(z.object({ id: z.uuid(), values: BudgetReviewLineValuesSchema.partial() }))
    .mutation(({ input, ctx: { services, origin } }) => reviewErrors(() => services.withOrigin(origin)
      .budgetReviews.updateBudgetReviewLine(input.id, input.values))),

  deleteBudgetReviewLines: procedure
    .input(z.array(z.uuid()))
    .mutation(({ input, ctx: { services, origin } }) => reviewErrors(() => services.withOrigin(origin)
      .budgetReviews.deleteBudgetReviewLines(input))),

  resimulateBudgetReviewScenarios: procedure
    .input(z.object({ reviewId: z.uuid() }))
    .output(z.object({ queuedCount: z.number().int() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scoped = services.withOrigin(origin);
      const scope = await scoped.budgetReviews.getBudgetReviewSimulationScope(input.reviewId);
      if (!scope) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await Promise.all(scope.toReprice.map((riskScenarioId) => enqueueRequestedCrqSimulation(scoped, origin, riskScenarioId)));
      return { queuedCount: scope.toReprice.length };
    }),

  closeBudgetReview: procedure
    .input(z.object({ reviewId: z.uuid() }))
    .mutation(({ input, ctx: { services, origin } }) => reviewErrors(() => services.withOrigin(origin)
      .budgetReviews.closeBudgetReview(input.reviewId))),

  reopenBudgetReview: procedure
    .input(z.object({ reviewId: z.uuid() }))
    .mutation(({ input, ctx: { services, origin } }) => reviewErrors(() => services.withOrigin(origin)
      .budgetReviews.reopenBudgetReview(input.reviewId))),
});
