import { eq } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { threatRelevanceSettings } from './schema';

export const threatRelevanceSettingsRepository = defineRepository({
  findByTenantId: async ({ db, views }, tenantId: string) =>
    db.select().from(views.threatRelevanceSettings).where(eq(views.threatRelevanceSettings.tenantId, tenantId)).then((r) => r[0]),

  upsertSettings: async ({ db }, values: typeof threatRelevanceSettings.$inferInsert) =>
    db.insert(threatRelevanceSettings).values([values]).onConflictDoUpdate({
      target: threatRelevanceSettings.tenantId,
      set: {
        actHalfLifeObservedDays: values.actHalfLifeObservedDays,
        actHalfLifeAuthoredDays: values.actHalfLifeAuthoredDays,
        confidenceGate: values.confidenceGate,
        ...(values.unknownActivityAgeDays !== undefined && { unknownActivityAgeDays: values.unknownActivityAgeDays }),
      },
    }),
});
