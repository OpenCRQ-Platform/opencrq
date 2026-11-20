import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { testConnectorsConfig } from '../../setup/mock';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('connector schedule (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());
    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    adminOrigin = { type: 'client', userId: adminId, tenantId };

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Defender Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
    testConnectorsConfig.microsoft_graph = { [tenantId]: { azure_tenant_id: 'a', client_id: 'b', client_secret: 'c' } };
  });

  afterEach(() => {
    delete testConnectorsConfig.microsoft_graph;
  });

  const getSchedule = async (source: string) => (await client.query('connectors.getSchedule', { source }, { tenantId })).json.result.data;

  it('should read a configured connector with no schedule saved on its own default, with a next run', async () => {
    const schedule = await getSchedule('microsoft_graph');

    expect(schedule).toMatchObject({ cadence: 'every_6_hours', atMinute: null, weekday: null, timeZone: null });
    expect(Date.parse(schedule.nextRunAt)).toBeGreaterThan(Date.now());
    expect(new Date(schedule.nextRunAt).getUTCHours() % 6).toBe(0);
  });

  it('should read no next run for a connector that cannot run', async () => {
    expect(await getSchedule('drata')).toMatchObject({ cadence: 'daily', atMinute: 6 * 60, timeZone: 'UTC', nextRunAt: null });
    expect(await getSchedule('opencti')).toBeNull();
  });

  it('should save a cadence and read back its next run', async () => {
    const saved = await client.mutation('connectors.setSchedule', { source: 'microsoft_graph', cadence: 'weekly', atMinute: 6 * 60, weekday: 1, timeZone: 'Asia/Tokyo' }, { tenantId });
    const schedule = await getSchedule('microsoft_graph');

    expect(saved.status).toBe(200);
    expect(schedule).toMatchObject({ cadence: 'weekly', atMinute: 6 * 60, weekday: 1, timeZone: 'Asia/Tokyo' });
    // Monday 06:00 in Tokyo is Sunday 21:00 UTC.
    const nextRun = new Date(schedule.nextRunAt);
    expect(nextRun.getUTCDay()).toBe(0);
    expect(nextRun.getUTCHours()).toBe(21);
  });

  it('should refuse a time zone it does not know', async () => {
    const refused = await client.mutation('connectors.setSchedule', { source: 'microsoft_graph', cadence: 'daily', atMinute: 60, weekday: null, timeZone: 'Mars/Olympus' }, { tenantId });

    expect(refused.status).toBe(400);
  });

  it('should offer no cadence under the connector minimum, and refuse one sent anyway', async () => {
    const nist = await getSchedule('nist');
    const refused = await client.mutation('connectors.setSchedule', { source: 'nist', cadence: 'hourly', atMinute: null, weekday: null, timeZone: null }, { tenantId });

    expect(nist.offeredCadences).not.toContain('hourly');
    expect(nist.offeredCadences).toContain('every_6_hours');
    expect(refused.status).toBe(400);
  });

  it('should refuse a cadence sent with the wrong fields', async () => {
    const refused = await client.mutation('connectors.setSchedule', { source: 'microsoft_graph', cadence: 'daily', atMinute: null, weekday: null, timeZone: null }, { tenantId });

    expect(refused.status).toBe(400);
  });

  it('should take the permission that configures the integration', async () => {
    const member = await createTenantUser(services, db, adminOrigin);
    const memberClient = createTrpcTestClient(await getTestServer());
    await signInAs(memberClient, member.userId);

    const refused = await memberClient.mutation('connectors.setSchedule', { source: 'microsoft_graph', cadence: 'hourly', atMinute: null, weekday: null, timeZone: null }, { tenantId });

    expect(refused.status).toBe(403);
    expect((await getSchedule('microsoft_graph')).cadence).toBe('every_6_hours');
  });

  it('should start a run at once on Sync now and leave the next run where it was', async () => {
    await client.mutation('connectors.setSchedule', { source: 'microsoft_graph', cadence: 'every_6_hours', atMinute: null, weekday: null, timeZone: null }, { tenantId });
    const before = await getSchedule('microsoft_graph');

    const synced = await client.mutation('connectors.syncNow', { source: 'microsoft_graph' }, { tenantId });
    const run = await services.withOrigin({ type: 'system' }).jobs.getJob(synced.json.result.data.jobId);

    expect(run).toMatchObject({ status: 'queued', triggeredBy: 'user', kind: 'microsoft-graph-sync' });
    expect((await getSchedule('microsoft_graph')).nextRunAt).toBe(before.nextRunAt);
  });

  describe('read across the app', () => {
    interface ScheduleItem { kind: string, source: string | null, cadence: string, atMinute: number | null, timeZone: string | null, nextRunAt: string | null, lastRun: { status: string } | null }
    interface ConnectorCard { source: string, enabled: boolean, schedule: { cadence: string, nextRunAt: string | null } | null }

    const listSchedules = async (): Promise<Array<ScheduleItem>> => (await client.query('jobs.listSchedules', undefined, { tenantId })).json.result.data;
    const listCards = async (): Promise<Array<ConnectorCard>> => (await client.query('connectors.listConnectors', undefined, { tenantId })).json.result.data;
    const cardOf = async (source: string): Promise<ConnectorCard | undefined> => (await listCards()).find((card) => card.source === source);

    it('should list the seven scheduled-pull connectors, then the eight daily kinds', async () => {
      const items = await listSchedules();

      expect(items.map((item) => item.kind)).toEqual([
        'cve-epss-sync',
        'cve-cvss-sync',
        'cve-kev-sync',
        'microsoft-graph-sync',
        'openaev-findings-sync',
        'drata-sync',
        'default-threats-sync',
        'capability-derivation',
        'crq-price-recompute',
        'threat-outcome-counter-recompute',
        'threat-activity-recompute',
        'finding-score-recompute',
        'proven-posture-record',
        'attack-outcome-mixture-recompute',
        'jobs-retention',
      ]);
      expect(items.slice(0, 7).every((item) => item.source !== null)).toBe(true);
      expect(items.slice(7).every((item) => item.source === null)).toBe(true);
    });

    it('should read a connector on the next run the drawer reads, and none for one that cannot run', async () => {
      const items = await listSchedules();

      expect(items.find((item) => item.source === 'microsoft_graph')?.nextRunAt).toBe((await getSchedule('microsoft_graph')).nextRunAt);
      expect(items.find((item) => item.source === 'drata')).toMatchObject({ cadence: 'daily', nextRunAt: null });
    });

    it('should read a platform kind on the deployment hour, in UTC, with its next run within the day ahead', async () => {
      const platform = (await listSchedules()).find((item) => item.kind === 'finding-score-recompute');
      const aheadMs = Date.parse(platform?.nextRunAt ?? '') - Date.now();

      expect(platform).toMatchObject({ source: null, cadence: 'daily', atMinute: 3 * 60, timeZone: 'UTC' });
      expect(aheadMs).toBeGreaterThan(0);
      expect(aheadMs).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
    });

    it('should read the last run of a kind with its status', async () => {
      const system = services.withOrigin({ type: 'system' }).jobs;
      const { jobId } = await system.enqueueJob({ kind: 'drata-sync', tenantId, payload: {} });
      await system.claimNext(`worker-${jobId}`, ['drata-sync'], 30_000);
      await system.recordFailure(jobId, `worker-${jobId}`, { message: 'boom' }, false, () => 0);

      const items = await listSchedules();

      expect(items.find((item) => item.kind === 'drata-sync')?.lastRun).toMatchObject({ status: 'dlq' });
      expect(items.find((item) => item.kind === 'jobs-retention')?.lastRun).toBeNull();
    });

    it('should read a connector as on until its own switch is turned off', async () => {
      expect((await cardOf('default_threats'))?.enabled).toBe(true);
      expect((await cardOf('nist'))?.enabled).toBe(true);

      await client.mutation('defaultThreats.setEnabled', { enabled: false }, { tenantId });

      expect((await cardOf('default_threats'))?.enabled).toBe(false);
      expect((await cardOf('nist'))?.enabled).toBe(true);
    });

    it('should read a configured connector next run on its card, manual as manual, and no schedule for the stream', async () => {
      const defender = await cardOf('microsoft_graph');
      await client.mutation('connectors.setSchedule', { source: 'nist', cadence: 'manual', atMinute: null, weekday: null, timeZone: null }, { tenantId });

      expect(defender?.schedule).toEqual({ cadence: 'every_6_hours', nextRunAt: (await getSchedule('microsoft_graph')).nextRunAt });
      expect((await cardOf('nist'))?.schedule).toEqual({ cadence: 'manual', nextRunAt: null });
      expect((await cardOf('opencti'))?.schedule).toBeNull();
    });
  });
});
