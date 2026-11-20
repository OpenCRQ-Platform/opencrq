import type { EventOrigin } from '@app/module';
import { jobs as jobsTable, jobSchedules } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConnectorsCredentials } from '../../../../back/src/features/app-router/connectors/connector-configuration';
import type { ConnectorScheduleDeps } from '../../../../back/src/features/job-scheduler/connector-schedule';
import { resolveRunnableConnectors } from '../../../../back/src/features/app-router/connectors/connector-configuration';
import { runDueConnectorSchedules } from '../../../../back/src/features/job-scheduler/connector-schedule';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const KIND = 'microsoft-graph-sync';
const EVERY_6_HOURS = { cadence: 'every_6_hours', atMinute: null, weekday: null, timeZone: null } as const;

const system = () => services.withOrigin(SYSTEM_ORIGIN);

const listJobs = (tenantId: string) => db.select().from(jobsTable).where(eq(jobsTable.tenantId, tenantId));

const scheduleRow = async (tenantId: string) =>
  (await db.select().from(jobSchedules).where(eq(jobSchedules.tenantId, tenantId))).find((row) => row.kind === KIND);

describe('connector schedule against the queue', () => {
  let tenantId: string;
  let adminOrigin: EventOrigin;
  let serviceAccountId: string;
  let credentials: ConnectorsCredentials;
  let nowMs: number;
  let deps: ConnectorScheduleDeps;

  const tick = () => runDueConnectorSchedules(tenantId, deps);

  const saveEvery6Hours = () => services.withOrigin(adminOrigin).jobSchedules.saveSchedule(tenantId, KIND, EVERY_6_HOURS, nowMs);

  beforeEach(async () => {
    await truncateAllTables(db);
    const admin = await createTenantWithAdmin(services);
    tenantId = admin.tenantId;
    adminOrigin = admin.origin;
    serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Defender Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
    credentials = { microsoft_graph: { [tenantId]: { client_id: 'id' } } };
    nowMs = Date.parse('2026-10-02T14:00:00Z');
    deps = {
      listConnectors: async (forTenantId) => resolveRunnableConnectors(
        credentials,
        forTenantId,
        await system().integrationSettings.getTenantIntegrationSettings(forTenantId),
        { enabled: false, loaded: false },
      ),
      schedules: system().jobSchedules,
      jobs: system().jobs,
      now: () => nowMs,
    };
  });

  it('puts a configured connector with no schedule saved on its own default, from its next slot', async () => {
    await tick();

    const row = await scheduleRow(tenantId);
    expect(row).toMatchObject({ cadence: 'every_6_hours', atMinute: null, weekday: null, timeZone: null });
    expect(row?.nextRunAt?.toISOString()).toBe('2026-10-02T18:00:00.000Z');
    expect(await listJobs(tenantId)).toHaveLength(0);
  });

  it('runs a due occurrence once, as the bound service account, recorded as the scheduler', async () => {
    await saveEvery6Hours();
    nowMs = Date.parse('2026-10-02T18:00:30Z');

    const reports = await tick();
    nowMs = Date.parse('2026-10-02T18:01:30Z');
    await tick();

    expect(reports.map(({ outcome }) => outcome)).toEqual(['enqueued']);
    const rows = await listJobs(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: KIND, triggeredBy: 'scheduler', payload: { serviceAccountId }, interactive: false });
    expect((await scheduleRow(tenantId))?.nextRunAt?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('serves an occurrence once when several processes tick at the same instant', async () => {
    await saveEvery6Hours();
    nowMs = Date.parse('2026-10-02T18:00:30Z');

    const reports = (await Promise.all([tick(), tick(), tick()])).flat();

    expect(reports.filter(({ outcome }) => outcome === 'enqueued')).toHaveLength(1);
    expect(await listJobs(tenantId)).toHaveLength(1);
  });

  it('skips an occurrence while a run of the connector is in flight, and moves to the following slot', async () => {
    await saveEvery6Hours();
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: { serviceAccountId }, triggeredBy: 'user' });
    nowMs = Date.parse('2026-10-02T18:00:30Z');

    const reports = await tick();

    expect(reports.map(({ outcome }) => outcome)).toEqual(['skipped_active']);
    const rows = await listJobs(tenantId);
    expect(rows.map((row) => row.triggeredBy)).toEqual(['user']);
    expect(rows[0]?.absorbedAsk).toBe(false);
    expect((await scheduleRow(tenantId))?.nextRunAt?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('marks a member\'s run the skipped occurrence is owed to, so their cancel cannot drop it', async () => {
    await saveEvery6Hours();
    const manual = await system().jobs.enqueueJob({
      kind: KIND, tenantId, payload: { serviceAccountId }, triggeredBy: 'user', triggeredById: 'member-1',
    });
    nowMs = Date.parse('2026-10-02T18:00:30Z');

    expect((await tick()).map(({ outcome }) => outcome)).toEqual(['skipped_active']);

    expect((await system().jobs.getJob(manual.jobId))?.askedByOthers).toBe(true);
    expect(await system().jobs.cancelJob(manual.jobId, { refuseIfShared: true })).toBe('shared');
  });

  it('books no run after a Sync now that starts between the active check and the enqueue', async () => {
    await saveEvery6Hours();
    const manual = await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: { serviceAccountId }, triggeredBy: 'user' });
    await db.update(jobsTable).set({ status: 'running', startedAt: new Date() }).where(eq(jobsTable.id, manual.jobId));
    nowMs = Date.parse('2026-10-02T18:00:30Z');
    const raced: ConnectorScheduleDeps = {
      ...deps,
      jobs: {
        ...deps.jobs,
        askActiveRuns: () => Promise.resolve(false),
        enqueueJob: (options) => system().jobs.enqueueJob(options),
      },
    };

    const reports = await runDueConnectorSchedules(tenantId, raced);

    expect(reports.map(({ outcome }) => outcome)).toEqual(['skipped_active']);
    const rows = await listJobs(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.absorbedAsk).toBe(false);
    expect(rows[0]?.askedByOthers).toBe(true);
  });

  it('hands an occurrence back when its enqueue fails, so the next tick serves it', async () => {
    await saveEvery6Hours();
    nowMs = Date.parse('2026-10-02T18:00:30Z');
    const failing: ConnectorScheduleDeps = {
      ...deps,
      jobs: {
        ...deps.jobs,
        askActiveRuns: (forTenantId, kind, asker) => system().jobs.askActiveRuns(forTenantId, kind, asker),
        enqueueJob: () => Promise.reject(new Error('queue unavailable')),
      },
    };

    expect((await runDueConnectorSchedules(tenantId, failing)).map(({ outcome }) => outcome)).toEqual(['failed']);
    expect((await scheduleRow(tenantId))?.nextRunAt?.toISOString()).toBe('2026-10-02T18:00:00.000Z');

    nowMs = Date.parse('2026-10-02T18:01:30Z');
    const reports = await tick();

    expect(reports.map(({ outcome }) => outcome)).toEqual(['enqueued']);
    expect(await listJobs(tenantId)).toHaveLength(1);
    expect((await scheduleRow(tenantId))?.nextRunAt?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('still serves the next connectors when one keeps failing', async () => {
    await saveEvery6Hours();
    nowMs = Date.parse('2026-10-02T18:00:30Z');
    const defender = (await deps.listConnectors(tenantId)).find(({ entry }) => entry.jobKind === KIND);
    if (!defender) {
      throw new Error('no connector configured');
    }
    const broken = { ...defender, entry: { ...defender.entry, jobKind: 'broken-sync' } };
    const withBroken: ConnectorScheduleDeps = {
      ...deps,
      listConnectors: () => Promise.resolve([broken, defender]),
      schedules: {
        ensureSchedule: (...args) => system().jobSchedules.ensureSchedule(...args),
        releaseOccurrence: (...args) => system().jobSchedules.releaseOccurrence(...args),
        getSchedules: async (forTenantId) => {
          const rows = await system().jobSchedules.getSchedules(forTenantId);
          return [...rows, ...rows.map((row) => ({ ...row, id: uuidv7(), kind: 'broken-sync' }))];
        },
        claimOccurrence: (row, claimNowMs) => (row.kind === KIND
          ? system().jobSchedules.claimOccurrence(row, claimNowMs)
          : Promise.reject(new Error('row refused'))),
      },
    };

    const reports = await runDueConnectorSchedules(tenantId, withBroken);

    expect(reports.map(({ kind, outcome }) => [kind, outcome])).toEqual([['broken-sync', 'failed'], [KIND, 'enqueued']]);
    expect(await listJobs(tenantId)).toHaveLength(1);
  });

  it('runs once after a long downtime, then waits for the first slot still ahead', async () => {
    await saveEvery6Hours();
    nowMs = Date.parse('2026-10-04T15:00:00Z');

    await tick();
    await tick();

    expect(await listJobs(tenantId)).toHaveLength(1);
    expect((await scheduleRow(tenantId))?.nextRunAt?.toISOString()).toBe('2026-10-04T18:00:00.000Z');
  });

  it('leaves the next run where it was when a run is started by hand', async () => {
    await saveEvery6Hours();
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: { serviceAccountId }, triggeredBy: 'user', interactive: true });
    nowMs = Date.parse('2026-10-02T14:01:00Z');

    await tick();

    expect(await listJobs(tenantId)).toHaveLength(1);
    expect((await scheduleRow(tenantId))?.nextRunAt?.toISOString()).toBe('2026-10-02T18:00:00.000Z');
  });

  it('never enqueues a connector whose service account is unbound', async () => {
    await saveEvery6Hours();
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', null);
    nowMs = Date.parse('2026-10-02T18:00:30Z');

    const reports = await tick();

    expect(reports.map(({ outcome }) => outcome)).toEqual(['skipped_unconfigured']);
    expect(await listJobs(tenantId)).toHaveLength(0);
    expect((await scheduleRow(tenantId))?.nextRunAt?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('never enqueues a connector the deployment holds no credentials for, nor gives it a default', async () => {
    credentials = {};
    await tick();
    expect(await scheduleRow(tenantId)).toBeUndefined();

    await saveEvery6Hours();
    nowMs = Date.parse('2026-10-02T18:00:30Z');
    await tick();

    expect(await listJobs(tenantId)).toHaveLength(0);
  });

  it('keeps a manual schedule out of every tick', async () => {
    await services.withOrigin(adminOrigin).jobSchedules.saveSchedule(tenantId, KIND, { cadence: 'manual', atMinute: null, weekday: null, timeZone: null }, nowMs);
    nowMs = Date.parse('2026-10-09T14:00:00Z');

    await tick();

    expect(await listJobs(tenantId)).toHaveLength(0);
    expect(await scheduleRow(tenantId)).toMatchObject({ cadence: 'manual', nextRunAt: null });
  });
});

describe('Default Threats first load against the queue', () => {
  const DEFAULT_THREATS_KIND = 'default-threats-sync';
  let tenantId: string;
  let nowMs: number;
  let loaded: boolean;
  let deps: ConnectorScheduleDeps;

  beforeEach(async () => {
    await truncateAllTables(db);
    ({ tenantId } = await createTenantWithAdmin(services));
    nowMs = Date.parse('2026-10-02T14:00:00Z');
    loaded = false;
    deps = {
      listConnectors: async (forTenantId) => resolveRunnableConnectors(
        undefined,
        forTenantId,
        await system().integrationSettings.getTenantIntegrationSettings(forTenantId),
        { enabled: true, loaded },
      ),
      schedules: system().jobSchedules,
      jobs: system().jobs,
      now: () => nowMs,
    };
  });

  const defaultThreatsJobs = async () => (await listJobs(tenantId)).filter((row) => row.kind === DEFAULT_THREATS_KIND);

  it('should load a tenant that never loaded at once, then follow the default schedule', async () => {
    await runDueConnectorSchedules(tenantId, deps);
    const whileRunning = await runDueConnectorSchedules(tenantId, deps);

    expect(whileRunning).toEqual([]);
    const rows = await defaultThreatsJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ triggeredBy: 'scheduler', payload: {}, interactive: false });
    const schedule = (await db.select().from(jobSchedules).where(eq(jobSchedules.tenantId, tenantId)))
      .find((row) => row.kind === DEFAULT_THREATS_KIND);
    expect(schedule?.nextRunAt?.toISOString()).toBe('2026-10-03T06:00:00.000Z');
  });

  it('should retry a first load that failed for good, once an hour, until the tenant has loaded', async () => {
    await runDueConnectorSchedules(tenantId, deps);
    const [failed] = await defaultThreatsJobs();
    await db.update(jobsTable).set({ status: 'dlq', startedAt: new Date(nowMs), finishedAt: new Date(nowMs) }).where(eq(jobsTable.id, failed?.id ?? ''));

    nowMs += 30 * 60 * 1000;
    await runDueConnectorSchedules(tenantId, deps);
    expect(await defaultThreatsJobs()).toHaveLength(1);

    nowMs += 31 * 60 * 1000;
    const reports = await runDueConnectorSchedules(tenantId, deps);
    expect(reports.map(({ outcome }) => outcome)).toEqual(['enqueued']);
    expect(await defaultThreatsJobs()).toHaveLength(2);

    loaded = true;
    await db.update(jobsTable).set({ status: 'succeeded', startedAt: new Date(nowMs), finishedAt: new Date(nowMs) }).where(eq(jobsTable.status, 'queued'));
    nowMs += 2 * 60 * 60 * 1000;
    await runDueConnectorSchedules(tenantId, deps);
    expect(await defaultThreatsJobs()).toHaveLength(2);
  });

  it('should wait for the next slot on a tenant that already loaded', async () => {
    loaded = true;
    await runDueConnectorSchedules(tenantId, deps);

    expect(await defaultThreatsJobs()).toHaveLength(0);
  });
});
