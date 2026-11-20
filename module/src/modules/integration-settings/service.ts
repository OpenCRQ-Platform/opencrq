import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { IntegrationSource } from './schema';
import { defineService } from '../../registry';
import { integrationSettingsRepository } from './repository';

export const integrationSettingsService = defineService(
  'integrationSettings',
  integrationSettingsRepository,
).implement({
  getIntegrationSettings: async ({ repo, eventOrigin }, source: IntegrationSource) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    return await repo.findByTenantAndSource(eventOrigin.tenantId, source) ?? null;
  },

  getAllIntegrationSettings: async ({ repo, eventOrigin }) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    return repo.findAllByTenant(eventOrigin.tenantId);
  },

  /** For the scheduler, which reads every tenant under the system origin. */
  getTenantIntegrationSettings: async ({ repo }, tenantId: string) => repo.findAllByTenant(tenantId),

  configureIntegration: async ({ repo, eventOrigin }, source: IntegrationSource, serviceAccountId: string | null) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    await repo.configureIntegration(eventOrigin.tenantId, source, serviceAccountId, uuidv7());
  },

  markSynced: async ({ repo, eventOrigin }, source: IntegrationSource, syncedAt?: Date) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    await repo.markSynced(eventOrigin.tenantId, source, uuidv7(), syncedAt);
  },

  clearSyncWatermark: async ({ repo, eventOrigin }, source: IntegrationSource) => {
    if (!('tenantId' in eventOrigin) || !eventOrigin.tenantId) {
      throw newError('Tenant context required');
    }
    await repo.clearSyncWatermark(eventOrigin.tenantId, source);
  },

  getConnectorId: async ({ repo, eventOrigin }, source: IntegrationSource) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    return repo.findIdBySource(eventOrigin.tenantId, source);
  },
});
