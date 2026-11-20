import type { EventOrigin } from '@app/module';
import { Capability_ManageSecurity, originTrigger } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createUser, grantCapability } from '../../helpers/factories';
import { createServiceAccountClient } from '../../helpers/service-account-client';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

describe('jobs cancel and retry control (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;
  let adminOrigin: EventOrigin;

  const system = () => services.withOrigin(SYSTEM_ORIGIN).jobs;

  /** Books a job as `origin` would, the way an enqueue site does. */
  const enqueueAs = async (origin: EventOrigin, forTenantId: string, nonce: string) => {
    const { jobId } = await system().enqueueJob({
      kind: 'cve-epss-sync', tenantId: forTenantId, payload: { nonce }, ...originTrigger(origin),
    });
    return jobId;
  };

  const toDlqAs = async (origin: EventOrigin, forTenantId: string, nonce: string) => {
    const jobId = await enqueueAs(origin, forTenantId, nonce);
    await system().claimNext(`worker-${jobId}`, ['cve-epss-sync'], 30_000);
    await system().recordFailure(jobId, `worker-${jobId}`, { message: 'boom' }, false, () => 0);
    return jobId;
  };

  const statusOf = async (jobId: string) => (await system().getJob(jobId))?.status;

  const addMember = async () => {
    const member = await createUser(db);
    await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, member.userId);
    const origin: EventOrigin = { type: 'client', userId: member.userId, tenantId };
    return { ...member, origin };
  };

  const signInAsMember = async (userId: string) => {
    client.clearCookies();
    await signInAs(client, userId);
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: 'admin@test.com' });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    adminOrigin = { type: 'client', userId: adminId, tenantId };
  });

  describe('a member holding neither capability', () => {
    it('should refuse to cancel another member\'s job and leave it queued', async () => {
      const owner = await addMember();
      const caller = await addMember();
      const jobId = await enqueueAs(owner.origin, tenantId, 'a');
      await signInAsMember(caller.userId);

      const res = await client.mutation('jobs.cancelJob', { id: jobId }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
      expect(await statusOf(jobId)).toBe('queued');
    });

    it('should refuse to retry another member\'s job and leave it in the dead-letter queue', async () => {
      const owner = await addMember();
      const caller = await addMember();
      const jobId = await toDlqAs(owner.origin, tenantId, 'a');
      await signInAsMember(caller.userId);

      const res = await client.mutation('jobs.retryFromDlq', { id: jobId }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
      expect(await statusOf(jobId)).toBe('dlq');
    });

    it('should cancel the job it started', async () => {
      const caller = await addMember();
      const jobId = await enqueueAs(caller.origin, tenantId, 'a');
      await signInAsMember(caller.userId);

      const res = await client.mutation('jobs.cancelJob', { id: jobId }, { tenantId });

      expect(res.json.result.data).toEqual({ cancelled: true });
      expect(await statusOf(jobId)).toBe('cancelled');
    });

    it('should retry the dead-letter job it started', async () => {
      const caller = await addMember();
      const jobId = await toDlqAs(caller.origin, tenantId, 'a');
      await signInAsMember(caller.userId);

      const res = await client.mutation('jobs.retryFromDlq', { id: jobId }, { tenantId });

      expect(res.json.result.data).toEqual({ retried: true });
      expect(await statusOf(jobId)).toBe('queued');
    });

    it('should refuse a scheduled run', async () => {
      const caller = await addMember();
      const { jobId } = await system().enqueueJob({
        kind: 'cve-epss-sync', tenantId, payload: {}, triggeredBy: 'scheduler',
      });
      await signInAsMember(caller.userId);

      const res = await client.mutation('jobs.cancelJob', { id: jobId }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
      expect(await statusOf(jobId)).toBe('queued');
    });

    it('should refuse an unknown id', async () => {
      const caller = await addMember();
      await signInAsMember(caller.userId);

      const cancel = await client.mutation('jobs.cancelJob', { id: uuidv7() }, { tenantId });
      const retry = await client.mutation('jobs.retryFromDlq', { id: uuidv7() }, { tenantId });

      expect(cancel.json.error.data.code).toBe('FORBIDDEN');
      expect(retry.json.error.data.code).toBe('FORBIDDEN');
    });

    it('should refuse a job of another tenant, even one booked under its own user id', async () => {
      const caller = await addMember();
      const otherTenantId = await createTenant(services, adminId);
      const foreignJobId = await enqueueAs(caller.origin, otherTenantId, 'a');
      await signInAsMember(caller.userId);

      const res = await client.mutation('jobs.cancelJob', { id: foreignJobId }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
      expect(await statusOf(foreignJobId)).toBe('queued');
    });
  });

  describe('a run another asker folded into', () => {
    const bookKeyed = (origin: EventOrigin) => system().enqueueJob({
      kind: 'cve-epss-sync', tenantId, payload: { nonce: 'shared' }, idempotencyKey: 'shared-key', ...originTrigger(origin),
    });

    it('should refuse both askers a cancel, and let a MANAGE_SECURITY member cancel it', async () => {
      const first = await addMember();
      const second = await addMember();
      const manager = await addMember();
      await grantCapability(services, adminOrigin, manager.userId, Capability_ManageSecurity);
      const { jobId } = await bookKeyed(first.origin);
      const folded = await bookKeyed(second.origin);
      expect(folded.jobId).toBe(jobId);

      await signInAsMember(second.userId);
      const bySecond = await client.mutation('jobs.cancelJob', { id: jobId }, { tenantId });
      await signInAsMember(first.userId);
      const byFirst = await client.mutation('jobs.cancelJob', { id: jobId }, { tenantId });

      expect(bySecond.json.error.data.code).toBe('FORBIDDEN');
      expect(byFirst.json.error.data.code).toBe('FORBIDDEN');
      expect(await statusOf(jobId)).toBe('queued');

      await signInAsMember(manager.userId);
      const byManager = await client.mutation('jobs.cancelJob', { id: jobId }, { tenantId });

      expect(byManager.json.result.data).toEqual({ cancelled: true });
      expect(await statusOf(jobId)).toBe('cancelled');
    });
  });

  describe('a member holding MANAGE_SECURITY', () => {
    it('should cancel and retry another member\'s jobs', async () => {
      const owner = await addMember();
      const manager = await addMember();
      await grantCapability(services, adminOrigin, manager.userId, Capability_ManageSecurity);
      const dlqId = await toDlqAs(owner.origin, tenantId, 'a');
      const queuedId = await enqueueAs(owner.origin, tenantId, 'b');
      await signInAsMember(manager.userId);

      const cancel = await client.mutation('jobs.cancelJob', { id: queuedId }, { tenantId });
      const retry = await client.mutation('jobs.retryFromDlq', { id: dlqId }, { tenantId });

      expect(cancel.json.result.data).toEqual({ cancelled: true });
      expect(retry.json.result.data).toEqual({ retried: true });
      expect(await statusOf(queuedId)).toBe('cancelled');
      expect(await statusOf(dlqId)).toBe('queued');
    });
  });

  describe('a service account without MANAGE_SECURITY', () => {
    it('should cancel the job it started and refuse a member\'s', async () => {
      const owner = await addMember();
      const serviceAccount = await createServiceAccountClient(await getTestServer(), services, adminOrigin);
      const ownId = await enqueueAs({ type: 'connector', serviceAccountId: serviceAccount.serviceAccountId, tenantId }, tenantId, 'a');
      const memberJobId = await enqueueAs(owner.origin, tenantId, 'b');

      const own = await serviceAccount.mutation('jobs.cancelJob', { id: ownId });
      const foreign = await serviceAccount.mutation('jobs.cancelJob', { id: memberJobId });

      expect(own.json.result.data).toEqual({ cancelled: true });
      expect(await statusOf(ownId)).toBe('cancelled');
      expect(foreign.json.error.data.code).toBe('FORBIDDEN');
      expect(await statusOf(memberJobId)).toBe('queued');
    });
  });
});
