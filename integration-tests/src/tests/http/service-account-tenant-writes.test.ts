import type { EventOrigin } from '@app/module';
import { EMPTY_FINANCIAL_PROFILE_ANSWERS, financialProfiles, groups, organizations, roles } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { createServiceAccountClient } from '../../helpers/service-account-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

describe('Service account writes of tenant data (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let serviceAccount: Awaited<ReturnType<typeof createServiceAccountClient>>;
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    serviceAccount = await createServiceAccountClient(await getTestServer(), services, adminOrigin);
  });

  const otherTenantOrigin = async (): Promise<EventOrigin> => {
    if (adminOrigin.type !== 'client') {
      throw new TypeError('The tenant admin is expected to act as a client');
    }
    return { type: 'client', userId: adminOrigin.userId, tenantId: await createTenant(services, adminOrigin.userId) };
  };

  const joinAdminGroup = async () => {
    const scoped = services.withOrigin(adminOrigin);
    const adminGroup = (await scoped.groups.getGroups()).find((group) => group.slug === 'admin')!;
    await scoped.serviceAccounts.addGroupToServiceAccount(serviceAccount.serviceAccountId, adminGroup.id);
  };

  it('should create a risk scope in the service account’s tenant', async () => {
    const id = uuidv7();

    const res = await serviceAccount.mutation('organizations.createOrganizationsTransaction', [{ id, name: 'Created by a connector' }]);

    expect(res.json.error).toBeUndefined();
    expect(res.status).toBe(200);
    const [row] = await db.select().from(organizations).where(eq(organizations.id, id));
    expect(row).toMatchObject({ name: 'Created by a connector', tenantId });
  });

  it.each([
    ['its own tenant', () => Promise.resolve(adminOrigin)],
    ['another tenant', otherTenantOrigin],
  ])('should answer CONFLICT to a risk scope whose id %s already holds', async (_holder, holderOrigin) => {
    const id = uuidv7();
    await services.withOrigin(await holderOrigin()).organizations.createOrganizations([{ id, name: 'First' }]);

    const res = await serviceAccount.mutation('organizations.createOrganizationsTransaction', [{ id, name: 'Retried create' }]);

    expect(res.status).toBe(409);
    expect(res.json.error.data.code).toBe('CONFLICT');
  });

  it('should save a financial profile in the service account’s tenant and derive the scope’s revenue band', async () => {
    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);

    const res = await serviceAccount.mutation('financialProfiles.saveFinancialProfile', {
      organizationId,
      answers: { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, annualRevenue: 50_000_000 },
    });

    expect(res.json.error).toBeUndefined();
    expect(res.status).toBe(200);
    const [profile] = await db.select().from(financialProfiles).where(eq(financialProfiles.organizationId, organizationId));
    expect(profile).toMatchObject({ tenantId, annualRevenue: 50_000_000 });
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    expect(organization.revenueBand).toBe('10m_100m');
  });

  it('should answer NOT_FOUND to a financial profile for another tenant’s risk scope', async () => {
    const foreignScopeId = uuidv7();
    await services.withOrigin(await otherTenantOrigin()).organizations.createOrganizations([{ id: foreignScopeId, name: 'Foreign scope' }]);

    const res = await serviceAccount.mutation('financialProfiles.saveFinancialProfile', {
      organizationId: foreignScopeId,
      answers: { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, annualRevenue: 50_000_000 },
    });

    expect(res.status).toBe(404);
    expect(res.json.error.data.code).toBe('NOT_FOUND');
    expect(await db.select().from(financialProfiles).where(eq(financialProfiles.organizationId, foreignScopeId))).toHaveLength(0);
  });

  it('should create a role in the service account’s tenant once it holds MANAGE_SECURITY', async () => {
    await joinAdminGroup();
    const id = uuidv7();

    const res = await serviceAccount.mutation('roles.createRole', { id, name: 'Connector role' });

    expect(res.json.error).toBeUndefined();
    expect(res.status).toBe(200);
    const [row] = await db.select().from(roles).where(eq(roles.id, id));
    expect(row).toMatchObject({ name: 'Connector role', tenantId });
  });

  it('should create a group in the service account’s tenant once it holds MANAGE_SECURITY', async () => {
    await joinAdminGroup();
    const id = uuidv7();

    const res = await serviceAccount.mutation('groups.createGroup', { id, name: 'Connector group' });

    expect(res.json.error).toBeUndefined();
    expect(res.status).toBe(200);
    const [row] = await db.select().from(groups).where(eq(groups.id, id));
    expect(row).toMatchObject({ name: 'Connector group', tenantId });
  });
});
