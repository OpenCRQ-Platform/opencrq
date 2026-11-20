import type { EventOrigin } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const KIND = 'noop';

describe('jobs recent scheduled bookings', () => {
  let tenantId: string;
  let otherTenantId: string;

  const jobs = () => services.withOrigin(SYSTEM_ORIGIN).jobs;

  const list = (forTenantId: string = tenantId, kind: string = KIND, limit: number = 5) =>
    jobs().listRecentScheduledBookings(forTenantId, kind, limit);

  const book = (payload: Record<string, unknown>, forTenantId: string = tenantId, kind: string = KIND) =>
    jobs().enqueueJob({ kind, tenantId: forTenantId, payload, triggeredBy: 'scheduler' });

  beforeEach(async () => {
    await truncateAllTables(db);
    const admin = await createTenantWithAdmin(services);
    tenantId = admin.tenantId;
    otherTenantId = await createTenant(services, admin.userId);
  });

  it('returns nothing when the scheduler never booked', async () => {
    expect(await list()).toEqual([]);
  });

  it('carries no finish time while a booking is still standing', async () => {
    await book({ date: '2026-09-04' });

    expect(await list()).toEqual([{ status: 'queued', finishedAt: null }]);
  });

  it('carries the finish time of a booking that ended, which the active-only lookups no longer see', async () => {
    const booking = await book({ date: '2026-09-04' });
    await jobs().claimNext('w1', [KIND], 30_000);
    await jobs().recordSuccess(booking.jobId, 'w1');

    const [row] = await list();
    expect(row?.status).toBe('succeeded');
    expect(row?.finishedAt).toBeInstanceOf(Date);
  });

  it('leaves out what the scheduler did not book', async () => {
    await jobs().enqueueJob({ kind: KIND, tenantId, payload: {}, interactive: true });

    expect(await list()).toEqual([]);
  });

  it('leaves out another kind and another tenant', async () => {
    await book({ date: '2026-09-04' }, tenantId, 'other-kind');
    await book({ date: '2026-09-04' }, otherTenantId);

    expect(await list()).toEqual([]);
  });

  // `jobs_scheduler_idx` is partial on `triggered_by`, not on `status`, so a scheduler booking the
  // queue absorbs is served by the same index. Without the exclusion, the scheduler would read its
  // own absorbed ask as an ended, non-succeeded booking and believe the day needs a retry.
  it('leaves out a scheduler booking the queue absorbed into an earlier one', async () => {
    const first = await book({ date: '2026-09-04' });
    const second = await book({ date: '2026-09-04' });

    expect(second.jobId).toBe(first.jobId);
    expect(second.alreadyExisted).toBe(true);
    expect(await list()).toEqual([{ status: 'queued', finishedAt: null }]);
  });

  it('hands the newest booking back first, and no more than the limit', async () => {
    const first = await book({ date: '2026-09-02' });
    await jobs().claimNext('w1', [KIND], 30_000);
    await jobs().recordFailure(first.jobId, 'w1', { message: 'boom' }, false, () => 0);
    await book({ date: '2026-09-03' });

    expect((await list()).map((row) => row.status)).toEqual(['queued', 'dlq']);
    expect(await list(tenantId, KIND, 1)).toHaveLength(1);
    expect((await list(tenantId, KIND, 1))[0]?.status).toBe('queued');
  });
});
