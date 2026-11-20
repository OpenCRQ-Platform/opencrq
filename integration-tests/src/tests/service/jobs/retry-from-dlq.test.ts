import type { EventOrigin } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const IMMEDIATE = () => 0;

const sendToDlq = async (tenantId: string): Promise<string> => {
  const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
    kind: 'noop',
    tenantId,
    payload: {},
    maxAttempts: 1,
  });
  await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
  await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
    jobId,
    'w1',
    { message: 'planted in dlq' },
    true,
    IMMEDIATE,
  );
  return jobId;
};

describe('jobs retry from DLQ', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('retryFromDlq re-queues a DLQed job and resets attempt to 0', async () => {
    const jobId = await sendToDlq(tenantId);
    let job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('dlq');
    expect(job?.attempt).toBe(1);

    await services.withOrigin(SYSTEM_ORIGIN).jobs.retryFromDlq(jobId);

    job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('queued');
    expect(job?.attempt).toBe(0);
    expect(job?.errorMessage).toBeNull();
    expect(job?.finishedAt).toBeNull();
    expect(job?.claimedBy).toBeNull();
  });

  it('throws when called on a non-DLQ job', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });

    await expect(
      services.withOrigin(SYSTEM_ORIGIN).jobs.retryFromDlq(jobId),
    ).rejects.toThrow();
  });

  it('a retried DLQ job can be claimed again', async () => {
    const jobId = await sendToDlq(tenantId);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.retryFromDlq(jobId);

    const claimed = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w2', ['noop'], 30_000);
    expect(claimed?.id).toBe(jobId);
    expect(claimed?.attempt).toBe(1);
  });
});
