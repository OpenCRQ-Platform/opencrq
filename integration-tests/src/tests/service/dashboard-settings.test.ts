import type { EventOrigin } from '@app/module';
import { Capability_ManageSecurity, dashboardSettings } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin, grantCapability } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Dashboard Settings Service', () => {
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

  describe('tenant home dashboard', () => {
    it('should be null until a security manager sets one', async () => {
      expect(await services.withOrigin(adminOrigin).dashboardSettings.getTenantHomeDashboard()).toBeNull();
    });

    it('should store, then overwrite, the tenant home dashboard', async () => {
      const settings = services.withOrigin(adminOrigin).dashboardSettings;
      await settings.setTenantHomeDashboard('risk-sankey');
      await settings.setTenantHomeDashboard('findings-assets');

      expect(await settings.getTenantHomeDashboard()).toBe('findings-assets');
    });

    it('should reject an id that is not a dashboard id', async () => {
      await expect(
        services.withOrigin(adminOrigin).dashboardSettings.setTenantHomeDashboard('Not An Id'),
      ).rejects.toThrow('Invalid dashboard id');
    });

    it('should reject an origin without a client tenant', async () => {
      await expect(
        services.withOrigin({ type: 'system' }).dashboardSettings.setTenantHomeDashboard('risk'),
      ).rejects.toThrow('Tenant context required');
    });
  });

  describe('security policy', () => {
    it('should let a member without the security capability read the tenant home dashboard', async () => {
      await services.withOrigin(adminOrigin).dashboardSettings.setTenantHomeDashboard('risk-sankey');
      const member = await createTenantUser(services, db, adminOrigin);

      expect(await services.withOrigin(member.origin).dashboardSettings.getTenantHomeDashboard()).toBe('risk-sankey');
    });

    it('should refuse a first write from a member without the security capability', async () => {
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(
        services.withOrigin(member.origin).dashboardSettings.setTenantHomeDashboard('risk-sankey'),
      ).rejects.toThrow('Access Denied');
      expect(await services.withOrigin(adminOrigin).dashboardSettings.getTenantHomeDashboard()).toBeNull();
    });

    it('should leave the stored value untouched when a member without the security capability overwrites it', async () => {
      await services.withOrigin(adminOrigin).dashboardSettings.setTenantHomeDashboard('risk-sankey');
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(
        services.withOrigin(member.origin).dashboardSettings.setTenantHomeDashboard('findings-assets'),
      ).rejects.toThrow('Access Denied');

      expect(await services.withOrigin(adminOrigin).dashboardSettings.getTenantHomeDashboard()).toBe('risk-sankey');
    });
  });

  describe('tenant isolation', () => {
    it('should keep each tenant on its own home dashboard', async () => {
      await services.withOrigin(adminOrigin).dashboardSettings.setTenantHomeDashboard('risk-sankey');
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      expect(await services.withOrigin(otherOrigin).dashboardSettings.getTenantHomeDashboard()).toBeNull();

      await services.withOrigin(otherOrigin).dashboardSettings.setTenantHomeDashboard('findings-assets');

      expect(await services.withOrigin(adminOrigin).dashboardSettings.getTenantHomeDashboard()).toBe('risk-sankey');
      expect(await services.withOrigin(otherOrigin).dashboardSettings.getTenantHomeDashboard()).toBe('findings-assets');
    });

    it('should not let a security manager of another tenant read or write it by forging the tenant id', async () => {
      const manager = await createTenantUser(services, db, adminOrigin);
      await grantCapability(services, adminOrigin, manager.userId, Capability_ManageSecurity);
      const otherTenantId = await createTenant(services, adminUserId);
      const otherAdminOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      await services.withOrigin(otherAdminOrigin).dashboardSettings.setTenantHomeDashboard('findings-assets');
      const forgedOrigin: EventOrigin = { type: 'client', userId: manager.userId, tenantId: otherTenantId };

      expect(await services.withOrigin(forgedOrigin).dashboardSettings.getTenantHomeDashboard()).toBeNull();

      await services.withOrigin(forgedOrigin).dashboardSettings.setTenantHomeDashboard('risk-sankey').catch(() => undefined);

      expect(await services.withOrigin(otherAdminOrigin).dashboardSettings.getTenantHomeDashboard()).toBe('findings-assets');
    });

    it('should drop the setting with its tenant', async () => {
      await services.withOrigin(adminOrigin).dashboardSettings.setTenantHomeDashboard('risk-sankey');

      await services.withOrigin({ type: 'platform', userId: adminUserId }).tenants.deleteTenants([tenantId]);

      expect(await db.select().from(dashboardSettings).where(eq(dashboardSettings.tenantId, tenantId))).toHaveLength(0);
    });
  });

  describe('user home dashboard', () => {
    it('should store the user override and read it back', async () => {
      const users = services.withOrigin(adminOrigin).users;
      expect(await users.getUserHomeDashboard(adminUserId)).toBeUndefined();

      await users.updateUser(adminUserId, { homeDashboardId: 'findings-assets' });

      expect(await users.getUserHomeDashboard(adminUserId)).toBe('findings-assets');
    });
  });
});
