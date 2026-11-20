import type { EventOrigin } from '@app/module';
import { jobs as jobsTable } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

describe('jobs payload-hash dedup', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('returns the same jobId for two enqueues with equivalent payloads', async () => {
    const first = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { a: 1, b: 'x' },
    });
    const second = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { a: 1, b: 'x' },
    });

    expect(second.alreadyExisted).toBe(true);
    expect(second.jobId).toBe(first.jobId);
  });

  it('canonicalises keys: payload key order does not break the dedup', async () => {
    const first = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { a: 1, b: 'x', nested: { p: 1, q: 2 } },
    });
    const second = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { nested: { q: 2, p: 1 }, b: 'x', a: 1 },
    });

    expect(second.alreadyExisted).toBe(true);
    expect(second.jobId).toBe(first.jobId);
  });

  it('different payloads produce different jobs', async () => {
    const a = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { x: 1 },
    });
    const b = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { x: 2 },
    });

    expect(a.jobId).not.toBe(b.jobId);
  });

  // A burst folds into the row already holding the key: the queue records the debt on the
  // survivor rather than a row per ask, and the run that answers it is booked when this one ends.
  it('folds a burst into the queued run and marks it as owing an answer', async () => {
    const first = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { burst: true },
      triggeredBy: 'user',
      triggeredById: 'user-1',
    });
    const second = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { burst: true },
      triggeredBy: 'event',
    });
    const third = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { burst: true },
      triggeredBy: 'scheduler',
    });

    expect(second.jobId).toBe(first.jobId);
    expect(third.jobId).toBe(first.jobId);

    const rows = await db.select().from(jobsTable).where(eq(jobsTable.tenantId, tenantId));
    expect(rows).toHaveLength(1);

    const survivor = rows[0];
    expect(survivor?.id).toBe(first.jobId);
    expect(survivor?.status).toBe('queued');
    // The asker of record stays the first one: the fold keeps no asker of its own.
    expect(survivor?.triggeredBy).toBe('user');
  });

  it('scoped to (kind, tenant, payload) — same payload across kinds does not dedup', async () => {
    const a = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'kind-a',
      tenantId,
      payload: { x: 1 },
    });
    const b = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'kind-b',
      tenantId,
      payload: { x: 1 },
    });

    expect(a.jobId).not.toBe(b.jobId);
    expect(b.alreadyExisted).toBe(false);
  });
});
