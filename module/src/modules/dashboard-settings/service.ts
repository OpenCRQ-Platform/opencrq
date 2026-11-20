import { newError } from '@app/utils';
import { requireClientTenantId, requireTenantId } from '../../security';
import { defineService } from '../../registry';
import { dashboardSettingsRepository } from './repository';
import { dashboardIdSchema } from './validation';

export const dashboardSettingsService = defineService(
  'dashboardSettings',
  dashboardSettingsRepository,
).implement({
  getTenantHomeDashboard: async ({ repo, eventOrigin }): Promise<string | null> => {
    const row = await repo.findByTenantId(requireTenantId(eventOrigin));
    return row?.homeDashboardId ?? null;
  },

  setTenantHomeDashboard: async ({ repo, eventOrigin }, dashboardId: string) => {
    const tenantId = requireClientTenantId(eventOrigin);
    if (!dashboardIdSchema.safeParse(dashboardId).success) {
      throw newError('Invalid dashboard id');
    }
    await repo.upsertHomeDashboard(tenantId, dashboardId);
  },
});
