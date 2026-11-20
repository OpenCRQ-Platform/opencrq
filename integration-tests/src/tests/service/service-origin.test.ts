import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Service EventOrigin', () => {
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

  describe('tenantIsolationPolicy — service origin can read', () => {
    it('should allow a service origin to read organizations in the correct tenant', async () => {
      const saId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: saId, name: 'SA' });

      // Create an organization with admin origin
      const orgId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: orgId, name: 'Test Org' },
      ]);

      // Service origin should be able to read organizations (tenantIsolationPolicy only)
      const serviceOrigin: EventOrigin = { type: 'connector', serviceAccountId: saId, tenantId };
      const orgs = await services.withOrigin(serviceOrigin).organizations.getOrganizations();
      expect(orgs.some((o) => o.id === orgId)).toBe(true);
    });
  });

  describe('manageSecurityPolicy blocks service origins', () => {
    it('should block service origin from reading service accounts (manageSecurityPolicy)', async () => {
      const saId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: saId, name: 'SA',
      });

      // SA has no group with MANAGE_SECURITY capability, so manageSecurityPolicy blocks access
      const serviceOrigin: EventOrigin = { type: 'connector', serviceAccountId: saId, tenantId };
      const list = await services.withOrigin(serviceOrigin).serviceAccounts.getServiceAccounts();
      expect(list).toHaveLength(0);
    });

    it('should block service origin from reading groups (manageSecurityPolicy)', async () => {
      const saId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: saId, name: 'SA' });

      const groupId = uuidv7();
      await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Test Group' });

      const serviceOrigin: EventOrigin = { type: 'connector', serviceAccountId: saId, tenantId };
      const groups = await services.withOrigin(serviceOrigin).groups.getGroups();
      expect(groups).toHaveLength(0);
    });
  });

  describe('inactive service account is blocked', () => {
    it('should return empty list when the service account is inactive', async () => {
      const saId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: saId, name: 'SA Inactive' });

      // Create an organization to check via service origin
      const orgId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: orgId, name: 'Org' }]);

      // Deactivate SA: service origin should no longer pass the policy check
      await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(saId, { active: false });

      const serviceOrigin: EventOrigin = { type: 'connector', serviceAccountId: saId, tenantId };
      const orgs = await services.withOrigin(serviceOrigin).organizations.getOrganizations();
      expect(orgs).toHaveLength(0);
    });
  });

  describe('cross-tenant isolation', () => {
    it('should not allow a service origin from tenant A to read data from tenant B', async () => {
      // Create SA in tenant A
      const saId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: saId, name: 'SA A' });

      // Create an organization in tenant A
      const orgAId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: orgAId, name: 'Org A' },
      ]);

      // Reuse the same admin user for tenant B, createAdminUser can only be called once.
      const tenantB = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantB };

      // Create an organization in tenant B
      const orgBId = uuidv7();
      await services.withOrigin(originB).organizations.createOrganizations([
        { id: orgBId, name: 'Org B' },
      ]);

      // Service origin uses tenantId from origin, scoped to tenant A only
      const serviceOriginA: EventOrigin = { type: 'connector', serviceAccountId: saId, tenantId };
      const orgsFromServiceOriginA = await services.withOrigin(serviceOriginA).organizations.getOrganizations();

      // Only tenant A data should be visible, tenant B org not
      expect(orgsFromServiceOriginA.some((o) => o.id === orgAId)).toBe(true);
      expect(orgsFromServiceOriginA.some((o) => o.id === orgBId)).toBe(false);
    });
  });

  describe('non-existent service account', () => {
    it('should return empty data when service account ID does not exist', async () => {
      const nonExistentSaId = uuidv7();
      const serviceOrigin: EventOrigin = { type: 'connector', serviceAccountId: nonExistentSaId, tenantId };

      // Policy checks: SELECT 1 FROM service_accounts WHERE id = ? AND active = true
      // Since SA does not exist, this returns nothing
      const orgs = await services.withOrigin(serviceOrigin).organizations.getOrganizations();
      expect(orgs).toHaveLength(0);
    });
  });
});
