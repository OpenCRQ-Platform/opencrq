import { and, eq, isNull, lte, sql } from 'drizzle-orm';
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

  /**
   * Binds `serviceAccountId` unless an account is already bound: what the deployment provides never
   * overwrites what an admin chose. Answers whether it bound.
   */
  bindIfUnbound: async ({ db }, tenantId: string, source: IntegrationSource, serviceAccountId: string, id: string) => {
    const bound = await db.insert(integrationSettings)
      .values([{ id, tenantId, source, serviceAccountId }])
      .onConflictDoUpdate({
        target: [integrationSettings.tenantId, integrationSettings.source],
        set: { serviceAccountId, updatedAt: sql`now()` },
        setWhere: isNull(integrationSettings.serviceAccountId),
      })
      .returning();
    return bound.length > 0;
  },

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

  /** Books an inventory outside the cadence. Answers whether the connector is configured for the tenant. */
  requestInventory: async ({ db }, tenantId: string, source: IntegrationSource, requestedAt: Date) => {
    const rows = await db.update(integrationSettings)
      .set({ inventoryRequestedAt: requestedAt })
      .where(and(eq(integrationSettings.tenantId, tenantId), eq(integrationSettings.source, source)))
      .returning();
    return rows.length > 0;
  },

  /**
   * Clears the ask an inventory answered. An ask booked after `answeredUpTo` is newer than what the
   * inventory read, so it stays for the next run.
   */
  clearInventoryRequest: async ({ db }, tenantId: string, source: IntegrationSource, answeredUpTo: Date) =>
    db.update(integrationSettings)
      .set({ inventoryRequestedAt: null })
      .where(and(
        eq(integrationSettings.tenantId, tenantId),
        eq(integrationSettings.source, source),
        lte(integrationSettings.inventoryRequestedAt, answeredUpTo),
      )),

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
