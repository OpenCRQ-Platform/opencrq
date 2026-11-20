import type { EventOrigin } from '@app/module';
import { Capability_ManageSecurity } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminUser, createTenant, createTenantUser, createTenantWithAdmin, grantCapability } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Capabilities Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
  });

  describe('getCapabilities', () => {
    it('should list seeded capabilities', async () => {
      const caps = await services.withOrigin(adminOrigin).capabilities.getCapabilities();
      expect(caps.length).toBeGreaterThanOrEqual(1);
      expect(caps.map((c) => c.id)).toContain(Capability_ManageSecurity);
    });
  });

  describe('getUserCapabilities', () => {
    it('should return MANAGE_SECURITY for admin user (via group → role → capability chain)', async () => {
      const userCaps = await services.withOrigin(adminOrigin)
        .capabilities.getUserCapabilities(adminUserId);
      expect(userCaps.map((c) => c.id)).toContain(Capability_ManageSecurity);
    });

    it('should return empty capabilities for user without group membership', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);

      const userCaps = await services.withOrigin(regularUser.origin)
        .capabilities.getUserCapabilities(regularUser.userId);
      expect(userCaps).toHaveLength(0);
    });

    it('should grant capabilities after adding user to a group with a role', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);

      await grantCapability(services, adminOrigin, regularUser.userId, Capability_ManageSecurity);

      // Now the user should have MANAGE_SECURITY capability
      const userCaps = await services.withOrigin(adminOrigin)
        .capabilities.getUserCapabilities(regularUser.userId);
      expect(userCaps.map((c) => c.id)).toContain(Capability_ManageSecurity);
    });
  });

  describe('hasManageSecurity', () => {
    it('should return true for admin user', async () => {
      const has = await services.withOrigin(adminOrigin)
        .capabilities.hasManageSecurity();
      expect(has).toBe(true);
    });

    it('should return false for regular user', async () => {
      const regularUser = await createTenantUser(services, db, adminOrigin);

      const has = await services.withOrigin(regularUser.origin)
        .capabilities.hasManageSecurity();
      expect(has).toBe(false);
    });
  });

  describe('capability scoping across tenants', () => {
    let crossTenantAdminUserId: string;
    let tenantAId: string;
    let tenantBId: string;
    let userId: string;
    let userOriginInA: EventOrigin;
    let userOriginInB: EventOrigin;

    beforeEach(async () => {
      await truncateAllTables(db);

      const admin = await createAdminUser(services);
      crossTenantAdminUserId = admin.userId;
      tenantAId = await createTenant(services, crossTenantAdminUserId);
      tenantBId = await createTenant(services, crossTenantAdminUserId);

      const adminOriginInA: EventOrigin = { type: 'client', userId: crossTenantAdminUserId, tenantId: tenantAId };
      const adminOriginInB: EventOrigin = { type: 'client', userId: crossTenantAdminUserId, tenantId: tenantBId };

      const user = await createTenantUser(services, db, adminOriginInA);
      userId = user.userId;
      userOriginInA = user.origin;
      userOriginInB = { type: 'client', userId, tenantId: tenantBId };

      // The user is an ordinary member of A and an administrator of B.
      await services.withOrigin(adminOriginInB).tenants.addTenantUser(tenantBId, userId);
      await grantCapability(services, adminOriginInB, userId, Capability_ManageSecurity);
    });

    it('should not grant a capability held in tenant B while acting in tenant A', async () => {
      const has = await services.withOrigin(userOriginInA).capabilities.hasManageSecurity();
      expect(has).toBe(false);
    });

    it('should grant the capability while acting in the tenant it was held in', async () => {
      const has = await services.withOrigin(userOriginInB).capabilities.hasManageSecurity();
      expect(has).toBe(true);
    });

    it('should deny the capability on the tenant-less platform origin', async () => {
      const has = await services.withOrigin({ type: 'platform', userId }).capabilities.hasManageSecurity();
      expect(has).toBe(false);
    });

    it('should have hasCapability agree with hasManageSecurity on every origin', async () => {
      const origins: Array<EventOrigin> = [userOriginInA, userOriginInB, { type: 'platform', userId }];
      for (const origin of origins) {
        const hasCapability = await services.withOrigin(origin).capabilities.hasCapability(Capability_ManageSecurity);
        const hasManageSecurity = await services.withOrigin(origin).capabilities.hasManageSecurity();
        expect(hasCapability).toBe(hasManageSecurity);
      }
    });

    it('should not leak the target user capabilities to a caller in another tenant', async () => {
      const seenFromA = await services.withOrigin(userOriginInA).capabilities.getUserCapabilities(userId);
      expect(seenFromA).toHaveLength(0);

      const seenFromB = await services.withOrigin(userOriginInB).capabilities.getUserCapabilities(userId);
      expect(seenFromB.map((c) => c.id)).toContain(Capability_ManageSecurity);
    });

    it('should still recognize the admin as holding the capability in both tenants', async () => {
      const hasInA = await services.withOrigin({ type: 'client', userId: crossTenantAdminUserId, tenantId: tenantAId })
        .capabilities.hasManageSecurity();
      const hasInB = await services.withOrigin({ type: 'client', userId: crossTenantAdminUserId, tenantId: tenantBId })
        .capabilities.hasManageSecurity();
      expect(hasInA).toBe(true);
      expect(hasInB).toBe(true);
    });
  });
});
