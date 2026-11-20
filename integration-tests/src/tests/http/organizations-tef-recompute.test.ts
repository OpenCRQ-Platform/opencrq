import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttackOutcome_Ransomware, deriveSeedId, jobsService } from '@app/module';
import { EMPTY_ANSWERS } from '../../helpers/financial-profile-answers';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Organizations firmography → tef-recompute enqueue (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminOrigin: EventOrigin;
  let organizationId: string;
  let autoScenarioId: string;
  let manualScenarioId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    adminOrigin = { type: 'client', userId: adminId, tenantId };
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);

    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Org' }]);

    const attackOutcomeId = deriveSeedId(tenantId, AttackOutcome_Ransomware);
    autoScenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: autoScenarioId, organizationId, name: 'Auto scenario', description: null, attackOutcomeId, primaryAssetIds: [],
    });
    await services.withOrigin(adminOrigin).crqIndicators.setTefMode(autoScenarioId, 'auto', tenantId);

    manualScenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: manualScenarioId, organizationId, name: 'Manual scenario', description: null, attackOutcomeId, primaryAssetIds: [],
    });
    await services.withOrigin(adminOrigin).crqIndicators.setTefMode(manualScenarioId, 'manual', tenantId);
  });

  it('enqueues one tef-recompute job per auto-mode scenario when firmography changes', async () => {
    const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
    const finance = sectors.find((s) => s.name === 'Finance')!;

    const res = await client.mutation('organizations.updateOrganization', {
      id: organizationId,
      sectorId: finance.id,
      employeeCount: 500,
    }, { tenantId });
    expect(res.status).toBe(200);

    const jobs = await services.withOrigin({ type: 'system' }).jobs.listJobs({ tenantId, kind: 'tef-recompute' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ riskScenarioId: autoScenarioId });
    expect(jobs[0].triggeredBy).toBe('user');
  });

  it('enqueues no job when the firmography save does not touch firmography fields', async () => {
    const res = await client.mutation('organizations.updateOrganization', {
      id: organizationId,
      name: 'Renamed Org',
    }, { tenantId });
    expect(res.status).toBe(200);

    const jobs = await services.withOrigin({ type: 'system' }).jobs.listJobs({ tenantId, kind: 'tef-recompute' });
    expect(jobs).toHaveLength(0);
  });

  it('enqueues a tef-recompute when a profile save derives a new revenue band', async () => {
    const res = await client.mutation('financialProfiles.saveFinancialProfile', {
      organizationId,
      answers: { ...EMPTY_ANSWERS, annualRevenue: 30_000_000 },
    }, { tenantId });
    expect(res.status).toBe(200);

    const organization = await services.withOrigin(adminOrigin).organizations.getOrganization(organizationId);
    expect(organization?.revenueBand).toBe('10m_100m');

    const jobs = await services.withOrigin({ type: 'system' }).jobs.listJobs({ tenantId, kind: 'tef-recompute' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ riskScenarioId: autoScenarioId });
  });

  it('enqueues nothing when a profile save leaves the revenue band where it was', async () => {
    const res = await client.mutation('financialProfiles.saveFinancialProfile', {
      organizationId,
      answers: { ...EMPTY_ANSWERS, grossMarginPct: 40 },
    }, { tenantId });
    expect(res.status).toBe(200);

    const jobs = await services.withOrigin({ type: 'system' }).jobs.listJobs({ tenantId, kind: 'tef-recompute' });
    expect(jobs).toHaveLength(0);
  });

  it('does not double-enqueue on a rapid double-save of the same firmography value', async () => {
    const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
    const finance = sectors.find((s) => s.name === 'Finance')!;

    await Promise.all([
      client.mutation('organizations.updateOrganization', { id: organizationId, sectorId: finance.id }, { tenantId }),
      client.mutation('organizations.updateOrganization', { id: organizationId, sectorId: finance.id }, { tenantId }),
    ]);

    const jobs = await services.withOrigin({ type: 'system' }).jobs.listJobs({ tenantId, kind: 'tef-recompute' });
    expect(jobs).toHaveLength(1);
  });

  it('saves the profile even when every tef-recompute enqueue fails', async () => {
    const enqueueJobSpy = vi.spyOn(jobsService.methods, 'enqueueJob').mockRejectedValue(new Error('injected enqueue failure'));

    try {
      const res = await client.mutation('financialProfiles.saveFinancialProfile', {
        organizationId,
        answers: { ...EMPTY_ANSWERS, annualRevenue: 30_000_000 },
      }, { tenantId });

      // The enqueue is a consequence of the save, not a condition of it: a broken job queue must
      // not cost the user the answers they just typed.
      expect(res.status).toBe(200);
      expect(enqueueJobSpy).toHaveBeenCalled();
      const profile = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(profile?.annualRevenue).toBe(30_000_000);
    } finally {
      enqueueJobSpy.mockRestore();
    }
  });
});
