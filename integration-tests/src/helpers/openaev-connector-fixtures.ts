import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import type { TestServices } from '../setup/test-context';
import { createTenant } from './factories';

export interface TenantFixture {
  tenantId: string,
  adminOrigin: EventOrigin,
  connectorOrigin: EventOrigin,
  connectorId: string,
}

export const OAEV_TENANT = 'oaev-tenant-1';

export const createFixture = async (services: TestServices, userId: string): Promise<TenantFixture> => {
  const tenantId = await createTenant(services, userId);
  const adminOrigin: EventOrigin = { type: 'client', userId, tenantId };
  const serviceAccountId = uuidv7();
  await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test OpenAEV Bot' });
  await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
  const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
  return { tenantId, adminOrigin, connectorOrigin: { type: 'connector', serviceAccountId, tenantId }, connectorId };
};
