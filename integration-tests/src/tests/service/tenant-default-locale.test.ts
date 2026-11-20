import type { EventOrigin } from '@app/module';
import { Capability_ManageSecurity, tenants } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin, grantCapability } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const storedDefaultLocale = async (tenantId: string) =>
  (await db.select({ defaultLocale: tenants.defaultLocale }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.defaultLocale;

describe('Tenant default locale', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  it('should be automatic (null) on a new tenant', async () => {
    expect((await services.withOrigin(adminOrigin).tenants.getTenant(tenantId))?.defaultLocale).toBeNull();
  });

  it('should store a security manager\'s choice, then clear it back to automatic', async () => {
    const scoped = services.withOrigin(adminOrigin).tenants;

    await scoped.setTenantDefaultLocale('fr');
    expect((await scoped.getTenant(tenantId))?.defaultLocale).toBe('fr');

    await scoped.setTenantDefaultLocale(null);
    expect((await scoped.getTenant(tenantId))?.defaultLocale).toBeNull();
  });

  it('should let every member read it', async () => {
    await services.withOrigin(adminOrigin).tenants.setTenantDefaultLocale('fr');
    const member = await createTenantUser(services, db, adminOrigin);

    expect((await services.withOrigin(member.origin).tenants.getTenant(tenantId))?.defaultLocale).toBe('fr');
  });

  it('should leave it untouched when a member without the security capability writes it', async () => {
    await services.withOrigin(adminOrigin).tenants.setTenantDefaultLocale('fr');
    const member = await createTenantUser(services, db, adminOrigin);

    await services.withOrigin(member.origin).tenants.setTenantDefaultLocale('en');

    expect(await storedDefaultLocale(tenantId)).toBe('fr');
  });

  it('should keep the tenant name out of reach of a member without the security capability', async () => {
    const member = await createTenantUser(services, db, adminOrigin);
    const before = (await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.name;

    await repositoryContextOf(db, member.origin).db.update(tenants).set({ name: 'Renamed' }).where(eq(tenants.id, tenantId));

    expect((await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.name).toBe(before);
  });

  it('should refuse an origin without a client tenant', async () => {
    await expect(
      services.withOrigin({ type: 'platform', userId: adminUserId }).tenants.setTenantDefaultLocale('fr'),
    ).rejects.toThrow('Tenant context required');
  });

  it('should not let a security manager of one tenant write another by forging the tenant id', async () => {
    const manager = await createTenantUser(services, db, adminOrigin);
    await grantCapability(services, adminOrigin, manager.userId, Capability_ManageSecurity);
    const otherTenantId = await createTenant(services, adminUserId);
    const forgedOrigin: EventOrigin = { type: 'client', userId: manager.userId, tenantId: otherTenantId };

    await services.withOrigin(forgedOrigin).tenants.setTenantDefaultLocale('fr');

    expect(await storedDefaultLocale(otherTenantId)).toBeNull();
  });

  it('should keep each tenant on its own default', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

    await services.withOrigin(adminOrigin).tenants.setTenantDefaultLocale('fr');

    expect(await storedDefaultLocale(tenantId)).toBe('fr');
    expect((await services.withOrigin(otherOrigin).tenants.getTenant(otherTenantId))?.defaultLocale).toBeNull();
  });
});
