import type { CrqRunFamily, EventOrigin } from '@app/module';
import { crqIndicatorRuns, crqIndicatorsRepository } from '@app/module';
import { inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const FULL = ['techniques', 'cves', 'levers', 'plans'];
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

/**
 * `familyRunsQuery` reads each scenario from its newest whole-family run onwards. The reference is the
 * same set defined over the whole history: rank every run of the scenario, keep those with no newer
 * whole-family run that mention the family.
 */
describe('the runs a family is read from', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let organizationId: string;
  let attackOutcomeId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
    attackOutcomeId = (await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes())[0].id;
  });

  const createScenario = async (name: string): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id, organizationId, name, description: null, attackOutcomeId, primaryAssetIds: [],
    });
    return id;
  };

  const insertRun = async (riskScenarioId: string, createdAt: Date, profile: Array<string>, id: string = uuidv7()): Promise<string> => {
    await db.insert(crqIndicatorRuns).values({
      id, riskScenarioId, createdAt, profile, iterations: 1000, vulnerabilityP5: 0.1, vulnerabilityP50: 0.2, vulnerabilityP95: 0.3,
      techniqueCount: 10, coveredTechniqueCount: 4, aleMean: 100_000,
    });
    return id;
  };

  const referenceRuns = async (family: CrqRunFamily, riskScenarioIds: Array<string>) => (await db.execute<{ runId: string, riskScenarioId: string, rank: number }>(sql`
    select run_id as "runId", risk_scenario_id as "riskScenarioId", rank
    from (
      select id as run_id, risk_scenario_id, profile,
        (row_number() over (partition by risk_scenario_id order by created_at desc, id desc))::int as rank,
        (count(*) filter (where ${family} = any(profile)) over (
          partition by risk_scenario_id order by created_at desc, id desc rows between unbounded preceding and 1 preceding
        ))::int as newer_whole_runs
      from ${crqIndicatorRuns}
      where ${inArray(crqIndicatorRuns.riskScenarioId, riskScenarioIds)}
    ) ranked
    where newer_whole_runs = 0
      and exists (select 1 from unnest(profile) as token where token = ${family} or starts_with(token, ${`${family}:`}))
  `)).rows;

  /** Each scenario's runs, newest first: the only thing `familyRunOwnership` reads `rank` for. */
  const inOrder = (runs: ReadonlyArray<{ runId: string, riskScenarioId: string, rank: number }>) => Object.fromEntries(
    [...Map.groupBy(runs, (run) => run.riskScenarioId)]
      .map(([riskScenarioId, scenarioRuns]) => [riskScenarioId, scenarioRuns.toSorted((one, other) => one.rank - other.rank).map((run) => run.runId)]),
  );

  it('reads the same runs in the same order as the definition over the whole history', async () => {
    const neverWhole = await createScenario('Never computed whole');
    await insertRun(neverWhole, daysAgo(5), []);
    await insertRun(neverWhole, daysAgo(4), ['plans:p1']);
    await insertRun(neverWhole, daysAgo(3), ['levers:c1']);
    await insertRun(neverWhole, daysAgo(2), []);

    const anchored = await createScenario('Named runs around a whole run');
    await insertRun(anchored, daysAgo(9), FULL);
    await insertRun(anchored, daysAgo(8), ['plans:p1', 'levers:c1']);
    await insertRun(anchored, daysAgo(6), FULL);
    await insertRun(anchored, daysAgo(5), []);
    await insertRun(anchored, daysAgo(4), ['plans:p2']);
    await insertRun(anchored, daysAgo(3), ['levers:c2']);
    await insertRun(anchored, daysAgo(2), []);

    // uuidv7 ids grow with creation, so the tie breaks on the order they are generated in.
    const tied = await createScenario('Runs sharing the whole run\'s timestamp');
    const olderId = uuidv7();
    const anchorId = uuidv7();
    const newerId = uuidv7();
    const sameInstant = daysAgo(3);
    await insertRun(tied, daysAgo(4), ['plans:p1']);
    await insertRun(tied, sameInstant, ['plans:p2'], olderId);
    await insertRun(tied, sameInstant, FULL, anchorId);
    await insertRun(tied, sameInstant, ['plans:p3', 'levers:c1'], newerId);

    const scenarioIds = [neverWhole, anchored, tied];
    for (const family of ['plans', 'levers'] as const) {
      const read = await crqIndicatorsRepository.findFamilyRunsByScenarioIds(repositoryContextOf(db, adminOrigin), family, scenarioIds);
      expect(inOrder(read)).toEqual(inOrder(await referenceRuns(family, scenarioIds)));
    }
    const tiedPlans = await crqIndicatorsRepository.findFamilyRunsByScenarioIds(repositoryContextOf(db, adminOrigin), 'plans', [tied]);
    expect(inOrder(tiedPlans)).toEqual({ [tied]: [newerId, anchorId] });
  });

  it('reads no run of another tenant', async () => {
    const scenarioId = await createScenario('Tenant A only');
    await insertRun(scenarioId, daysAgo(1), FULL);

    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

    expect(await crqIndicatorsRepository.findFamilyRunsByScenarioIds(repositoryContextOf(db, otherOrigin), 'plans', [scenarioId])).toEqual([]);
  });
});
