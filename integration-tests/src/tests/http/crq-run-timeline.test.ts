import type { EventOrigin } from '@app/module';
import { crqIndicatorRuns } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const DAY_MS = 86_400_000;

describe('CRQ run timeline (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantId: string;
  let riskScenarioId: string;
  let olderRunId: string;
  let latestRunId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Timeline Tenant' }, adminId);
    const origin: EventOrigin = { type: 'client', userId: adminId, tenantId };
    ({ riskScenarioId } = await seedAttackRunScenario(services, origin, tenantId));

    olderRunId = uuidv7();
    latestRunId = uuidv7();
    const now = Date.now();
    const bareRun = { riskScenarioId, iterations: 1, vulnerabilityP5: 0, vulnerabilityP50: 0, vulnerabilityP95: 0, techniqueCount: 0, coveredTechniqueCount: 0 };
    await db.insert(crqIndicatorRuns).values([
      { ...bareRun, id: olderRunId, createdAt: new Date(now - 30 * DAY_MS), aleMean: 400_000, magnitudeMean: 200_000 },
      { ...bareRun, id: latestRunId, createdAt: new Date(now - DAY_MS), aleMean: 500_000, magnitudeMean: 250_000 },
    ]);
  });

  it('should serve the sampled runs and the latest two with their dates as ISO strings', async () => {
    const res = await client.query('crqIndicators.getRunTimeline', { riskScenarioId, windowDays: 90 }, { tenantId });

    expect(res.status).toBe(200);
    const timeline: { latest: Array<Record<string, unknown>>, points: Array<Record<string, unknown>>, until: string } = res.json.result.data;
    expect(timeline.latest.map((run) => run.id)).toEqual([latestRunId, olderRunId]);
    expect(timeline.points.map((run) => run.aleMean)).toEqual([400_000, 500_000]);
    expect(timeline.points[1]).toMatchObject({ magnitudeMean: 250_000, createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(timeline.points[1]).not.toHaveProperty('techniqueCount');
    expect(new Date(timeline.until).getTime()).toBeGreaterThan(Date.now() - DAY_MS);
  });

  it.each([0, 367, 1.5])('should refuse a window of %s days', async (windowDays) => {
    const res = await client.query('crqIndicators.getRunTimeline', { riskScenarioId, windowDays }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse a call that names no tenant', async () => {
    const res = await client.query('crqIndicators.getRunTimeline', { riskScenarioId, windowDays: 90 });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should serve a member of another tenant none of this scenario\'s runs', async () => {
    const outsider = await createUser(db);
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other tenant' }, adminId);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId: otherTenantId })
      .tenants.addTenantUser(otherTenantId, outsider.userId);
    const outsiderClient = createTrpcTestClient(await getTestServer());
    await signInAs(outsiderClient, outsider.userId);

    const res = await outsiderClient.query('crqIndicators.getRunTimeline', { riskScenarioId, windowDays: 90 }, { tenantId: otherTenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toMatchObject({ latest: [], points: [] });
  });
});
