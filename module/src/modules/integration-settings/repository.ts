import { and, eq, sql } from 'drizzle-orm';
import type { IntegrationSource } from './schema';
import { defineRepository } from '../../registry';
import { integrationSettings } from './schema';

export const integrationSettingsRepository = defineRepository({
  findByTenantAndSource: async ({ db, views }, tenantId: string, source: IntegrationSource) => {
    const result = await db.select().from(views.integrationSettings)
      .where(and(eq(views.integrationSettings.tenantId, tenantId), eq(views.integrationSettings.source, source)))
      .limit(1);
    return result[0];
  },

  findAllByTenant: async ({ db, views }, tenantId: string) =>
    db.select().from(views.integrationSettings)
      .where(eq(views.integrationSettings.tenantId, tenantId)),

  configureIntegration: async ({ db }, tenantId: string, source: IntegrationSource, serviceAccountId: string | null, id: string) =>
    db.insert(integrationSettings)
      .values([{ id, tenantId, source, serviceAccountId }])
      .onConflictDoUpdate({
        target: [integrationSettings.tenantId, integrationSettings.source],
        set: { serviceAccountId, updatedAt: sql`now()` },
      }),

  markSynced: async ({ db }, tenantId: string, source: IntegrationSource, id: string, syncedAt?: Date) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const lastReportedAt = syncedAt ?? sql`now()` as unknown as Date;
    return db.insert(integrationSettings).values([{ id, tenantId, source, lastReportedAt }]).onConflictDoUpdate({
      target: [integrationSettings.tenantId, integrationSettings.source],
      set: { lastReportedAt: syncedAt ? syncedAt : sql`now()` },
    });
  },

  /** Drops the incremental watermark so the connector's next run re-reads its whole source. */
  clearSyncWatermark: async ({ db }, tenantId: string, source: IntegrationSource) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    return db.update(integrationSettings)
      .set({ lastReportedAt: null, updatedAt })
      .where(and(eq(integrationSettings.tenantId, tenantId), eq(integrationSettings.source, source)));
  },

  findIdBySource: async ({ db, views }, tenantId: string, source: IntegrationSource) =>
    db.select({ id: views.integrationSettings.id })
      .from(views.integrationSettings)
      .where(and(
        eq(views.integrationSettings.tenantId, tenantId),
        eq(views.integrationSettings.source, source),
      ))
      .limit(1)
      .then((r) => r.at(0)?.id ?? null),
});
