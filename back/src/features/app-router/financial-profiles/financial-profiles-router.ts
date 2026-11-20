import {
  CARD_TRANSACTIONS_BAND_VALUES,
  CONTRACTED_REVENUE_BAND_VALUES,
  CONTRACTUAL_LIABILITY_CAP_BAND_VALUES,
  COSTLIEST_INCIDENT_BAND_VALUES,
  CUSTOMER_COUNT_BAND_VALUES,
  FINANCIAL_PROFILE_ANSWER_FIELDS,
  financialProfileAnswersSchema,
  financialProfiles,
  FULL_RESTORE_BAND_VALUES,
  INDIVIDUALS_BAND_VALUES,
  journalValueSchema,
  LARGEST_REPOSITORY_BAND_VALUES,
  OPERATING_DAYS_BAND_VALUES,
  PAYMENT_FLOW_BAND_VALUES,
  RD_IP_VALUE_BAND_VALUES,
  REGULATORY_REGIME_VALUES,
  RESTORE_TEST_RECENCY_VALUES,
  REVENUE_RECAPTURE_BAND_VALUES,
  RiskScopeNotFoundError,
  SENSITIVE_RECORDS_BAND_VALUES,
  TIME_TO_REVENUE_IMPACT_BAND_VALUES,
  WORST_OUTAGE_BAND_VALUES,
} from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { enqueueTefRecomputeOnFirmographyChange } from '../organizations/firmography-recompute';
import { withNotFoundOn } from '../structured-error-conflict';

const FinancialProfileSchema = createSelectSchema(financialProfiles, {
  operatingDaysBand: z.enum(OPERATING_DAYS_BAND_VALUES).nullable(),
  timeToRevenueImpactBand: z.enum(TIME_TO_REVENUE_IMPACT_BAND_VALUES).nullable(),
  fullRestoreBand: z.enum(FULL_RESTORE_BAND_VALUES).nullable(),
  revenueRecaptureBand: z.enum(REVENUE_RECAPTURE_BAND_VALUES).nullable(),
  restoreTestRecency: z.enum(RESTORE_TEST_RECENCY_VALUES).nullable(),
  individualsBand: z.enum(INDIVIDUALS_BAND_VALUES).nullable(),
  cardTransactionsBand: z.enum(CARD_TRANSACTIONS_BAND_VALUES).nullable(),
  sensitiveRecordsBand: z.enum(SENSITIVE_RECORDS_BAND_VALUES).nullable(),
  largestRepositoryBand: z.enum(LARGEST_REPOSITORY_BAND_VALUES).nullable(),
  regulatoryRegime: z.enum(REGULATORY_REGIME_VALUES).nullable(),
  customerCountBand: z.enum(CUSTOMER_COUNT_BAND_VALUES).nullable(),
  contractedRevenueBand: z.enum(CONTRACTED_REVENUE_BAND_VALUES).nullable(),
  contractualLiabilityCapBand: z.enum(CONTRACTUAL_LIABILITY_CAP_BAND_VALUES).nullable(),
  paymentFlowDailyValueBand: z.enum(PAYMENT_FLOW_BAND_VALUES).nullable(),
  rdIpValueBand: z.enum(RD_IP_VALUE_BAND_VALUES).nullable(),
  worstOutageBand: z.enum(WORST_OUTAGE_BAND_VALUES).nullable(),
  costliestIncidentBand: z.enum(COSTLIEST_INCIDENT_BAND_VALUES).nullable(),
}).omit({ tenantId: true });

const SaveFinancialProfileInputSchema = z.object({
  organizationId: z.uuid(),
  answers: financialProfileAnswersSchema,
});

const FinancialProfileEventSchema = z.object({
  id: z.uuid(),
  field: z.enum(FINANCIAL_PROFILE_ANSWER_FIELDS),
  before: journalValueSchema,
  after: journalValueSchema,
  createdAt: z.date(),
  userName: z.string().nullable(),
});

export const financialProfilesRouter = (procedure: TenantProcedure) => router({
  getFinancialProfile: procedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(FinancialProfileSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .financialProfiles.getFinancialProfile(input.organizationId) ?? null),

  // bounded-by: SCOPE_EVENTS_LIMIT, the service's cap on the events it returns
  getFinancialProfileHistory: procedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.array(FinancialProfileEventSchema))
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .financialProfiles.getFinancialProfileHistory(input.organizationId)),

  saveFinancialProfile: procedure
    .input(SaveFinancialProfileInputSchema)
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scopedServices = services.withOrigin(origin);
      // Saving Q1 derives the organization's revenue band, which is a firmography field, so this
      // write owes the same auto-mode TEF recompute an organization edit does. The narrow core
      // read carries every raw id `enqueueTefRecomputeOnFirmographyChange` compares, with no
      // sector/country label join neither side of this comparison needs.
      const before = await scopedServices.organizations.getOrganizationCore(input.organizationId);
      const result = await withNotFoundOn(RiskScopeNotFoundError, () => scopedServices.financialProfiles.saveFinancialProfile(input.organizationId, input.answers));
      const after = await scopedServices.organizations.getOrganizationCore(input.organizationId);
      await enqueueTefRecomputeOnFirmographyChange(scopedServices, origin, input.organizationId, before, after);
      // No financial-estimates enqueue here: that job is observed and `financial_profiles` is in
      // its read set, so this write already wakes it. A hand-written second trigger is one that
      // forgets. `tef-recompute` is not observed, hence the explicit call above.
      return result;
    }),
});
