import { Capability_ManageSecurity } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin, grantCapability } from '../../helpers/factories';
import { callWithoutInput, proceduresOf } from '../../helpers/router-procedures';
import { createServiceAccountClient } from '../../helpers/service-account-client';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs } from '../../helpers/sign-in';

const SECURITY_ROUTERS = ['groups', 'roles', 'members', 'serviceAccounts', 'crqIndicatorSettings', 'threatRelevanceSettings'] as const;

const services = createTestServices(db);

const loginAs = async (user: { userId: string }) => {
  const client = createTrpcTestClient(await getTestServer());
  await signInAs(client, user.userId);
  return client;
};

describe('Tenant security routers require MANAGE_SECURITY (HTTP/tRPC)', () => {
  describe('every procedure', () => {
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

    describe.each(SECURITY_ROUTERS)('%s router', (prefix) => {
      const procedures = proceduresOf(prefix);

      it('should expose procedures, so the enumeration below tests something', () => {
        expect(procedures.length).toBeGreaterThan(0);
      });

      it.each(procedures.filter(({ type }) => type === 'mutation'))('should declare an output for $path, so the database driver result never reaches the caller', ({ hasOutput }) => {
        expect(hasOutput).toBe(true);
      });

      it.each(procedures)('should return FORBIDDEN for $path to a member without the capability, before any input validation', async (procedure) => {
        const res = await callWithoutInput(memberClient, procedure, tenantId);

        expect(res.status).toBe(403);
        expect(res.json.error.data.code).toBe('FORBIDDEN');
      });

      it.each(procedures)('should not refuse $path as FORBIDDEN to the tenant admin', async (procedure) => {
        const res = await callWithoutInput(adminClient, procedure, tenantId);

        expect(res.json.error?.data.code).not.toBe('FORBIDDEN');
      });
    });
  });

  describe('behaviours', () => {
    let adminClient: ReturnType<typeof createTrpcTestClient>;
    let memberClient: ReturnType<typeof createTrpcTestClient>;
    let adminEmail: string;
    let memberUserId: string;
    let tenantId: string;
    let origin: Awaited<ReturnType<typeof createTenantWithAdmin>>['origin'];

    beforeEach(async () => {
      await truncateAllTables(db);
      const admin = await createTenantWithAdmin(services);
      ({ tenantId, origin } = admin);
      adminEmail = admin.email;
      adminClient = await loginAs(admin);
      const member = await createTenantUser(services, db, origin);
      memberUserId = member.userId;
      memberClient = await loginAs(member);
    });

    it('should leave a group untouched when a member without the capability tries to rename then delete it', async () => {
      const groupId = uuidv7();
      await services.withOrigin(origin).groups.createGroup({ id: groupId, name: 'Original' });

      const rename = await memberClient.mutation('groups.updateGroup', { id: groupId, name: 'Hijacked' }, { tenantId });
      const remove = await memberClient.mutation('groups.deleteGroup', { id: groupId }, { tenantId });

      expect(rename.json.error.data.code).toBe('FORBIDDEN');
      expect(remove.json.error.data.code).toBe('FORBIDDEN');
      const reread = await adminClient.query('groups.getGroup', { id: groupId }, { tenantId });
      expect(reread.json.result.data).toMatchObject({ id: groupId, name: 'Original' });
    });

    it('should refuse members.searchDirectory to a member without the capability instead of confirming tenant membership', async () => {
      const res = await memberClient.query('members.searchDirectory', { query: adminEmail }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should let a non-admin member holding MANAGE_SECURITY read and rename groups', async () => {
      const manager = await createTenantUser(services, db, origin);
      await grantCapability(services, origin, manager.userId, Capability_ManageSecurity);
      const managerClient = await loginAs(manager);
      const groupId = uuidv7();
      await services.withOrigin(origin).groups.createGroup({ id: groupId, name: 'Before' });

      const list = await managerClient.query('groups.listGroups', undefined, { tenantId });
      const rename = await managerClient.mutation('groups.updateGroup', { id: groupId, name: 'After' }, { tenantId });

      expect(list.status).toBe(200);
      expect(list.json.result.data.map((group: { id: string }) => group.id)).toContain(groupId);
      expect(rename.status).toBe(200);
      const reread = await adminClient.query('groups.getGroup', { id: groupId }, { tenantId });
      expect(reread.json.result.data).toMatchObject({ id: groupId, name: 'After' });
    });

    it('should refuse a service account without the capability and admit it once it joins the admin group', async () => {
      const saClient = await createServiceAccountClient(await getTestServer(), services, origin);

      const before = await saClient.query('groups.getGroups');
      expect(before.json.error.data.code).toBe('FORBIDDEN');

      const groups = await adminClient.query('groups.getGroups', undefined, { tenantId });
      const adminGroup = groups.json.result.data.find((group: { slug: string | null }) => group.slug === 'admin');
      const grant = await adminClient.mutation('serviceAccounts.addGroupToServiceAccount', {
        serviceAccountId: saClient.serviceAccountId, groupId: adminGroup.id,
      }, { tenantId });
      expect(grant.status).toBe(200);

      const after = await saClient.query('groups.getGroups');
      expect(after.status).toBe(200);
    });

    it('should leave the CRQ indicator settings untouched when a member without the capability tries to update them', async () => {
      const before = await adminClient.query('crqIndicatorSettings.getCrqIndicatorSettings', undefined, { tenantId });

      const update = await memberClient.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { iterations: 10 }, { tenantId });

      expect(update.json.error.data.code).toBe('FORBIDDEN');
      const reread = await adminClient.query('crqIndicatorSettings.getCrqIndicatorSettings', undefined, { tenantId });
      expect(reread.json.result.data).toEqual(before.json.result.data);
    });

    it('should leave the threat relevance settings untouched when a member without the capability tries to update them', async () => {
      const before = await adminClient.query('threatRelevanceSettings.getThreatRelevanceSettings', undefined, { tenantId });

      const update = await memberClient.mutation('threatRelevanceSettings.updateThreatRelevanceSettings', {
        actHalfLifeObservedDays: 10, actHalfLifeAuthoredDays: 10, confidenceGate: 10,
      }, { tenantId });

      expect(update.json.error.data.code).toBe('FORBIDDEN');
      const reread = await adminClient.query('threatRelevanceSettings.getThreatRelevanceSettings', undefined, { tenantId });
      expect(reread.json.result.data).toEqual(before.json.result.data);
    });

    it('should keep answering BAD_REQUEST to a call without x-tenant-id', async () => {
      const res = await adminClient.query('groups.getGroups');

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    describe('mutation outputs', () => {
      it('should answer groups.updateGroup with no data', async () => {
        const id = uuidv7();
        await services.withOrigin(origin).groups.createGroup({ id, name: 'Before' });

        const res = await adminClient.mutation('groups.updateGroup', { id, name: 'After' }, { tenantId });

        expect(res.status).toBe(200);
        expect(res.json.result.data).toBeUndefined();
      });

      it('should answer groups.deleteGroup with no data', async () => {
        const id = uuidv7();
        await services.withOrigin(origin).groups.createGroup({ id, name: 'Doomed' });

        const res = await adminClient.mutation('groups.deleteGroup', { id }, { tenantId });

        expect(res.status).toBe(200);
        expect(res.json.result.data).toBeUndefined();
      });

      it('should answer groups.addUserToGroup with no data', async () => {
        const groupId = uuidv7();
        await services.withOrigin(origin).groups.createGroup({ id: groupId, name: 'Team' });

        const res = await adminClient.mutation('groups.addUserToGroup', { groupId, userId: memberUserId }, { tenantId });

        expect(res.status).toBe(200);
        expect(res.json.result.data).toBeUndefined();
      });

      it('should answer roles.updateRole with no data', async () => {
        const id = uuidv7();
        await services.withOrigin(origin).roles.createRole({ id, name: 'Before' });

        const res = await adminClient.mutation('roles.updateRole', { id, name: 'After' }, { tenantId });

        expect(res.status).toBe(200);
        expect(res.json.result.data).toBeUndefined();
      });

      it('should answer roles.deleteRole with no data', async () => {
        const id = uuidv7();
        await services.withOrigin(origin).roles.createRole({ id, name: 'Doomed' });

        const res = await adminClient.mutation('roles.deleteRole', { id }, { tenantId });

        expect(res.status).toBe(200);
        expect(res.json.result.data).toBeUndefined();
      });

      it('should answer serviceAccounts.revokeToken with no data', async () => {
        const serviceAccountId = uuidv7();
        await services.withOrigin(origin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Robot' });
        await adminClient.mutation('serviceAccounts.generateToken', { serviceAccountId, name: 'Token' }, { tenantId });
        const tokens = await adminClient.query('serviceAccounts.listTokens', { serviceAccountId }, { tenantId });

        const res = await adminClient.mutation('serviceAccounts.revokeToken', { tokenId: tokens.json.result.data[0].id }, { tenantId });

        expect(res.status).toBe(200);
        expect(res.json.result.data).toBeUndefined();
      });
    });
  });
});
