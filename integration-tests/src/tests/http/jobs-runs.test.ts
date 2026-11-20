import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const QUEUE_PAGE = { page: 1, limit: 10 };
const EMPTY_QUEUE_INPUT = { pending: QUEUE_PAGE, running: QUEUE_PAGE, failed: QUEUE_PAGE, succeeded: QUEUE_PAGE };

/** The Date a caller reads back has already lost the column's sub-millisecond precision, so a
 * window ending exactly on it would exclude the row it names. */
const justAfter = (instant: Date): Date => new Date(instant.getTime() + 1);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

describe('jobs runs and queue (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;

  const system = () => services.withOrigin(SYSTEM_ORIGIN).jobs;

  const toDlq = async (kind: string, forTenantId: string, payload: Record<string, unknown> = {}) => {
    const { jobId } = await system().enqueueJob({ kind, tenantId: forTenantId, payload });
    await system().claimNext(`worker-${jobId}`, [kind], 30_000);
    await system().recordFailure(jobId, `worker-${jobId}`, { message: 'boom' }, false, () => 0);
    return jobId;
  };

  const toSucceeded = async (kind: string, forTenantId: string, payload: Record<string, unknown> = {}) => {
    const { jobId } = await system().enqueueJob({ kind, tenantId: forTenantId, payload });
    await system().claimNext(`worker-${jobId}`, [kind], 30_000);
    await system().recordSuccess(jobId, `worker-${jobId}`);
    return jobId;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
  });

  it('orders listAllRuns by enqueuedAt desc with no filter', async () => {
    const { jobId: firstId } = await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    await sleep(5);
    const { jobId: secondId } = await system().enqueueJob({ kind: 'cve-kev-sync', tenantId, payload: {} });
    await sleep(5);
    const { jobId: thirdId } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: {} });

    const res = await client.query('jobs.listAllRuns', {}, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.total).toBe(3);
    expect(res.json.result.data.items.map((item: { id: string }) => item.id)).toEqual([thirdId, secondId, firstId]);
  });

  it('filters listAllRuns by status', async () => {
    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    const dlqId = await toDlq('cve-kev-sync', tenantId);

    const res = await client.query('jobs.listAllRuns', { statuses: ['dlq'] }, { tenantId });

    expect(res.json.result.data.total).toBe(1);
    expect(res.json.result.data.items[0].id).toBe(dlqId);
  });

  it('windows listAllRuns on enqueuedAt', async () => {
    const { jobId: firstId } = await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    const first = await system().getJob(firstId);
    await sleep(5);
    const { jobId: secondId } = await system().enqueueJob({ kind: 'cve-kev-sync', tenantId, payload: {} });
    const second = await system().getJob(secondId);
    await sleep(5);
    await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: {} });

    const res = await client.query('jobs.listAllRuns', {
      enqueuedFrom: first!.enqueuedAt, enqueuedTo: justAfter(second!.enqueuedAt),
    }, { tenantId });

    expect(res.json.result.data.items.map((item: { id: string }) => item.id).sort()).toEqual([firstId, secondId].sort());
  });

  it('windows listAllRuns on startedAt', async () => {
    const { jobId: firstId } = await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: { n: 1 } });
    await system().claimNext(`worker-${firstId}`, ['cve-epss-sync'], 30_000);
    const first = await system().getJob(firstId);
    await sleep(5);
    const { jobId: secondId } = await system().enqueueJob({ kind: 'cve-kev-sync', tenantId, payload: { n: 2 } });
    await system().claimNext(`worker-${secondId}`, ['cve-kev-sync'], 30_000);
    const second = await system().getJob(secondId);
    await sleep(5);
    const { jobId: thirdId } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: { n: 3 } });
    await system().claimNext(`worker-${thirdId}`, ['drata-sync'], 30_000);

    const res = await client.query('jobs.listAllRuns', {
      startedFrom: first!.startedAt, startedTo: justAfter(second!.startedAt!),
    }, { tenantId });

    expect(res.json.result.data.items.map((item: { id: string }) => item.id).sort()).toEqual([firstId, secondId].sort());
  });

  it('windows listAllRuns on finishedAt', async () => {
    const firstId = await toSucceeded('cve-epss-sync', tenantId, { n: 1 });
    const first = await system().getJob(firstId);
    await sleep(5);
    const secondId = await toSucceeded('cve-kev-sync', tenantId, { n: 2 });
    const second = await system().getJob(secondId);
    await sleep(5);
    await toSucceeded('drata-sync', tenantId, { n: 3 });

    const res = await client.query('jobs.listAllRuns', {
      finishedFrom: first!.finishedAt, finishedTo: justAfter(second!.finishedAt!),
    }, { tenantId });

    expect(res.json.result.data.items.map((item: { id: string }) => item.id).sort()).toEqual([firstId, secondId].sort());
  });

  it('sorts listAllRuns by duration, an in-progress run landing last (NULLS LAST)', async () => {
    const longId = await toSucceeded('cve-epss-sync', tenantId, { n: 1 });
    await db.execute(sql`UPDATE jobs SET claimed_at = now() - interval '10 minutes', finished_at = now() - interval '5 minutes' WHERE id = ${longId}`);
    const shortId = await toSucceeded('cve-kev-sync', tenantId, { n: 2 });
    await db.execute(sql`UPDATE jobs SET claimed_at = now() - interval '2 minutes', finished_at = now() - interval '1 minute 59 seconds' WHERE id = ${shortId}`);
    const { jobId: runningId } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: { n: 3 } });
    await system().claimNext(`worker-${runningId}`, ['drata-sync'], 30_000);

    const res = await client.query('jobs.listAllRuns', { sortBy: 'duration', sortDesc: true }, { tenantId });

    expect(res.json.result.data.items.map((item: { id: string }) => item.id)).toEqual([longId, shortId, runningId]);
  });

  it('redacts a sensitive payload key on listAllRuns', async () => {
    await system().enqueueJob({
      kind: 'cve-epss-sync',
      tenantId,
      payload: { normal: 'visible-value', secret: 'super-secret-value' },
    });

    const res = await client.query('jobs.listAllRuns', {}, { tenantId });

    const { payload } = res.json.result.data.items[0];
    expect(payload).toContain('visible-value');
    expect(payload).toContain('[redacted]');
    expect(payload).not.toContain('super-secret-value');
  });

  it('isolates listAllRuns, listQueue and getRun by tenant', async () => {
    const otherTenantId = await createTenant(services, adminId);
    const { jobId: mineId } = await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    const { jobId: otherId } = await system().enqueueJob({ kind: 'cve-epss-sync', tenantId: otherTenantId, payload: {} });

    const allRuns = await client.query('jobs.listAllRuns', {}, { tenantId });
    expect(allRuns.json.result.data.total).toBe(1);
    expect(allRuns.json.result.data.items[0].id).toBe(mineId);

    const queue = await client.query('jobs.listQueue', EMPTY_QUEUE_INPUT, { tenantId });
    expect(queue.json.result.data.pending.total).toBe(1);
    expect(queue.json.result.data.pending.items[0].id).toBe(mineId);

    const mine = await client.query('jobs.getRun', { id: mineId }, { tenantId });
    expect(mine.json.result.data.id).toBe(mineId);

    const other = await client.query('jobs.getRun', { id: otherId }, { tenantId });
    expect(other.json.result.data).toBeNull();
  });

  it('refuses getRun to a tenant member holding neither capability, the payload being handler-defined', async () => {
    const { jobId } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: { secret: 'value' } });
    const regularUser = await createUser(db);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .tenants.addTenantUser(tenantId, regularUser.userId);

    client.clearCookies();
    await signInAs(client, regularUser.userId);

    const res = await client.query('jobs.getRun', { id: jobId }, { tenantId });

    expect(res.json.error.data.code).toBe('FORBIDDEN');
  });

  it('refuses listQueue to a tenant member holding neither capability, the payload being handler-defined', async () => {
    await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: { secret: 'value' } });
    const regularUser = await createUser(db);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .tenants.addTenantUser(tenantId, regularUser.userId);

    client.clearCookies();
    await signInAs(client, regularUser.userId);

    const res = await client.query('jobs.listQueue', EMPTY_QUEUE_INPUT, { tenantId });

    expect(res.json.error.data.code).toBe('FORBIDDEN');
  });

  it('marks a future run_after as waiting-for-schedule and a sibling of a live-leased run as blocked-by-sibling', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const { jobId: waitingId } = await system().enqueueJob({
      kind: 'cve-epss-sync', tenantId, payload: {}, runAfter: future,
    });
    const { jobId: runningId } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: { n: 1 } });
    await system().claimNext(`worker-${runningId}`, ['crq-simulation'], 30_000);
    const { jobId: blockedId } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: { n: 2 } });
    const { jobId: nextId } = await system().enqueueJob({ kind: 'cve-kev-sync', tenantId, payload: {} });

    const res = await client.query('jobs.listQueue', {
      ...EMPTY_QUEUE_INPUT,
      pending: { page: 1, limit: 10 },
    }, { tenantId });

    const claimabilityById = new Map(
      res.json.result.data.pending.items.map((item: { id: string, claimability: string }) => [item.id, item.claimability]),
    );
    expect(claimabilityById.get(waitingId)).toBe('waiting-for-schedule');
    expect(claimabilityById.get(blockedId)).toBe('blocked-by-sibling');
    expect(claimabilityById.get(nextId)).toBe('next');
  });

  it('no longer blocks a sibling once its lease has expired', async () => {
    const { jobId: runningId } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: { n: 1 } });
    await system().claimNext(`worker-${runningId}`, ['crq-simulation'], 30_000);
    await db.execute(sql`UPDATE jobs SET leased_until = now() - interval '1 minute' WHERE id = ${runningId}`);
    const { jobId: freedId } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: { n: 2 } });

    const res = await client.query('jobs.listQueue', EMPTY_QUEUE_INPUT, { tenantId });

    const freed = res.json.result.data.pending.items.find((item: { id: string }) => item.id === freedId);
    expect(freed.claimability).toBe('next');
  });

  it('folds a salve of identical asks into the one run already answering them', async () => {
    const { jobId } = await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    await system().claimNext(`worker-${jobId}`, ['cve-epss-sync'], 30_000);

    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });

    const listed = await client.query('jobs.listAllRuns', { kinds: ['cve-epss-sync'] }, { tenantId });
    expect(listed.json.result.data.total).toBe(1);
    expect(listed.json.result.data.items[0].id).toBe(jobId);

    const detail = await client.query('jobs.getRun', { id: jobId }, { tenantId });
    expect(detail.json.result.data.absorbedAsk).toBe(true);
    expect(detail.json.result.data.answeredById).toBeNull();
  });

  it('links the successor that answers an absorbed ask back to the run it absorbed it on', async () => {
    const { jobId } = await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    await system().claimNext(`worker-${jobId}`, ['cve-epss-sync'], 30_000);
    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });

    await system().recordSuccess(jobId, `worker-${jobId}`);

    const source = await client.query('jobs.getRun', { id: jobId }, { tenantId });
    expect(source.json.result.data.absorbedAsk).toBe(true);
    const { answeredById } = source.json.result.data;
    expect(answeredById).not.toBeNull();

    const successor = await client.query('jobs.getRun', { id: answeredById }, { tenantId });
    expect(successor.json.result.data).toMatchObject({
      triggeredBy: 'system',
      triggeredById: jobId,
      status: 'queued',
    });
  });
});
