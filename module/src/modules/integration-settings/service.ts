import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { IntegrationSource } from './schema';
import { defineService } from '../../registry';
import { serviceAccountsService } from '../service-accounts/service';
import { integrationSettingsRepository } from './repository';

export const integrationSettingsService = defineService(
  'integrationSettings',
  integrationSettingsRepository,
).dependsOn(() => [serviceAccountsService]).implement({
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

  /**
   * Creates the service account the integration runs as and binds it, in one transaction: a failed
   * bind leaves no orphan account behind. Returns the new account's id.
   */
  configureIntegrationWithNewServiceAccount: async ({ atomic, eventOrigin }, source: IntegrationSource, serviceAccountName: string): Promise<string> => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const { tenantId } = eventOrigin;
    return atomic(async ({ repo, deps }) => {
      const serviceAccountId = await deps.serviceAccounts.createConnectorServiceAccount(serviceAccountName);
      await repo.configureIntegration(tenantId, source, serviceAccountId, uuidv7());
      return serviceAccountId;
    });
  },

  /**
   * The deployment's own binding of an integration it provides (`CONNECTORS__<NAME>__<tenant>__*`):
   * binds `serviceAccountId` only where no account is bound yet. System origin only, so the
   * tenant is named. Answers whether it bound.
   */
  bindDeploymentIntegration: async ({ repo, eventOrigin }, tenantId: string, source: IntegrationSource, serviceAccountId: string): Promise<boolean> => {
    if (eventOrigin.type !== 'system') {
      throw newError('System origin required');
    }
    return repo.bindIfUnbound(tenantId, source, serviceAccountId, uuidv7());
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

  requestInventory: async ({ repo, eventOrigin }, source: IntegrationSource, requestedAt: Date): Promise<boolean> => {
    if (!('tenantId' in eventOrigin) || !eventOrigin.tenantId) {
      throw newError('Tenant context required');
    }
    return repo.requestInventory(eventOrigin.tenantId, source, requestedAt);
  },

  clearInventoryRequest: async ({ repo, eventOrigin }, source: IntegrationSource, answeredUpTo: Date) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    await repo.clearInventoryRequest(eventOrigin.tenantId, source, answeredUpTo);
  },

  getConnectorId: async ({ repo, eventOrigin }, source: IntegrationSource) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    return repo.findIdBySource(eventOrigin.tenantId, source);
  },
});
