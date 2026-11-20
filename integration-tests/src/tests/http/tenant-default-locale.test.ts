import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

const ADMIN_EMAIL = 'admin@test.com';

describe('Tenant default locale (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantId: string;

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

  const loginAsMember = async () => {
    const member = await createUser(db);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .tenants.addTenantUser(tenantId, member.userId);
    client.clearCookies();
    await signInAs(client, member.userId);
  };

  const readDefaultLocale = async () =>
    (await client.query('tenants.getTenant', { id: tenantId }, { tenantId })).json.result.data.defaultLocale;

  it('should let a tenant administrator set the default locale, then set it back to automatic', async () => {
    const set = await client.mutation('tenants.setTenantDefaultLocale', { locale: 'fr' }, { tenantId });
    expect(set.status).toBe(200);
    expect(await readDefaultLocale()).toBe('fr');

    const clear = await client.mutation('tenants.setTenantDefaultLocale', { locale: null }, { tenantId });
    expect(clear.status).toBe(200);
    expect(await readDefaultLocale()).toBeNull();
  });

  it('should refuse the default locale to a member who is not a tenant administrator', async () => {
    await loginAsMember();

    const res = await client.mutation('tenants.setTenantDefaultLocale', { locale: 'fr' }, { tenantId });
    expect(res.json.error.data.code).toBe('FORBIDDEN');
    expect(await readDefaultLocale()).toBeNull();
  });

  it('should reject an unsupported locale with BAD_REQUEST', async () => {
    const res = await client.mutation('tenants.setTenantDefaultLocale', { locale: 'de' }, { tenantId });
    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should require a tenant', async () => {
    const res = await client.mutation('tenants.setTenantDefaultLocale', { locale: 'fr' });
    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should let a member set their own language back to automatic', async () => {
    await loginAsMember();
    await client.mutation('users.updateUser', { locale: 'fr' }, { tenantId });

    const clear = await client.mutation('users.updateUser', { locale: null }, { tenantId });
    expect(clear.status).toBe(200);

    const read = await client.query('users.getUserLocale', undefined, { tenantId });
    expect(read.json.result.data).toBeNull();
  });
});
