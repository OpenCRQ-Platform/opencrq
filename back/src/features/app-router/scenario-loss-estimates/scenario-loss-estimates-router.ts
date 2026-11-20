import { lossDrivers, PROVENANCE_VALUES, scenarioLossEstimates, StaleWriteError, UnrevertableEstimateError } from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const mapEstimateWriteErrors = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StaleWriteError) {
      throw new TRPCError({ code: 'CONFLICT', message: error.messageKey, cause: error });
    }
    if (error instanceof UnrevertableEstimateError) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.messageKey, cause: error });
    }
    throw error;
  }
};

const ScenarioLossEstimateSchema = createSelectSchema(scenarioLossEstimates, {
  provenance: z.enum(PROVENANCE_VALUES),
});

const LossDriverSummarySchema = createSelectSchema(lossDrivers).pick({
  id: true,
  name: true,
  description: true,
  lossCategoryId: true,
}).extend({
  lossCategoryName: z.string(),
});

const EstimateWithDriverSchema = ScenarioLossEstimateSchema.pick({
  lossDriverId: true,
  minValue: true,
  likelyValue: true,
  maxValue: true,
  provenance: true,
  lowConfidence: true,
  isPosture: true,
  updatedAt: true,
}).extend({
  lossDriver: LossDriverSummarySchema,
});

// The plausibility verdict on the displayed total, against the organization's own scale and its
// revealed loss history. Warnings only: nothing here changes a figure.
const SanityWarningSchema = z.object({
  kind: z.enum(['over_pricing', 'under_pricing']),
  expectedTotalUsd: z.number().min(0),
  anchorUsd: z.number().min(0),
  ratio: z.number().min(0),
});

const FinancialSummarySchema = z.object({
  totalMinDollar: z.number().min(0),
  totalLikelyDollar: z.number().min(0),
  totalMaxDollar: z.number().min(0),
  pertExpectedValue: z.number().min(0),
  updatedAt: z.date().nullable(),
  sanityWarnings: z.array(SanityWarningSchema).readonly(),
  // Rides with the figures rather than on a read of its own, so the notice and the amounts it
  // qualifies can never disagree about which recompute the reader is looking at.
  recomputePending: z.boolean(),
});

const LossDriverSplitRowSchema = z.object({
  driverId: z.uuid(),
  driver: z.string(),
  amount: z.number().min(0),
});

const LossDriverSplitSchema = z.object({
  // Ordered by descending amount: the caller draws them in the order they arrive.
  drivers: z.array(LossDriverSplitRowSchema),
  total: z.number().min(0),
});

const AutomaticEstimateSchema = z.object({
  lossDriverId: z.uuid(),
  minValue: z.number().min(0).nullable(),
  likelyValue: z.number().min(0).nullable(),
  maxValue: z.number().min(0).nullable(),
  lowConfidence: z.boolean(),
  isPosture: z.boolean(),
});

const SetEstimateEntrySchema = z.object({
  lossDriverId: z.uuid(),
  action: z.literal('set'),
  minValue: z.number().min(0).nullable(),
  likelyValue: z.number().min(0).nullable(),
  maxValue: z.number().min(0).nullable(),
});

// An explicit tombstone, distinguishable from omission: a driver absent from the payload is left
// untouched, a driver sent with this entry has its row deleted.
const ClearEstimateEntrySchema = z.object({
  lossDriverId: z.uuid(),
  action: z.literal('clear'),
});

// No `id` field: under a keyed-per-driver upsert `lossDriverId` alone identifies the row, and a
// client-generated id was exactly the delete-all-then-reinsert artifact this replaces. No
// `provenance` field either — it is never accepted from a payload.
const EstimateEntrySchema = z.discriminatedUnion('action', [SetEstimateEntrySchema, ClearEstimateEntrySchema]).refine(
  (data) => {
    if (data.action !== 'set') {
      return true;
    }
    if (data.minValue !== null && data.likelyValue !== null && data.minValue > data.likelyValue) {
      return false;
    }
    if (data.likelyValue !== null && data.maxValue !== null && data.likelyValue > data.maxValue) {
      return false;
    }
    if (data.minValue !== null && data.maxValue !== null && data.minValue > data.maxValue) {
      return false;
    }
    return true;
  },
  { message: 'Values must satisfy: min ≤ likely ≤ max' },
);

export const scenarioLossEstimatesRouter = (procedure: TenantProcedure) => router({
  // bounded-by: one estimate per loss driver of one scenario, unique on (scenario, driver)
  getScenarioLossEstimates: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(z.array(EstimateWithDriverSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .scenarioLossEstimates.getScenarioLossEstimates(input.riskScenarioId)),

  upsertScenarioLossEstimates: procedure
    .input(z.object({
      riskScenarioId: z.uuid(),
      estimates: z.array(EstimateEntrySchema),
      // The optimistic-concurrency fingerprint of the rows the client last read: their newest
      // `updatedAt` (`null` when it read none) and how many there were. The count is what sees a
      // deletion, which cannot lower the maximum. Coerced: the date travels as the ISO string the
      // client read off a prior query response, not a constructed `Date`.
      updatedAt: z.coerce.date().nullable(),
      rowCount: z.number().int().nonnegative(),
      revertLossDriverIds: z.array(z.uuid()).optional(),
    }))
    // No CRQ ask here, unlike the questionnaire-driven recompute: the analyst is editing these
    // figures by hand and decides when they are worth pricing. What carries the invitation is the
    // scenario's readiness item for loss drivers, which a hand edit does raise — not the recompute
    // notice, which tracks the questionnaire and stays put under a write from this page.
    .mutation(({ input, ctx: { services, origin } }) => mapEstimateWriteErrors(() => services.withOrigin(origin)
      .scenarioLossEstimates.upsertScenarioLossEstimates(input.riskScenarioId, input.estimates, {
        maxUpdatedAt: input.updatedAt,
        rowCount: input.rowCount,
      }, input.revertLossDriverIds))),

  getFinancialSummary: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(FinancialSummarySchema)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .scenarioLossEstimates.getFinancialSummary(input.riskScenarioId)),

  // Which kinds of loss carry the cost of one attack outcome — summed across every scenario
  // naming it, priced or not.
  getLossDriverSplitForOutcome: procedure
    .input(z.object({ attackOutcomeId: z.uuid() }))
    .output(LossDriverSplitSchema)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .scenarioLossEstimates.getLossDriverSplitForOutcome(input.attackOutcomeId)),

  // bounded-by: DRIVER_FORMULAS, one estimate per activated loss driver
  getAutomaticEstimates: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(z.array(AutomaticEstimateSchema).readonly())
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .scenarioLossEstimates.getAutomaticEstimates(input.riskScenarioId)),
});
