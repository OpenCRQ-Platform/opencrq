import { sql } from 'drizzle-orm';
import { AttackOutcome_Ransomware, deriveSeedId } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('getNamesByIds (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantAId: string;
  let tenantBId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantAId = uuidv7();
    tenantBId = uuidv7();
    const platformOrigin = { type: 'platform' as const, userId: adminId };
    await services.withOrigin(platformOrigin).tenants.createTenant({ id: tenantAId, name: 'Tenant A' }, adminId);
    await services.withOrigin(platformOrigin).tenants.createTenant({ id: tenantBId, name: 'Tenant B' }, adminId);
  });

  describe('riskScenarios.getNamesByIds', () => {
    it('returns own-tenant names, omits another tenant and unknown ids, and short-circuits on empty input', async () => {
      const originA = { type: 'client' as const, userId: adminId, tenantId: tenantAId };
      const originB = { type: 'client' as const, userId: adminId, tenantId: tenantBId };

      const organizationAId = uuidv7();
      await services.withOrigin(originA).organizations.createOrganizations([{ id: organizationAId, name: 'Org A' }]);
      const organizationBId = uuidv7();
      await services.withOrigin(originB).organizations.createOrganizations([{ id: organizationBId, name: 'Org B' }]);

      const scenarioAId = uuidv7();
      await services.withOrigin(originA).riskScenarios.createRiskScenario({
        id: scenarioAId,
        organizationId: organizationAId,
        name: 'Scenario A',
        description: null,
        attackOutcomeId: deriveSeedId(tenantAId, AttackOutcome_Ransomware),
        primaryAssetIds: [],
      });

      const scenarioBId = uuidv7();
      await services.withOrigin(originB).riskScenarios.createRiskScenario({
        id: scenarioBId,
        organizationId: organizationBId,
        name: 'Scenario B',
        description: null,
        attackOutcomeId: deriveSeedId(tenantBId, AttackOutcome_Ransomware),
        primaryAssetIds: [],
      });

      const unknownId = uuidv7();
      const res = await client.query(
        'riskScenarios.getNamesByIds',
        { ids: [scenarioAId, scenarioBId, unknownId] },
        { tenantId: tenantAId },
      );

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual([{ id: scenarioAId, name: 'Scenario A' }]);

      const emptyRes = await client.query('riskScenarios.getNamesByIds', { ids: [] }, { tenantId: tenantAId });
      expect(emptyRes.json.result.data).toEqual([]);
    });
  });

  describe('serviceAccounts.getNamesByIds', () => {
    it('returns own-tenant names, omits another tenant and unknown ids, and short-circuits on empty input', async () => {
      const originA = { type: 'client' as const, userId: adminId, tenantId: tenantAId };
      const originB = { type: 'client' as const, userId: adminId, tenantId: tenantBId };

      const accountAId = uuidv7();
      await services.withOrigin(originA).serviceAccounts.createServiceAccount({ id: accountAId, name: 'Account A' });
      const accountBId = uuidv7();
      await services.withOrigin(originB).serviceAccounts.createServiceAccount({ id: accountBId, name: 'Account B' });

      const unknownId = uuidv7();
      const res = await client.query(
        'serviceAccounts.getNamesByIds',
        { ids: [accountAId, accountBId, unknownId] },
        { tenantId: tenantAId },
      );

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual([{ id: accountAId, name: 'Account A' }]);

      const emptyRes = await client.query('serviceAccounts.getNamesByIds', { ids: [] }, { tenantId: tenantAId });
      expect(emptyRes.json.result.data).toEqual([]);
    });
  });

  describe('fileStorage.getNamesByIds', () => {
    it('returns own-tenant names, omits another tenant and unknown ids, and short-circuits on empty input', async () => {
      const originA = { type: 'client' as const, userId: adminId, tenantId: tenantAId };
      const originB = { type: 'client' as const, userId: adminId, tenantId: tenantBId };

      const fileA = await services.withOrigin(originA).fileStorage.registerFile(tenantAId, {
        storageKey: '00000000-0000-7000-8000-000000000001',
        originalName: 'file-a.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
      });
      const fileB = await services.withOrigin(originB).fileStorage.registerFile(tenantBId, {
        storageKey: '00000000-0000-7000-8000-000000000002',
        originalName: 'file-b.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
      });

      const unknownId = uuidv7();
      const res = await client.query(
        'fileStorage.getNamesByIds',
        { ids: [fileA.id, fileB.id, unknownId] },
        { tenantId: tenantAId },
      );

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual([{ id: fileA.id, name: 'file-a.json' }]);

      const emptyRes = await client.query('fileStorage.getNamesByIds', { ids: [] }, { tenantId: tenantAId });
      expect(emptyRes.json.result.data).toEqual([]);
    });
  });

  describe('tenants.getTenantUserNamesByIds', () => {
    it('returns tenant members\' names, falling back to email, and omits another tenant\'s member and unknown ids', async () => {
      const originA = { type: 'client' as const, userId: adminId, tenantId: tenantAId };
      const originB = { type: 'client' as const, userId: adminId, tenantId: tenantBId };

      const named = await createUser(db);
      await services.withOrigin(originA).tenants.addTenantUser(tenantAId, named.userId);
      await db.execute(sql`UPDATE users SET name = 'Named Member' WHERE id = ${named.userId}`);

      const unnamed = await createUser(db);
      await services.withOrigin(originA).tenants.addTenantUser(tenantAId, unnamed.userId);

      const otherTenantMember = await createUser(db);
      await services.withOrigin(originB).tenants.addTenantUser(tenantBId, otherTenantMember.userId);

      const unknownId = uuidv7();
      const res = await client.query(
        'tenants.getTenantUserNamesByIds',
        { tenantId: tenantAId, ids: [named.userId, unnamed.userId, otherTenantMember.userId, unknownId] },
        { tenantId: tenantAId },
      );

      expect(res.status).toBe(200);
      expect(res.json.result.data).toHaveLength(2);
      expect(res.json.result.data).toEqual(expect.arrayContaining([
        { id: named.userId, name: 'Named Member' },
        { id: unnamed.userId, name: unnamed.email },
      ]));
    });

    it('returns [] for empty ids', async () => {
      const res = await client.query('tenants.getTenantUserNamesByIds', { tenantId: tenantAId, ids: [] }, { tenantId: tenantAId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual([]);
    });

    it('refuses a caller who is not a member of the requested tenant, like getTenantUsers', async () => {
      const outsider = await createUser(db);
      await services.withOrigin({ type: 'client' as const, userId: adminId, tenantId: tenantBId })
        .tenants.addTenantUser(tenantBId, outsider.userId);

      client.clearCookies();
      await signInAs(client, outsider.userId);

      const res = await client.query(
        'tenants.getTenantUserNamesByIds',
        { tenantId: tenantAId, ids: [] },
        { tenantId: tenantAId },
      );

      expect(res.json.error).toBeTruthy();
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });
  });
});
