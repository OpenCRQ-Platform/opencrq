import type { EventOrigin } from '@app/module';
import { groups, groupUsers, ONBOARDING_RISK_SCOPE_NAME, onboardingWizards, organizations, tenants as tenantsTable, tenantUsers } from '@app/module';
import { eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminUser, createTenant } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const system = () => services.withOrigin({ type: 'system' });

const countBy = async (query: ReturnType<typeof sql>): Promise<number> => {
  const { rows: [row] } = await db.execute<{ count: string }>(query);
  return Number(row?.count);
};

const preparedRowCounts = async (tenantId: string) => ({
  roles: await countBy(sql`SELECT count(*) FROM roles WHERE tenant_id = ${tenantId}`),
  roleCapabilities: await countBy(sql`
    SELECT count(*) FROM role_capabilities rc INNER JOIN roles r ON r.id = rc.role_id WHERE r.tenant_id = ${tenantId}`),
  adminGroups: await countBy(sql`SELECT count(*) FROM groups WHERE tenant_id = ${tenantId} AND slug = 'admin'`),
  connectorsGroups: await countBy(sql`SELECT count(*) FROM groups WHERE tenant_id = ${tenantId} AND slug = 'connectors'`),
  groupRoles: await countBy(sql`
    SELECT count(*) FROM group_roles gr INNER JOIN groups g ON g.id = gr.group_id WHERE g.tenant_id = ${tenantId}`),
  attackSurfaces: await countBy(sql`SELECT count(*) FROM attack_surfaces WHERE tenant_id = ${tenantId}`),
  countries: await countBy(sql`SELECT count(*) FROM countries WHERE tenant_id = ${tenantId}`),
  sectors: await countBy(sql`SELECT count(*) FROM sectors WHERE tenant_id = ${tenantId}`),
  attackOutcomes: await countBy(sql`SELECT count(*) FROM attack_outcomes WHERE tenant_id = ${tenantId}`),
  businessValueCategories: await countBy(sql`SELECT count(*) FROM business_value_categories WHERE tenant_id = ${tenantId}`),
  lossCategories: await countBy(sql`SELECT count(*) FROM loss_categories WHERE tenant_id = ${tenantId}`),
  lossDrivers: await countBy(sql`SELECT count(*) FROM loss_drivers WHERE tenant_id = ${tenantId}`),
  lossDriverActivations: await countBy(sql`
    SELECT count(*) FROM loss_driver_activations lda INNER JOIN attack_outcomes ao ON ao.id = lda.attack_outcome_id WHERE ao.tenant_id = ${tenantId}`),
});

describe('Initial tenant', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('should create the tenant on a database that holds none, with the given id and name', async () => {
    const id = uuidv7();

    const created = await system().tenants.createInitialTenant({ id, name: 'Acme Bank' });

    expect(created).toBe(true);
    const tenants = await system().tenants.getTenants();
    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toMatchObject({ id, name: 'Acme Bank' });
  });

  it('should leave the platform as it is when a tenant already exists', async () => {
    const admin = await createAdminUser(services);
    const existingId = await createTenant(services, admin.userId);
    const newId = uuidv7();

    const created = await system().tenants.createInitialTenant({ id: newId, name: 'Late' });

    expect(created).toBe(false);
    const rows = await db.select({ id: tenantsTable.id }).from(tenantsTable);
    expect(rows.map((row) => row.id)).toEqual([existingId]);
  });

  it('should create exactly one tenant when two calls run together', async () => {
    const [first, second] = await Promise.all([
      system().tenants.createInitialTenant({ id: uuidv7(), name: 'First' }),
      system().tenants.createInitialTenant({ id: uuidv7(), name: 'Second' }),
    ]);

    expect([first, second].sort()).toEqual([false, true]);
    expect(await db.select().from(tenantsTable)).toHaveLength(1);
  });

  it('should give the tenant no member', async () => {
    const id = uuidv7();
    await system().tenants.createInitialTenant({ id, name: 'Default' });

    expect(await db.select().from(tenantUsers).where(eq(tenantUsers.tenantId, id))).toHaveLength(0);
    const tenantGroupIds = db.select({ id: groups.id }).from(groups).where(eq(groups.tenantId, id));
    expect(await db.select().from(groupUsers).where(inArray(groupUsers.groupId, tenantGroupIds))).toHaveLength(0);
  });

  it('should prepare the tenant as one created from the platform administration', async () => {
    const initialId = uuidv7();
    await system().tenants.createInitialTenant({ id: initialId, name: 'Default' });
    const admin = await createAdminUser(services);
    const createdId = await createTenant(services, admin.userId);

    const initialCounts = await preparedRowCounts(initialId);

    expect(initialCounts).toEqual(await preparedRowCounts(createdId));
    expect(initialCounts.adminGroups).toBe(1);
    expect(initialCounts.connectorsGroups).toBe(1);
  });

  it('should provision the Enterprise risk scope and its Get started wizard when asked, as the platform start does', async () => {
    const id = uuidv7();

    await system().tenants.createInitialTenant({ id, name: 'Default' }, { provisionOnboarding: true });

    const scopes = await db.select().from(organizations).where(eq(organizations.tenantId, id));
    expect(scopes.map((scope) => scope.name)).toEqual([ONBOARDING_RISK_SCOPE_NAME]);
    const wizards = await db.select().from(onboardingWizards).where(eq(onboardingWizards.tenantId, id));
    expect(wizards).toHaveLength(1);
    expect(wizards[0]?.organizationId).toBe(scopes[0]?.id);
  });

  it('should provision no wizard when not asked', async () => {
    const id = uuidv7();

    await system().tenants.createInitialTenant({ id, name: 'Default' });

    expect(await db.select().from(onboardingWizards).where(eq(onboardingWizards.tenantId, id))).toHaveLength(0);
  });

  it('should refuse a client origin and create no tenant', async () => {
    const admin = await createAdminUser(services);
    const origin: EventOrigin = { type: 'client', userId: admin.userId, tenantId: uuidv7() };

    await expect(
      services.withOrigin(origin).tenants.createInitialTenant({ id: uuidv7(), name: 'Refused' }),
    ).rejects.toThrow('System origin required');

    expect(await db.select().from(tenantsTable)).toHaveLength(0);
  });

  it('should refuse a platform administrator and create no tenant', async () => {
    const admin = await createAdminUser(services);

    await expect(
      services.withOrigin({ type: 'platform', userId: admin.userId }).tenants.createInitialTenant({ id: uuidv7(), name: 'Refused' }),
    ).rejects.toThrow('System origin required');

    expect(await db.select().from(tenantsTable)).toHaveLength(0);
  });
});
