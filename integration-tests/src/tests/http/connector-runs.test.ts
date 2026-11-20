import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

describe('connector runs (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;

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

  it('returns a run projection and none of the stored row', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'drata-sync',
      tenantId,
      payload: { serviceAccountId: uuidv7() },
      idempotencyKey: `${tenantId}:drata-sync-test`,
    });

    const res = await client.query('connectors.listRuns', { source: 'drata' }, { tenantId });

    expect(res.status).toBe(200);
    const history = res.json.result.data;
    expect(history.inProgressCount).toBe(1);
    expect(history.completedCount).toBe(0);
    expect(history.inProgress).toHaveLength(1);
    expect(Object.keys(history.inProgress[0]).sort()).toEqual([
      'absorbedAsk',
      'attempt',
      'claimedAt',
      'currentStep',
      'enqueuedAt',
      'errorCount',
      'expectedTotal',
      'finishedAt',
      'heartbeatAt',
      'id',
      'interactive',
      'kind',
      'lastError',
      'leaseExpiresAt',
      'maxAttempts',
      'priority',
      'processedTotal',
      'runAfter',
      'startedAt',
      'status',
      'triggeredBy',
      'triggeredById',
    ]);
    expect(history.inProgress[0]).not.toHaveProperty('payload');
    expect(history.inProgress[0]).toMatchObject({ id: jobId, kind: 'drata-sync', status: 'queued', errorCount: 0 });
  });

  it('should answer a run id with its status, its claim and enqueue instants, and nothing of the stored row', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'drata-sync',
      tenantId,
      payload: { serviceAccountId: uuidv7() },
    });

    const res = await client.query('jobs.getJob', { id: jobId }, { tenantId });

    expect(res.status).toBe(200);
    expect(Object.keys(res.json.result.data).sort()).toEqual(['enqueuedAt', 'id', 'startedAt', 'status']);
    expect(res.json.result.data).toMatchObject({ id: jobId, status: 'queued', startedAt: null });
  });

  it('refuses the connector that produces no runs', async () => {
    const res = await client.query('connectors.listRuns', { source: 'opencti' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('lists no run of another tenant', async () => {
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'drata-sync',
      tenantId: otherTenantId,
      payload: {},
    });

    const res = await client.query('connectors.listRuns', { source: 'drata' }, { tenantId });

    expect(res.json.result.data).toMatchObject({ inProgress: [], completed: [], inProgressCount: 0, completedCount: 0 });
  });
});
