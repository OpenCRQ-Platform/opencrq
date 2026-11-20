import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { setTestEdition } from '../../setup/create-test-app';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { DEFAULT_TENANT_ID, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Enterprise Edition (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    // This suite is about what an unentitled platform does, against a test app
    // that is Enterprise Edition by default (see setTestEdition).
    setTestEdition('ce');
    client = createTrpcTestClient(server);
  });

  describe('bootstrap payload', () => {
    it('should report the platform edition, Community until XTM One says otherwise', async () => {
      const res = await client.query('authStatus');
      expect(res.status).toBe(200);
      // The one query the frontend makes before login: every EE gate reads
      // the edition from here.
      expect(res.json.result.data.edition).toBe('ce');
    });

    it('should report Enterprise Edition once the entitlement is granted', async () => {
      setTestEdition('ee');

      const res = await client.query('authStatus');
      expect(res.json.result.data.edition).toBe('ee');
    });
  });

  describe('multi-tenancy is Enterprise Edition', () => {
    let extraTenantId: string;
    let adminId: string;

    beforeEach(async () => {
      adminId = uuidv7();
      // Creates the platform's default tenant, whose id is a fixed constant
      // older than any generated one - so it is the tenant a downgraded user
      // keeps, deterministically.
      await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
      // Through the service, so the Community refusal on the endpoint does not
      // stand in the way of building the downgraded state.
      extraTenantId = uuidv7();
      await services.withOrigin({ type: 'platform' as const, userId: adminId })
        .tenants.createTenant({ id: extraTenantId, name: 'Second' }, adminId);
    });

    it('should serve the first tenant a downgraded user still belongs to', async () => {
      const res = await client.query('organizations.getOrganizations', undefined, { tenantId: DEFAULT_TENANT_ID });
      expect(res.status).toBe(200);
    });

    it('should refuse every other tenant, whatever the header claims', async () => {
      const res = await client.query('organizations.getOrganizations', undefined, { tenantId: extraTenantId });
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should list only the tenant that stays reachable', async () => {
      const res = await client.query('tenants.getTenants');
      expect(res.json.result.data.map((tenant: { id: string }) => tenant.id)).toEqual([DEFAULT_TENANT_ID]);
    });

    it('should not even name a tenant the platform put out of reach', async () => {
      const reachable = await client.query('tenants.getTenant', { id: DEFAULT_TENANT_ID });
      expect(reachable.json.result.data.id).toBe(DEFAULT_TENANT_ID);

      // Membership still holds on this one, so only the edition gate can hide
      // it; leaving it out would let a downgraded user read its name.
      const hidden = await client.query('tenants.getTenant', { id: extraTenantId });
      expect(hidden.json.result.data).toBeNull();
    });

    it('should refuse the tenant-keyed platform endpoints for a tenant out of reach', async () => {
      // The admin created the second tenant and so belongs to it: membership
      // holds, and the edition is the only thing standing between the caller
      // and its user list.
      const users = await client.query('tenants.getTenantUsers', { tenantId: extraTenantId }, { tenantId: extraTenantId });
      expect(users.json.error.data.code).toBe('FORBIDDEN');

      const profile = await client.query('tenants.getTenantUserProfile', { tenantId: extraTenantId, userId: adminId }, { tenantId: extraTenantId });
      expect(profile.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should serve those same endpoints for the tenant that stays reachable', async () => {
      const users = await client.query('tenants.getTenantUsers', { tenantId: DEFAULT_TENANT_ID }, { tenantId: DEFAULT_TENANT_ID });
      expect(users.status).toBe(200);
    });

    it('should refuse to create a tenant the platform could not reach', async () => {
      const res = await client.mutation('tenants.createTenantsTransaction', { id: uuidv7(), name: 'Third' });
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should refuse a tenant-less user, to whom the platform looks empty', async () => {
      // `removeTenantUser` leaves a user belonging to nothing, and the tenants a
      // caller can read are their own memberships: counted through the caller,
      // the platform looks empty and every such user would be handed a tenant.
      const asSystem = services.withOrigin({ type: 'system' as const });
      await asSystem.tenants.removeTenantUser(DEFAULT_TENANT_ID, adminId);
      await asSystem.tenants.removeTenantUser(extraTenantId, adminId);

      const res = await client.mutation('tenants.createTenantsTransaction', { id: uuidv7(), name: 'Third' });
      expect(res.json.error.data.code).toBe('FORBIDDEN');
      expect(await asSystem.tenants.getTenants()).toHaveLength(2);
    });

    it('should still rename the tenant that stays reachable, without a license', async () => {
      const res = await client.mutation('tenants.renameTenant', { id: DEFAULT_TENANT_ID, name: 'Renamed Tenant' });

      expect(res.status).toBe(200);
      const tenant = await services.withOrigin({ type: 'system' as const }).tenants.getTenant(DEFAULT_TENANT_ID);
      expect(tenant?.name).toBe('Renamed Tenant');
    });

    it('should refuse to rename a tenant the platform put out of reach', async () => {
      const asSystem = services.withOrigin({ type: 'system' as const });
      const before = (await asSystem.tenants.getTenant(extraTenantId))?.name;

      const res = await client.mutation('tenants.renameTenant', { id: extraTenantId, name: 'Renamed Tenant' });

      expect(res.json.error.data.code).toBe('NOT_FOUND');
      expect((await asSystem.tenants.getTenant(extraTenantId))?.name).toBe(before);
    });

    it('should hand every tenant back once the platform is entitled again', async () => {
      setTestEdition('ee');

      const res = await client.query('organizations.getOrganizations', undefined, { tenantId: extraTenantId });
      expect(res.status).toBe(200);
      const listed = await client.query('tenants.getTenants');
      expect(listed.json.result.data).toHaveLength(2);
    });
  });
});
