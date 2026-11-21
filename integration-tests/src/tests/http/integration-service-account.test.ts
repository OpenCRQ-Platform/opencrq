import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Integration service account, created with the configuration (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;

  const scoped = () => services.withOrigin({ type: 'client', userId: adminId, tenantId });

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
  });

  describe('integrations.configure', () => {
    it('creates an active account in the Connectors group and binds it, in one call', async () => {
      const res = await client.mutation('integrations.configure', {
        source: 'microsoft_graph',
        newServiceAccount: { name: 'Microsoft Defender connector' },
      }, { tenantId });

      expect(res.status).toBe(200);
      const { serviceAccountId } = res.json.result.data;
      const account = await scoped().serviceAccounts.getServiceAccount(serviceAccountId);
      expect(account).toMatchObject({ name: 'Microsoft Defender connector', active: true });
      const groups = await scoped().serviceAccounts.getServiceAccountGroups(serviceAccountId);
      expect(groups.map((row) => row.group.name)).toContain('Connectors');
      const settings = await client.query('integrations.getSettings', { source: 'microsoft_graph' }, { tenantId });
      expect(settings.json.result.data.serviceAccountId).toBe(serviceAccountId);
    });

    it('still binds an existing account, and answers its id', async () => {
      const serviceAccountId = uuidv7();
      await scoped().serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Shared bot' });

      const res = await client.mutation('integrations.configure', { source: 'drata', serviceAccountId }, { tenantId });

      expect(res.json.result.data).toEqual({ serviceAccountId });
      expect((await scoped().serviceAccounts.getServiceAccounts()).map((account) => account.id)).toEqual([serviceAccountId]);
    });

    it('refuses a body naming both an existing and a new account, creating nothing', async () => {
      const serviceAccountId = uuidv7();
      await scoped().serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Shared bot' });

      const res = await client.mutation('integrations.configure', {
        source: 'drata',
        serviceAccountId,
        newServiceAccount: { name: 'Drata connector' },
      }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
      expect(await scoped().serviceAccounts.getServiceAccounts()).toHaveLength(1);
    });

    it('refuses a blank name', async () => {
      const res = await client.mutation('integrations.configure', { source: 'drata', newServiceAccount: { name: '   ' } }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
      expect(await scoped().serviceAccounts.getServiceAccounts()).toHaveLength(0);
    });

    it('refuses a tenant member who cannot manage security, creating nothing', async () => {
      const regularUser = await createUser(db);
      await scoped().tenants.addTenantUser(tenantId, regularUser.userId);
      client.clearCookies();
      await signInAs(client, regularUser.userId);

      const res = await client.mutation('integrations.configure', { source: 'drata', newServiceAccount: { name: 'Drata connector' } }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
      expect(await scoped().serviceAccounts.getServiceAccounts()).toHaveLength(0);
    });
  });

  describe('opencti.configure', () => {
    it('creates the account the stream runs as and binds it', async () => {
      const res = await client.mutation('opencti.configure', {
        streamId: 'live-stream-1',
        newServiceAccount: { name: 'OpenCTI connector' },
      }, { tenantId });

      expect(res.status).toBe(200);
      const { serviceAccountId } = res.json.result.data;
      const settings = await client.query('opencti.getSettings', undefined, { tenantId });
      expect(settings.json.result.data).toMatchObject({ streamId: 'live-stream-1', serviceAccountId, enabled: true });
      expect(await scoped().serviceAccounts.getServiceAccount(serviceAccountId)).toMatchObject({ name: 'OpenCTI connector' });
    });

    it('refuses a body naming no account at all', async () => {
      const res = await client.mutation('opencti.configure', { streamId: 'live-stream-1' }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });
  });

  describe('rollback', () => {
    it('leaves no account behind when the binding fails', async () => {
      // PostgreSQL refuses a NUL byte in a text column: the bind throws after the account insert,
      // in the same transaction.
      await expect(scoped().integrationSettings.configureIntegrationWithNewServiceAccount(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- deliberately invalid, to make the bind fail
        'drata\u0000' as 'drata',
        'Orphan connector',
      )).rejects.toThrow();

      expect(await scoped().serviceAccounts.getServiceAccounts()).toHaveLength(0);
    });
  });
});
