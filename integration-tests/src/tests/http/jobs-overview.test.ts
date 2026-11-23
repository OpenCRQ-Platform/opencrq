import type { EventOrigin } from '@app/module';
import { Capability_ManageSecurity, JOB_CATALOGUE_ENTRIES } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createUser, grantCapability } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

describe('jobs overview (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;

  const system = () => services.withOrigin(SYSTEM_ORIGIN).jobs;
  const systemLogs = () => services.withOrigin(SYSTEM_ORIGIN).jobLogs;

  const runToDlq = async (kind: string, forTenantId: string) => {
    const { jobId } = await system().enqueueJob({ kind, tenantId: forTenantId, payload: {} });
    await system().claimNext(`worker-${jobId}`, [kind], 30_000);
    await system().recordFailure(jobId, `worker-${jobId}`, { message: 'boom' }, false, () => 0);
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

  it('lists the registered kinds and excludes noop', async () => {
    const res = await client.query('jobs.listJobKinds', undefined, { tenantId });

    expect(res.status).toBe(200);
    const kinds = res.json.result.data.map((entry: { kind: string }) => entry.kind);
    const expectedKinds = JOB_CATALOGUE_ENTRIES
      .map((entry) => entry.kind)
      .filter((kind) => kind !== 'noop')
      .sort((a, b) => a.localeCompare(b));
    expect(kinds).toEqual(expectedKinds);
  });

  it('reads a queued job as a queued kind, a running job as a running kind, and leaves the other kinds never ran', async () => {
    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    const { jobId: runningJobId } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: {} });
    await system().claimNext(`worker-${runningJobId}`, ['drata-sync'], 30_000);

    const res = await client.query('jobs.listJobKinds', undefined, { tenantId });

    const byKind = new Map(res.json.result.data.map((entry: { kind: string, health: string }) => [entry.kind, entry.health]));
    expect(byKind.get('cve-epss-sync')).toBe('queued');
    expect(byKind.get('drata-sync')).toBe('running');
    expect(byKind.get('crq-simulation')).toBe('never_ran');
  });

  it('does not read an absorbed ask as the active or the last run of a kind', async () => {
    const { jobId: queuedId } = await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });

    const res = await client.query('jobs.getJobKind', { kind: 'cve-epss-sync' }, { tenantId });

    expect(res.json.result.data.health).toBe('queued');
    expect(res.json.result.data.activeRun).toMatchObject({ id: queuedId, status: 'queued' });
    expect(res.json.result.data.lastRun).toBeNull();
  });

  it('reads a dlq run as failing and a cancelled run as healthy', async () => {
    await runToDlq('drata-sync', tenantId);
    const { jobId: cancelledId } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: {} });
    await system().cancelJob(cancelledId);

    const res = await client.query('jobs.listJobKinds', undefined, { tenantId });

    const byKind = new Map(res.json.result.data.map((entry: { kind: string, health: string }) => [entry.kind, entry.health]));
    expect(byKind.get('drata-sync')).toBe('failing');
    expect(byKind.get('crq-simulation')).toBe('healthy');
  });

  it('does not let a run on another tenant change the health read on this one', async () => {
    const otherTenantId = await createTenant(services, adminId);
    await runToDlq('cve-epss-sync', otherTenantId);

    const res = await client.query('jobs.listJobKinds', undefined, { tenantId });

    const byKind = new Map(res.json.result.data.map((entry: { kind: string, health: string }) => [entry.kind, entry.health]));
    expect(byKind.get('cve-epss-sync')).toBe('never_ran');
  });

  it('answers getJobKind with the same object listJobKinds gave for that kind, and refuses noop and unknown kinds', async () => {
    // Fails once, retries, then succeeds: the terminal run's attempt (2) proves the retry was consumed.
    const { jobId } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: {}, triggeredBy: 'user' });
    await system().claimNext('worker-1', ['drata-sync'], 30_000);
    await system().recordFailure(jobId, 'worker-1', { message: 'boom' }, true, () => 0);
    await system().claimNext('worker-1', ['drata-sync'], 30_000);
    await system().recordSuccess(jobId, 'worker-1');

    const listRes = await client.query('jobs.listJobKinds', undefined, { tenantId });
    const fromList = listRes.json.result.data.find((entry: { kind: string }) => entry.kind === 'drata-sync');
    expect(fromList.lastRun).toMatchObject({ status: 'succeeded', attempt: 2, maxAttempts: 3, triggeredBy: 'user' });

    const getRes = await client.query('jobs.getJobKind', { kind: 'drata-sync' }, { tenantId });
    expect(getRes.json.result.data).toEqual(fromList);

    const noopRes = await client.query('jobs.getJobKind', { kind: 'noop' }, { tenantId });
    expect(noopRes.json.error.data.code).toBe('BAD_REQUEST');

    const unknownRes = await client.query('jobs.getJobKind', { kind: 'not-a-real-kind' }, { tenantId });
    expect(unknownRes.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('refuses listRuns on an unknown kind instead of answering an empty list', async () => {
    const res = await client.query('jobs.listRuns', { kind: 'not-a-real-kind' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('returns a run projection and none of the stored row', async () => {
    const { jobId } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: {} });

    const res = await client.query('jobs.listRuns', { kind: 'drata-sync' }, { tenantId });

    expect(res.status).toBe(200);
    const history = res.json.result.data;
    expect(history.inProgressCount).toBe(1);
    expect(history.completedCount).toBe(0);
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
      'payload',
      'priority',
      'processedTotal',
      'runAfter',
      'startedAt',
      'status',
      'stepCounts',
      'triggeredBy',
      'triggeredById',
    ]);
    expect(history.inProgress[0]).toMatchObject({ id: jobId, kind: 'drata-sync', status: 'queued', errorCount: 0 });
  });

  it('refuses listRuns to a tenant member holding neither capability, the payload being handler-defined', async () => {
    await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: { secret: 'value' } });
    const regularUser = await createUser(db);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .tenants.addTenantUser(tenantId, regularUser.userId);

    client.clearCookies();
    await signInAs(client, regularUser.userId);

    const res = await client.query('jobs.listRuns', { kind: 'drata-sync' }, { tenantId });

    expect(res.json.error.data.code).toBe('FORBIDDEN');
  });

  it('refuses listAllRuns on kinds naming an unregistered kind', async () => {
    const res = await client.query('jobs.listAllRuns', { kinds: ['not-a-real-kind'] }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('lists runs across every kind, filters by kind, and paginates on a stable total', async () => {
    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
    await system().enqueueJob({ kind: 'cve-kev-sync', tenantId, payload: {} });
    const { jobId: drataJobId } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: {} });

    const all = await client.query('jobs.listAllRuns', {}, { tenantId });
    expect(all.status).toBe(200);
    expect(all.json.result.data.total).toBe(3);
    expect(all.json.result.data.items).toHaveLength(3);

    const filtered = await client.query('jobs.listAllRuns', { kinds: ['drata-sync'] }, { tenantId });
    expect(filtered.json.result.data.total).toBe(1);
    expect(filtered.json.result.data.items[0].id).toBe(drataJobId);

    const firstPage = await client.query('jobs.listAllRuns', { limit: 2, offset: 0 }, { tenantId });
    const secondPage = await client.query('jobs.listAllRuns', { limit: 2, offset: 2 }, { tenantId });
    expect(firstPage.json.result.data.total).toBe(3);
    expect(firstPage.json.result.data.items).toHaveLength(2);
    expect(secondPage.json.result.data.items).toHaveLength(1);
    const pagedIds = [...firstPage.json.result.data.items, ...secondPage.json.result.data.items]
      .map((item: { id: string }) => item.id);
    expect(new Set(pagedIds).size).toBe(3);
  });

  it('sorts runs by kind', async () => {
    await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: {} });
    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });

    const res = await client.query('jobs.listAllRuns', { sortBy: 'kind', sortDesc: false }, { tenantId });

    expect(res.json.result.data.items.map((item: { kind: string }) => item.kind)).toEqual(['cve-epss-sync', 'drata-sync']);
  });

  it('returns a run projection and none of the stored row, across kinds', async () => {
    const { jobId } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: {} });

    const res = await client.query('jobs.listAllRuns', {}, { tenantId });

    expect(res.status).toBe(200);
    const { items } = res.json.result.data;
    expect(Object.keys(items[0]).sort()).toEqual([
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
      'payload',
      'priority',
      'processedTotal',
      'runAfter',
      'startedAt',
      'status',
      'stepCounts',
      'triggeredBy',
      'triggeredById',
    ]);
    expect(items[0]).toMatchObject({ id: jobId, kind: 'drata-sync', status: 'queued', errorCount: 0 });
  });

  it('refuses listAllRuns to a tenant member holding neither capability, the payload being handler-defined', async () => {
    await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: { secret: 'value' } });
    const regularUser = await createUser(db);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .tenants.addTenantUser(tenantId, regularUser.userId);

    client.clearCookies();
    await signInAs(client, regularUser.userId);

    const res = await client.query('jobs.listAllRuns', {}, { tenantId });

    expect(res.json.error.data.code).toBe('FORBIDDEN');
  });

  it('still lists the kinds for that same member, the run metadata carrying nothing handler-defined', async () => {
    const regularUser = await createUser(db);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .tenants.addTenantUser(tenantId, regularUser.userId);

    client.clearCookies();
    await signInAs(client, regularUser.userId);

    const res = await client.query('jobs.listJobKinds', undefined, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.length).toBeGreaterThan(0);
  });

  it('refuses listLogs and listRunLogs to that same member, the lines carrying third-party messages', async () => {
    const { jobId } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: {} });
    const regularUser = await createUser(db);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .tenants.addTenantUser(tenantId, regularUser.userId);

    client.clearCookies();
    await signInAs(client, regularUser.userId);

    const kindLogs = await client.query('jobs.listLogs', { kind: 'crq-simulation' }, { tenantId });
    const runLogs = await client.query('jobs.listRunLogs', { id: jobId }, { tenantId });

    expect(kindLogs.json.error.data.code).toBe('FORBIDDEN');
    expect(runLogs.json.error.data.code).toBe('FORBIDDEN');
  });

  it('groups log lines by run and drops the runs with no line', async () => {
    const { jobId: withLines } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: { a: 1 } });
    await system().claimNext('worker-1', ['crq-simulation'], 30_000);
    const { jobId: withoutLines } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: { b: 2 } });
    await system().claimNext('worker-2', ['crq-simulation'], 30_000);
    await systemLogs().appendLines([
      {
        id: uuidv7(),
        tenantId,
        jobId: withLines,
        scopeId: withLines,
        scopeKind: 'crq-simulation',
        level: 'trace',
        message: 'Starting simulation',
        detail: null,
        occurredAt: new Date(),
      },
      {
        id: uuidv7(),
        tenantId,
        jobId: withLines,
        scopeId: withLines,
        scopeKind: 'crq-simulation',
        level: 'trace',
        message: 'Simulation complete',
        detail: null,
        occurredAt: new Date(),
      },
    ]);

    const res = await client.query('jobs.listLogs', { kind: 'crq-simulation' }, { tenantId });

    expect(res.status).toBe(200);
    const { groups } = res.json.result.data;
    expect(groups).toHaveLength(1);
    expect(groups[0].runId).toBe(withLines);
    expect(groups[0].lines.map((line: { message: string }) => line.message)).toEqual([
      'Starting simulation',
      'Simulation complete',
    ]);
    expect(groups.find((group: { runId: string }) => group.runId === withoutLines)).toBeUndefined();
  });

  it('reads one run\'s lines, and nothing for a run of another tenant', async () => {
    const { jobId: ownRun } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: { a: 1 } });
    await system().claimNext('worker-1', ['crq-simulation'], 30_000);
    const { jobId: siblingRun } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: { b: 2 } });
    await system().claimNext('worker-2', ['crq-simulation'], 30_000);
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other tenant' }, adminId);
    const { jobId: foreignRun } = await system().enqueueJob({ kind: 'crq-simulation', tenantId: otherTenantId, payload: {} });
    const line = (forTenantId: string, jobId: string, message: string) => ({
      id: uuidv7(),
      tenantId: forTenantId,
      jobId,
      scopeId: jobId,
      scopeKind: 'crq-simulation',
      level: 'trace' as const,
      message,
      detail: null,
      occurredAt: new Date(),
    });
    await systemLogs().appendLines([
      line(tenantId, ownRun, 'Own line'),
      line(tenantId, siblingRun, 'Sibling line'),
      line(otherTenantId, foreignRun, 'Foreign line'),
    ]);

    const own = await client.query('jobs.listRunLogs', { id: ownRun }, { tenantId });
    const foreign = await client.query('jobs.listRunLogs', { id: foreignRun }, { tenantId });

    expect(own.status).toBe(200);
    const { groups } = own.json.result.data;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ runId: ownRun, status: 'running' });
    expect(groups[0].lines.map((entry: { message: string }) => entry.message)).toEqual(['Own line']);
    expect(foreign.status).toBe(200);
    expect(foreign.json.result.data.groups).toEqual([]);
  });

  it('admits a tenant member holding MANAGE_SECURITY without platform access to the payload and log reads', async () => {
    const { jobId } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: {} });
    const securityManager = await createUser(db);
    const adminOrigin: EventOrigin = { type: 'client', userId: adminId, tenantId };
    await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, securityManager.userId);
    await grantCapability(services, adminOrigin, securityManager.userId, Capability_ManageSecurity);

    client.clearCookies();
    await signInAs(client, securityManager.userId);

    const runs = await client.query('jobs.listAllRuns', {}, { tenantId });
    const run = await client.query('jobs.getRun', { id: jobId }, { tenantId });
    const runLogs = await client.query('jobs.listRunLogs', { id: jobId }, { tenantId });

    expect(runs.status).toBe(200);
    expect(runs.json.result.data.total).toBe(1);
    expect(run.status).toBe(200);
    expect(run.json.result.data).toMatchObject({ id: jobId });
    expect(runLogs.status).toBe(200);
  });

  it('refuses a run\'s errors to a member holding neither capability, except a connector run\'s', async () => {
    const simulationRun = await runToDlq('crq-simulation', tenantId);
    const connectorRun = await runToDlq('drata-sync', tenantId);
    const regularUser = await createUser(db);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .tenants.addTenantUser(tenantId, regularUser.userId);

    client.clearCookies();
    await signInAs(client, regularUser.userId);

    const simulationErrors = await client.query('jobs.listJobErrors', { id: simulationRun }, { tenantId });
    const connectorErrors = await client.query('jobs.listJobErrors', { id: connectorRun }, { tenantId });

    expect(simulationErrors.json.error.data.code).toBe('FORBIDDEN');
    expect(connectorErrors.status).toBe(200);
    expect(connectorErrors.json.result.data.map((error: { message: string }) => error.message)).toEqual(['boom']);
  });

  it('searches runs on their error, never on their payload, and reads a wildcard literally', async () => {
    const failedRun = await runToDlq('crq-simulation', tenantId);
    await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: { apiKey: 'sk-abcdef' } });

    const byError = await client.query('jobs.listAllRuns', { search: 'boom' }, { tenantId });
    const byPayload = await client.query('jobs.listAllRuns', { search: 'sk-a' }, { tenantId });
    const byWildcard = await client.query('jobs.listAllRuns', { search: '_' }, { tenantId });

    expect(byError.json.result.data.items.map((item: { id: string }) => item.id)).toEqual([failedRun]);
    expect(byPayload.json.result.data.total).toBe(0);
    expect(byWildcard.json.result.data.total).toBe(0);
  });

  it('searches runs across accents and ligatures in both directions', async () => {
    const { jobId } = await system().enqueueJob({ kind: 'crq-simulation', tenantId, payload: {} });
    await system().claimNext(`worker-${jobId}`, ['crq-simulation'], 30_000);
    await system().recordFailure(jobId, `worker-${jobId}`, { message: 'École Straße' }, false, () => 0);
    const failedRun = await runToDlq('drata-sync', tenantId);

    const ids = async (search: string) =>
      (await client.query('jobs.listAllRuns', { search }, { tenantId })).json.result.data.items.map((item: { id: string }) => item.id);

    expect(await ids('ecole')).toEqual([jobId]);
    expect(await ids('strasse')).toEqual([jobId]);
    expect(await ids('bóom')).toEqual([failedRun]);
  });

  it('filters runs by who triggered them', async () => {
    const { jobId: userRun } = await system().enqueueJob({ kind: 'drata-sync', tenantId, payload: {}, triggeredBy: 'user' });
    await system().enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {}, triggeredBy: 'scheduler' });

    const res = await client.query('jobs.listAllRuns', { triggeredBy: ['user'] }, { tenantId });

    expect(res.json.result.data.items.map((item: { id: string }) => item.id)).toEqual([userRun]);
  });
});
