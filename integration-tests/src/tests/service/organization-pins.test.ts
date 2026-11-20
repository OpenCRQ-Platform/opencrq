import type { EventOrigin } from '@app/module';
import { organizationUnpins, RiskScopeNotFoundError } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Risk scope pins', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let europeId: string;
  let asiaId: string;

  const unpinned = async (origin: EventOrigin) => (await services.withOrigin(origin).organizations.getUnpinnedOrganizationIds()).toSorted();

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    europeId = uuidv7();
    asiaId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: europeId, name: 'Acme Bank Europe' },
      { id: asiaId, name: 'Acme Bank Asia Pacific' },
    ]);
  });

  it('should pin every scope by default', async () => {
    expect(await unpinned(adminOrigin)).toEqual([]);
  });

  it('should unpin a scope, then pin it again', async () => {
    const organizations = services.withOrigin(adminOrigin).organizations;

    await organizations.setOrganizationPinned(asiaId, false);
    await organizations.setOrganizationPinned(asiaId, false);
    expect(await unpinned(adminOrigin)).toEqual([asiaId]);

    await organizations.setOrganizationPinned(asiaId, true);
    expect(await unpinned(adminOrigin)).toEqual([]);
  });

  it('should pin a scope created after the last change', async () => {
    await services.withOrigin(adminOrigin).organizations.setOrganizationPinned(asiaId, false);

    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: uuidv7(), name: 'Acme Retail Network' }]);

    expect(await unpinned(adminOrigin)).toEqual([asiaId]);
  });

  it('should refuse a scope the caller cannot see', async () => {
    await expect(services.withOrigin(adminOrigin).organizations.setOrganizationPinned(uuidv7(), false))
      .rejects.toBeInstanceOf(RiskScopeNotFoundError);
  });

  it('should refuse an origin that is not a user inside a tenant', async () => {
    await expect(services.withOrigin({ type: 'system' }).organizations.setOrganizationPinned(asiaId, false))
      .rejects.toThrow('A pin belongs to a user inside a tenant');
  });

  describe('security policy', () => {
    it('should never change another member\'s pins', async () => {
      const member = await createTenantUser(services, db, adminOrigin);

      await services.withOrigin(member.origin).organizations.setOrganizationPinned(asiaId, false);
      expect(await unpinned(adminOrigin)).toEqual([]);

      await services.withOrigin(adminOrigin).organizations.setOrganizationPinned(europeId, false);
      await services.withOrigin(member.origin).organizations.setOrganizationPinned(europeId, true);
      expect(await unpinned(adminOrigin)).toEqual([europeId]);
      expect(await unpinned(member.origin)).toEqual([asiaId]);
    });

    it('should not read nor write another tenant\'s scopes', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      await services.withOrigin(adminOrigin).organizations.setOrganizationPinned(asiaId, false);

      expect(await unpinned(otherOrigin)).toEqual([]);
      await expect(services.withOrigin(otherOrigin).organizations.setOrganizationPinned(europeId, false))
        .rejects.toBeInstanceOf(RiskScopeNotFoundError);
    });
  });

  describe('cascades', () => {
    it('should leave no pin state behind a deleted scope', async () => {
      const member = await createTenantUser(services, db, adminOrigin);
      await services.withOrigin(adminOrigin).organizations.setOrganizationPinned(asiaId, false);
      await services.withOrigin(member.origin).organizations.setOrganizationPinned(asiaId, false);

      await services.withOrigin(adminOrigin).organizations.deleteOrganizations([asiaId]);

      expect(await db.select().from(organizationUnpins).where(eq(organizationUnpins.organizationId, asiaId))).toHaveLength(0);
    });

    it('should drop a deleted user\'s pins', async () => {
      const member = await createTenantUser(services, db, adminOrigin);
      await services.withOrigin(member.origin).organizations.setOrganizationPinned(asiaId, false);

      await services.withOrigin({ type: 'auth' }).users.deleteUser(member.userId);

      expect(await db.select().from(organizationUnpins).where(eq(organizationUnpins.userId, member.userId))).toHaveLength(0);
    });

    it('should drop a deleted tenant\'s pins', async () => {
      await services.withOrigin(adminOrigin).organizations.setOrganizationPinned(asiaId, false);

      await services.withOrigin({ type: 'platform', userId: adminUserId }).tenants.deleteTenants([tenantId]);

      expect(await db.select().from(organizationUnpins).where(eq(organizationUnpins.tenantId, tenantId))).toHaveLength(0);
    });
  });
});
