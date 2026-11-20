import { eq } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { dashboardSettings } from './schema';

export const dashboardSettingsRepository = defineRepository({
  findByTenantId: async ({ db, views }, tenantId: string) =>
    db.select().from(views.dashboardSettings).where(eq(views.dashboardSettings.tenantId, tenantId)).then((r) => r[0]),

  upsertHomeDashboard: async ({ db }, tenantId: string, homeDashboardId: string) =>
    db.insert(dashboardSettings).values([{ tenantId, homeDashboardId }]).onConflictDoUpdate({
      target: dashboardSettings.tenantId,
      set: { homeDashboardId },
    }),
});
