import { eq } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { crqIndicatorSettings } from './schema';

export const crqIndicatorSettingsRepository = defineRepository({
  findByTenantId: async ({ db, views }, tenantId: string) =>
    db.select().from(views.crqIndicatorSettings).where(eq(views.crqIndicatorSettings.tenantId, tenantId)).then((r) => r[0]),

  upsertSettings: async ({ db }, values: typeof crqIndicatorSettings.$inferInsert) =>
    db.insert(crqIndicatorSettings).values([values]).onConflictDoUpdate({
      target: crqIndicatorSettings.tenantId,
      set: {
        iterations: values.iterations,
        exposureWeightInternetFacing: values.exposureWeightInternetFacing,
        exposureWeightInternal: values.exposureWeightInternal,
        susceptibilityGamma: values.susceptibilityGamma,
        measuredValidityDays: values.measuredValidityDays,
        unknownCriticalityCountsAs: values.unknownCriticalityCountsAs,
        unknownExposureCountsAs: values.unknownExposureCountsAs,
        phishingFailureRate: values.phishingFailureRate,
        phishingFailureMeasuredOn: values.phishingFailureMeasuredOn,
      },
    }),
});
