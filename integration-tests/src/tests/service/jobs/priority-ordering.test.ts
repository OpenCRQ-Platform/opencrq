import type { EventOrigin } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

describe('jobs priority + FIFO ordering', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('higher priority claims before lower priority', async () => {
    const lowJob = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { tag: 'low' },
      priority: 10,
    });
    // Spread run_after so a FIFO-only system would pick lowJob first.
    await new Promise((r) => setTimeout(r, 50));
    const highJob = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { tag: 'high' },
      priority: 90,
    });

    const claim = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    expect(claim?.id).toBe(highJob.jobId);

    const claim2 = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    expect(claim2?.id).toBe(lowJob.jobId);
  });

  it('equal priority falls back to FIFO by run_after', async () => {
    const first = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { tag: 'first' },
      priority: 50,
    });
    await new Promise((r) => setTimeout(r, 20));
    const second = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { tag: 'second' },
      priority: 50,
    });

    const a = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    const b = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    expect(a?.id).toBe(first.jobId);
    expect(b?.id).toBe(second.jobId);
  });

  it('jobs with run_after in the future are not claimed yet', async () => {
    await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      runAfter: new Date(Date.now() + 60_000),
    });

    const claim = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    expect(claim).toBeUndefined();
  });
});
