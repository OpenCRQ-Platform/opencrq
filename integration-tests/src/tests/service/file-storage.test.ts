import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('File Storage Service', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  describe('registerFile', () => {
    it('should create a stored file entry', async () => {
      const result = await services.withOrigin(adminOrigin).fileStorage.registerFile(tenantId, {
        storageKey: '00000000-0000-7000-8000-000000000001',
        originalName: 'test-bundle.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
      });

      expect(result).toBeTruthy();
      expect(result.id).toBeTruthy();
      expect(result.storageKey).toBe('00000000-0000-7000-8000-000000000001');
      expect(result.originalName).toBe('test-bundle.json');
      expect(result.sizeBytes).toBe(1024);
    });

    it('two entries with identical content can coexist (no dedup — caller generates distinct storageKeys)', async () => {
      const first = await services.withOrigin(adminOrigin).fileStorage.registerFile(tenantId, {
        storageKey: '00000000-0000-7000-8000-000000000003',
        originalName: 'bundle.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
      });
      const second = await services.withOrigin(adminOrigin).fileStorage.registerFile(tenantId, {
        storageKey: '00000000-0000-7000-8000-000000000004',
        originalName: 'bundle.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
      });

      expect(first.id).not.toBe(second.id);
      expect(await services.withOrigin(adminOrigin).fileStorage.getFile(first.id)).toBeTruthy();
      expect(await services.withOrigin(adminOrigin).fileStorage.getFile(second.id)).toBeTruthy();
    });
  });

  describe('getFile', () => {
    it('should return file metadata by id', async () => {
      const created = await services.withOrigin(adminOrigin).fileStorage.registerFile(tenantId, {
        storageKey: '00000000-0000-7000-8000-000000000010',
        originalName: 'test-bundle.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
      });

      const result = await services.withOrigin(adminOrigin).fileStorage.getFile(created.id);
      expect(result).toBeTruthy();
      expect(result!.id).toBe(created.id);
      expect(result!.originalName).toBe('test-bundle.json');
    });

    it('should return undefined for non-existent file', async () => {
      const result = await services.withOrigin(adminOrigin).fileStorage.getFile('00000000-0000-0000-0000-000000000000');
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should credit a service account on a file it registered, naming it only for MANAGE_SECURITY', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Sync Bot' });
      const serviceOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId };
      await services.withOrigin(serviceOrigin).fileStorage.registerFile(tenantId, {
        storageKey: '00000000-0000-7000-8000-000000000040',
        originalName: 'uploaded-by-bot.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
      });
      const member = await createTenantUser(services, db, adminOrigin);

      const [asAdmin] = await services.withOrigin(adminOrigin).fileStorage.list();
      expect(asAdmin).toMatchObject({ createdByEmail: null, createdByServiceAccountId: serviceAccountId, createdByServiceAccountName: 'Sync Bot' });

      const [asMember] = await services.withOrigin(member.origin).fileStorage.list();
      expect(asMember).toMatchObject({ createdByEmail: null, createdByServiceAccountId: serviceAccountId, createdByServiceAccountName: null });
    });
  });

  describe('tenant isolation', () => {
    it('should not return files from another tenant', async () => {
      const created = await services.withOrigin(adminOrigin).fileStorage.registerFile(tenantId, {
        storageKey: '00000000-0000-7000-8000-000000000020',
        originalName: 'secret.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
      });

      // Create a second tenant using the same admin user (who has CREATE_TENANTS capability)
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin = { type: 'client' as const, userId: adminUserId, tenantId: otherTenantId };

      // The second tenant context should NOT see tenant A's file
      const result = await services.withOrigin(otherOrigin).fileStorage.getFile(created.id);
      expect(result).toBeUndefined();
    });

    it('should reject creating a file for a different tenant', async () => {
      const otherTenantId = await createTenant(services, adminUserId);

      // adminOrigin belongs to tenantId, but we pass otherTenantId: policy must block this
      await expect(
        services.withOrigin(adminOrigin).fileStorage.registerFile(otherTenantId, {
          storageKey: '00000000-0000-7000-8000-000000000030',
          originalName: 'cross-tenant.json',
          mimeType: 'application/json',
          sizeBytes: 1024,
        }),
      ).rejects.toThrow('Cannot create for another tenant');
    });
  });
});
