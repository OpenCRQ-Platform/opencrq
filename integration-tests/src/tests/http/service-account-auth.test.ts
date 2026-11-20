import { SERVICE_ACCOUNT_TOKEN_PREFIX } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { createServiceAccountClient } from '../../helpers/service-account-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

describe('Service account Bearer token auth (HTTP/tRPC)', () => {
  const services = createTestServices(db);

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('should authenticate via Bearer token and access tenant-scoped data', async () => {
    const server = await getTestServer();
    const { origin } = await createTenantWithAdmin(services);

    const saClient = await createServiceAccountClient(server, services, origin);

    // Create an organization so the service account has data to query
    await services.withOrigin(origin).organizations.createOrganizations([{ id: uuidv7(), name: 'Test Org' }]);

    // Service account can read tenant-scoped data without needing specific capabilities
    const res = await saClient.query('organizations.getOrganizations');
    expect(res.status).toBe(200);
    expect(res.json.result.data).toBeInstanceOf(Array);
    expect(res.json.result.data.length).toBeGreaterThan(0);
  });

  it('should reject requests with an invalid Bearer token', async () => {
    const server = await getTestServer();

    const res = await server.inject({
      method: 'GET',
      url: '/trpc/groups.getGroups',
      headers: {
        authorization: `Bearer ${SERVICE_ACCOUNT_TOKEN_PREFIX}invalidtoken1234567890abcdefghi123456789012`,
      },
    });

    const json = JSON.parse(res.body);
    expect(json.error.data.code).toBe('UNAUTHORIZED');
  });

  it('should enforce tenant isolation — no cross-tenant data', async () => {
    const server = await getTestServer();
    const { userId, origin: origin1, tenantId: tenantId1 } = await createTenantWithAdmin(services);
    const tenantId2 = await createTenant(services, userId);

    // Create organizations in each tenant
    await services.withOrigin(origin1).organizations.createOrganizations([{ id: uuidv7(), name: 'Org in Tenant 1' }]);
    const origin2 = { type: 'client' as const, userId, tenantId: tenantId2 };
    await services.withOrigin(origin2).organizations.createOrganizations([{ id: uuidv7(), name: 'Org in Tenant 2' }]);

    // Create a service account in tenant 1
    const saClient = await createServiceAccountClient(server, services, origin1);

    // Should only see tenant 1 organizations
    const res = await saClient.query('organizations.getOrganizations');
    expect(res.status).toBe(200);
    const orgs = res.json.result.data;
    expect(orgs.length).toBeGreaterThan(0);
    for (const org of orgs) {
      expect(org.tenantId).toBe(tenantId1);
      expect(org.tenantId).not.toBe(tenantId2);
    }
  });
});
