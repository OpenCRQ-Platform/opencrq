import type { EventOrigin } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

describe('jobs lifecycle — happy path', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('enqueue → claim → recordSuccess', async () => {
    const enqueue = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { ping: 'pong' },
    });
    expect(enqueue.alreadyExisted).toBe(false);

    const claimed = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('worker-1', ['noop'], 30_000);
    expect(claimed).toBeDefined();
    expect(claimed?.id).toBe(enqueue.jobId);
    expect(claimed?.tenantId).toBe(tenantId);
    expect(claimed?.payload).toEqual({ ping: 'pong' });
    expect(claimed?.attempt).toBe(1);
    expect(claimed?.leasedUntil.getTime()).toBeGreaterThan(Date.now());

    await services.withOrigin(SYSTEM_ORIGIN).jobs.recordSuccess(enqueue.jobId, 'worker-1');

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(enqueue.jobId);
    expect(job?.status).toBe('succeeded');
    expect(job?.finishedAt).toBeInstanceOf(Date);
  });

  it('claimNext returns undefined when no jobs are queued', async () => {
    const claimed = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('worker-1', ['noop'], 30_000);
    expect(claimed).toBeUndefined();
  });

  it('claimNext filters by kind', async () => {
    await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'kind-a',
      tenantId,
      payload: {},
    });

    const wrongKind = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('worker-1', ['kind-b'], 30_000);
    expect(wrongKind).toBeUndefined();

    const rightKind = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('worker-1', ['kind-a'], 30_000);
    expect(rightKind).toBeDefined();
  });

  it('claimNext bumps attempt and sets started_at / leased_until / claimed_by', async () => {
    const enqueue = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });

    const beforeClaim = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(enqueue.jobId);
    expect(beforeClaim?.attempt).toBe(0);
    expect(beforeClaim?.startedAt).toBeNull();

    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('worker-x', ['noop'], 30_000);

    const afterClaim = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(enqueue.jobId);
    expect(afterClaim?.attempt).toBe(1);
    expect(afterClaim?.status).toBe('running');
    expect(afterClaim?.startedAt).toBeInstanceOf(Date);
    expect(afterClaim?.leasedUntil).toBeInstanceOf(Date);
    expect(afterClaim?.claimedBy).toBe('worker-x');
  });
});
