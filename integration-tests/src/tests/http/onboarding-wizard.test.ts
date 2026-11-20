import { DECLARED_ESTATE_KIND_VALUES } from '@app/module/client';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { EMPTY_ANSWERS, FULLY_ANSWERED_PROFILE_ANSWERS } from '../../helpers/financial-profile-answers';
import { signInAs } from '../../helpers/sign-in';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

const SUPER_ADMIN_EMAIL = 'xtm-admin@example.com';

describe('Onboarding wizard (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());
    // The first tenant of a platform is created by the super administrator, who is a member of no tenant.
    const { userId } = await createUser(db, SUPER_ADMIN_EMAIL);
    await db.execute(sql`UPDATE users SET is_super_admin = true WHERE id = ${userId}`);
    await signInAs(client, userId);
  });

  it('should provision a created tenant and serve its wizard', async () => {
    const tenantId = uuidv7();
    const created = await client.mutation('tenants.createTenantsTransaction', { id: tenantId, name: 'Tenant' });
    expect(created.status).toBe(200);

    const scopes = await client.query('organizations.getOrganizations', undefined, { tenantId });
    expect(scopes.json.result.data.map((scope: { name: string }) => scope.name)).toEqual(['Enterprise']);

    const res = await client.query('onboardingWizard.getOnboardingWizard', undefined, { tenantId });
    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({
      id: expect.any(String),
      organizationId: scopes.json.result.data[0].id,
      steps: {
        company: 'todo', assets: 'todo', threats: 'todo', defenses: 'todo', finances: 'todo', tolerance: 'todo', protect: 'todo', scenarios: 'todo',
      },
      finished: false,
    });

    const threats = await client.query('defaultThreats.getOverview', undefined, { tenantId });
    expect(threats.status).toBe(200);
    expect(threats.json.result.data.enabled).toBe(false);
  });

  it('should report the Assets step as started once an asset is created through the API', async () => {
    const tenantId = uuidv7();
    await client.mutation('tenants.createTenantsTransaction', { id: tenantId, name: 'Tenant' });

    const before = await client.query('onboardingWizard.getOnboardingWizard', undefined, { tenantId });
    expect(before.json.result.data.steps.assets).toBe('todo');

    const created = await client.mutation('supportingAssets.createSupportingAsset', {
      id: uuidv7(), name: 'Database Server', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
    }, { tenantId });
    expect(created.status).toBe(200);

    const after = await client.query('onboardingWizard.getOnboardingWizard', undefined, { tenantId });
    expect(after.json.result.data).toMatchObject({
      steps: {
        company: 'todo', assets: 'started', threats: 'todo', defenses: 'todo', finances: 'todo', tolerance: 'todo', protect: 'todo', scenarios: 'todo',
      },
      finished: false,
    });
  });

  describe('started steps', () => {
    const createWizardTenant = async () => {
      const tenantId = uuidv7();
      await client.mutation('tenants.createTenantsTransaction', { id: tenantId, name: 'Tenant' });
      const scopes = await client.query('organizations.getOrganizations', undefined, { tenantId });
      const organizationId: string = scopes.json.result.data[0].id;
      return { tenantId, organizationId };
    };

    const readSteps = async (tenantId: string) =>
      (await client.query('onboardingWizard.getOnboardingWizard', undefined, { tenantId })).json.result.data;

    it('should serve Finances as started with one answer, then as done once the 21 questions are answered', async () => {
      const { tenantId, organizationId } = await createWizardTenant();

      await client.mutation('financialProfiles.saveFinancialProfile', {
        organizationId, answers: { ...EMPTY_ANSWERS, annualRevenue: 30_000_000 },
      }, { tenantId });
      expect((await readSteps(tenantId)).steps.finances).toBe('started');

      await client.mutation('financialProfiles.saveFinancialProfile', {
        organizationId,
        answers: {
          ...FULLY_ANSWERED_PROFILE_ANSWERS,
          restoreTestRecency: 'within_12m',
          largestRepositoryBand: 'under_100k',
          contractualLiabilityCapBand: 'under_25',
          worstOutageBand: 'none',
          costliestIncidentBand: 'none',
        },
      }, { tenantId });
      expect((await readSteps(tenantId)).steps.finances).toBe('done');
    });

    it('should serve Assets as started once the scope declares a kind, then as done once the 12 kinds are answered, "None" included', async () => {
      const { tenantId, organizationId } = await createWizardTenant();
      expect((await readSteps(tenantId)).steps.assets).toBe('todo');

      const saved = await client.mutation('declaredEstate.save', {
        organizationId, answers: [{ kind: 'workstations', bounds: { low: 251, high: 1000 }, internetFacing: null }],
      }, { tenantId });
      expect(saved.status).toBe(200);
      expect((await readSteps(tenantId)).steps.assets).toBe('started');

      const rest = await client.mutation('declaredEstate.save', {
        organizationId,
        answers: DECLARED_ESTATE_KIND_VALUES.filter((kind) => kind !== 'workstations').map((kind) => ({
          kind, bounds: { low: 0, high: 0 }, internetFacing: null,
        })),
      }, { tenantId });
      expect(rest.status).toBe(200);
      expect((await readSteps(tenantId)).steps.assets).toBe('done');
    });

    it('should serve a wizard with a started step as unfinished', async () => {
      const { tenantId, organizationId } = await createWizardTenant();
      await client.mutation('financialProfiles.saveFinancialProfile', {
        organizationId, answers: { ...EMPTY_ANSWERS, grossMarginPct: 40 },
      }, { tenantId });

      const wizard = await readSteps(tenantId);
      expect(Object.values(wizard.steps).sort()).toEqual(['started', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
      expect(wizard.finished).toBe(false);
    });
  });
});
