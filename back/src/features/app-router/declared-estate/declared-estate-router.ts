import { DECLARED_ESTATE_COMPARISON_STATE_VALUES, DECLARED_ESTATE_KIND_VALUES, declaredEstateAnswersSchema, RiskScopeNotFoundError } from '@app/module';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { withNotFoundOn } from '../structured-error-conflict';

const BoundsSchema = z.object({
  low: z.number().int().describe('The fewest assets of the kind the scope holds.'),
  high: z.number().int().describe('The most assets of the kind the scope holds; equal to `low` for an exact number.'),
}).nullable();

const DeclaredEstateKindSchema = z.object({
  kind: z.enum(DECLARED_ESTATE_KIND_VALUES),
  bounds: BoundsSchema.describe('The declared number of assets, null when the kind is unanswered.'),
  internetFacing: z.boolean().nullable().describe('Whether at least one asset of the kind is reachable from the Internet, null when unanswered.'),
  setAt: z.date().nullable().describe('When the answer was last saved.'),
  setByName: z.string().nullable().describe('Who last saved the answer.'),
});

const DeclaredEstateAnswerStateSchema = z.object({
  bounds: BoundsSchema,
  internetFacing: z.boolean().nullable(),
});

const DeclaredEstateEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum(DECLARED_ESTATE_KIND_VALUES),
  before: DeclaredEstateAnswerStateSchema,
  after: DeclaredEstateAnswerStateSchema,
  createdAt: z.date(),
  userName: z.string().nullable(),
});

const DeclaredEstateComparisonSchema = z.object({
  kinds: z.array(z.object({
    kind: z.enum(DECLARED_ESTATE_KIND_VALUES),
    bounds: BoundsSchema.describe('The declared number of assets, null when the kind is unanswered.'),
    measured: z.number().int().describe('The assets of the kind measured on the estate of the scope, or of the whole tenant, counted as the risk engine counts them.'),
    state: z.enum(DECLARED_ESTATE_COMPARISON_STATE_VALUES).describe('Where the measured count sits against the declared bounds: below, within or above them, none_measured when nothing is measured, not_declared when the kind is unanswered.'),
  })),
  declaredAt: z.date().nullable().describe('When the declaration was last saved, null when nothing is declared.'),
});

const ScopeInputSchema = z.object({ organizationId: z.uuid().describe('The risk scope.') });

export const declaredEstateRouter = (procedure: TenantProcedure) => router({
  // bounded-by: the twelve kinds of asset, one row each
  get: procedure
    .input(ScopeInputSchema)
    .output(z.array(DeclaredEstateKindSchema))
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .declaredEstate.getDeclaredEstate(input.organizationId)),

  // bounded-by: the twelve kinds of asset, one row each
  comparison: procedure
    .input(z.object({ organizationId: z.uuid().nullable().describe('The risk scope, null for the whole tenant, which declares nothing.') }))
    .output(DeclaredEstateComparisonSchema)
    .query(async ({ input, ctx: { services, origin } }) => await withNotFoundOn(RiskScopeNotFoundError, () => services.withOrigin(origin)
      .declaredEstate.getDeclaredEstateComparison(input.organizationId))),

  // bounded-by: DECLARED_ESTATE_HISTORY_LIMIT, the service's cap on the events it returns
  history: procedure
    .input(ScopeInputSchema)
    .output(z.array(DeclaredEstateEventSchema))
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .declaredEstate.getDeclaredEstateHistory(input.organizationId)),

  save: procedure
    .input(ScopeInputSchema.extend({
      answers: declaredEstateAnswersSchema.describe('The kinds to change. A kind left out keeps its answer; a kind sent with null bounds loses it. Counts are numbers of assets, and an exact number is two equal bounds.'),
    }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await withNotFoundOn(RiskScopeNotFoundError, () => services.withOrigin(origin)
        .declaredEstate.saveDeclaredEstate(input.organizationId, input.answers));
    }),
});
