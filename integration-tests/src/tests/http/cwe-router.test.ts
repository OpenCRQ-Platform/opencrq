import { Capability_ManageSecurity, TECHNIQUE_T1110, TECHNIQUE_T1557 } from '@app/module';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin, grantCapability } from '../../helpers/factories';
import { callWithoutInput, proceduresOf } from '../../helpers/router-procedures';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs } from '../../helpers/sign-in';

const services = createTestServices(db);

const loginAs = async (user: { userId: string }) => {
  const client = createTrpcTestClient(await getTestServer());
  await signInAs(client, user.userId);
  return client;
};

describe('CWE router requires MANAGE_SECURITY to edit the mapping (HTTP/tRPC)', () => {
  describe('every procedure', () => {
    const mutations = proceduresOf('cwe').filter(({ type }) => type === 'mutation');
    const queries = proceduresOf('cwe').filter(({ type }) => type === 'query');
    let adminClient: ReturnType<typeof createTrpcTestClient>;
    let memberClient: ReturnType<typeof createTrpcTestClient>;
    let tenantId: string;

    // Called without input, a mutation fails validation and a query only reads: nothing writes, so one setup serves the whole enumeration.
    beforeAll(async () => {
      await truncateAllTables(db);
      const admin = await createTenantWithAdmin(services);
      tenantId = admin.tenantId;
      adminClient = await loginAs(admin);
      memberClient = await loginAs(await createTenantUser(services, db, admin.origin));
    });

    it('should expose mutations and queries, so the enumerations below test something', () => {
      expect(mutations.length).toBeGreaterThan(0);
      expect(queries.length).toBeGreaterThan(0);
    });

    it.each(mutations)('should return FORBIDDEN for $path to a member without the capability, before any input validation', async (procedure) => {
      const res = await callWithoutInput(memberClient, procedure, tenantId);

      expect(res.status).toBe(403);
      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it.each(mutations)('should not refuse $path as FORBIDDEN to the tenant admin', async (procedure) => {
      const res = await callWithoutInput(adminClient, procedure, tenantId);

      expect(res.json.error?.data.code).not.toBe('FORBIDDEN');
    });

    it.each(queries)('should not refuse $path as FORBIDDEN to a member without the capability', async (procedure) => {
      const res = await callWithoutInput(memberClient, procedure, tenantId);

      expect(res.json.error?.data.code).not.toBe('FORBIDDEN');
    });
  });

  describe('behaviours', () => {
    let adminClient: ReturnType<typeof createTrpcTestClient>;
    let memberClient: ReturnType<typeof createTrpcTestClient>;
    let tenantId: string;
    let origin: Awaited<ReturnType<typeof createTenantWithAdmin>>['origin'];

    beforeEach(async () => {
      await truncateAllTables(db);
      const admin = await createTenantWithAdmin(services);
      ({ tenantId, origin } = admin);
      adminClient = await loginAs(admin);
      memberClient = await loginAs(await createTenantUser(services, db, origin));
    });

    it('should let a member without the capability read the catalogue and a weakness', async () => {
      const list = await memberClient.query('cwe.list', undefined, { tenantId });
      const get = await memberClient.query('cwe.get', { cweId: 'CWE-287' }, { tenantId });

      expect(list.status).toBe(200);
      expect(get.status).toBe(200);
    });

    it('should leave the mapping untouched when a member without the capability removes a shipped technique', async () => {
      const before = await adminClient.query('cwe.get', { cweId: 'CWE-287' }, { tenantId });

      const removal = await memberClient.mutation('cwe.removeTechnique', { cweId: 'CWE-287', techniqueId: TECHNIQUE_T1557 }, { tenantId });

      expect(removal.json.error.data.code).toBe('FORBIDDEN');
      const reread = await adminClient.query('cwe.get', { cweId: 'CWE-287' }, { tenantId });
      expect(reread.json.result.data).toEqual(before.json.result.data);
    });

    it('should let a non-admin member holding MANAGE_SECURITY add a technique', async () => {
      const manager = await createTenantUser(services, db, origin);
      await grantCapability(services, origin, manager.userId, Capability_ManageSecurity);
      const managerClient = await loginAs(manager);

      const res = await managerClient.mutation('cwe.addTechnique', { cweId: 'CWE-287', techniqueId: TECHNIQUE_T1110 }, { tenantId });

      expect(res.status).toBe(200);
      const reread = await adminClient.query('cwe.get', { cweId: 'CWE-287' }, { tenantId });
      expect(reread.json.result.data.techniques).toContainEqual(expect.objectContaining({ techniqueId: TECHNIQUE_T1110, state: 'added' }));
    });
  });
});
