import type { EventOrigin } from '@app/module';
import { AttackOutcome_DataBreachResale, BusinessValueCategory_PersonalData, deriveSeedId, FULL_RUN_PROFILE } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FULLY_ANSWERED_PROFILE_ANSWERS } from '../../helpers/financial-profile-answers';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The handler reaches the shared database instance and the logger through the backend config,
// which the shared setup stubs out.
vi.mock('../../../../back/src/config', () => ({
  config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() } }),
  pmConfig: {},
  getProcessName: () => 'test',
}));

const { financialEstimatesRecomputeHandler } = await import('@app/back/src/features/financial-estimates-recompute/financial-estimates-recompute-handler');

const KIND = 'financial-estimates-recompute';
const CRQ_SIMULATION_JOB = 'crq-simulation';

const services = createTestServices(db);

/**
 * The handler is the only place the CRQ hand-off lives, so a test that calls the module service
 * instead would still pass with the enqueue deleted. `runDb` stands in for the observed instance:
 * the handler refuses to run without one.
 */
const runHandler = (tenantId: string, payload: Record<string, unknown>) => financialEstimatesRecomputeHandler({
  jobId: uuidv7(),
  tenantId,
  kind: KIND,
  interactive: false,
  payload,
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: async () => {},
  saveStateSnapshot: async () => {},
  runDb: db,
});

describe('the CRQ run a questionnaire-driven recompute hands off', () => {
  let tenantId: string;
  let adminOrigin: EventOrigin;
  let riskScenarioId: string;

  const crqJobs = async () => await services.withOrigin(adminOrigin).jobs.listJobs({ tenantId, kind: CRQ_SIMULATION_JOB });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    adminOrigin = setup.origin;
    const scoped = services.withOrigin(adminOrigin);

    const organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Scope under test' }]);
    await scoped.organizations.updateOrganization(organizationId, { employeeCount: 150 });

    riskScenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Scenario under test',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_DataBreachResale),
      primaryAssetIds: [],
    });

    // An activated driver needs a primary asset carrying a business value category: without one the
    // activation set is empty and the derivation has nothing to price.
    const primaryAssetId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: primaryAssetId,
      organizationId,
      name: 'CRM',
      description: null,
      ownerId: null,
      businessValueCategoryIds: [deriveSeedId(tenantId, BusinessValueCategory_PersonalData)],
    });
    await scoped.riskScenarios.updateRiskScenario(riskScenarioId, { primaryAssetIds: [primaryAssetId] });
    await scoped.financialProfiles.saveFinancialProfile(organizationId, FULLY_ANSWERED_PROFILE_ANSWERS);
  });

  it('should book one for the scenario whose amounts the sweep moved', async () => {
    await runHandler(tenantId, {});

    const jobs = await crqJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ riskScenarioId, profile: FULL_RUN_PROFILE });
  });

  it('should book none on a second sweep that found every amount unchanged', async () => {
    await runHandler(tenantId, {});
    const afterFirst = await crqJobs();
    await runHandler(tenantId, {});

    expect(await crqJobs()).toHaveLength(afterFirst.length);
  });

  it('should book one for a scenario asked for by name, which is what creation books', async () => {
    await runHandler(tenantId, { riskScenarioId });

    const jobs = await crqJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ riskScenarioId, profile: FULL_RUN_PROFILE });
  });

  it('should book none when a backfill finds every row already derived', async () => {
    // A backfill writes only genuinely missing rows, so once the scenario is priced it has nothing
    // to move. On a scenario with no rows at all it does write them, and that is an amount change
    // like any other.
    await runHandler(tenantId, {});
    const afterFirst = await crqJobs();

    await runHandler(tenantId, { backfillOnly: true });

    expect(await crqJobs()).toHaveLength(afterFirst.length);
  });
});
