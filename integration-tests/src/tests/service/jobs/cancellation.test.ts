import type { EventOrigin } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

describe('jobs cancellation', () => {
  let tenantId: string;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  it('cancelJob on a queued job marks it cancelled immediately', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });

    await services.withOrigin(SYSTEM_ORIGIN).jobs.cancelJob(jobId);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('cancelled');
    expect(job?.finishedAt).toBeInstanceOf(Date);
  });

  it('cancelJob on a running job sets abort_requested_at but keeps status running', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    await services.withOrigin(SYSTEM_ORIGIN).jobs.cancelJob(jobId);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.abortRequestedAt).toBeInstanceOf(Date);
  });

  it('isAbortRequested reflects the abort_requested_at state', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    expect(await services.withOrigin(SYSTEM_ORIGIN).jobs.isAbortRequested(jobId)).toBe(false);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.cancelJob(jobId);
    expect(await services.withOrigin(SYSTEM_ORIGIN).jobs.isAbortRequested(jobId)).toBe(true);
  });

  it('recordCancelled finalises a running job to cancelled', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.recordCancelled(jobId, 'w1');

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('cancelled');
  });

  it('cancelJob on a finished job is a no-op', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.recordSuccess(jobId, 'w1');

    await services.withOrigin(SYSTEM_ORIGIN).jobs.cancelJob(jobId);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('succeeded');
  });

  describe('tenant isolation', () => {
    it('should not allow a client from tenant B to cancel a queued job in tenant A', async () => {
      const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
        kind: 'noop',
        tenantId,
        payload: {},
      });

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      await services.withOrigin(tenantBOrigin).jobs.cancelJob(jobId);

      const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
      expect(job?.status).toBe('queued');
    });

    it('should not allow a client from tenant B to request abort on a running job in tenant A', async () => {
      const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
        kind: 'noop',
        tenantId,
        payload: {},
      });
      await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      await services.withOrigin(tenantBOrigin).jobs.cancelJob(jobId);

      const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
      expect(job?.status).toBe('running');
      expect(job?.abortRequestedAt).toBeNull();
    });

    it('should allow a client from the same tenant to cancel a queued job', async () => {
      const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
        kind: 'noop',
        tenantId,
        payload: {},
      });

      const tenantAOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId };

      await services.withOrigin(tenantAOrigin).jobs.cancelJob(jobId);

      const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
      expect(job?.status).toBe('cancelled');
    });
  });
});
