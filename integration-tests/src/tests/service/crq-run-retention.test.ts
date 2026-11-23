import type { EventOrigin } from '@app/module';
import { budgetReviews, CRQ_RUN_DETAIL_RETENTION_DAYS, crqBudgetReviewResults, crqIndicatorRuns } from '@app/module';
import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const NOW = new Date('2026-11-23T12:00:00Z');
/** The first instant every run is kept at, mid-day so an hour either side is the same UTC day. */
const BOUND = new Date(NOW.getTime() - CRQ_RUN_DETAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
/** A UTC day wholly past the retention. */
const OLD_DAY = '2025-06-10';

describe('CRQ run retention', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;
  let template: typeof crqIndicatorRuns.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 20 });
    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId));
    const { runId } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
    [template] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    await db.delete(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
  });

  const run = async (
    createdAt: string,
    { profile = [] as Array<string>, scenarioId = riskScenarioId, aleMean = template.aleMean, lefMean = template.lefMean } = {},
  ) => {
    const id = uuidv7();
    await db.insert(crqIndicatorRuns).values({ ...template, id, riskScenarioId: scenarioId, createdAt: new Date(createdAt), profile, aleMean, lefMean });
    return id;
  };

  /** The last runs of two later days, so the two latest runs, which always stay, are not the ones a test reads. */
  const twoLaterDays = async () => [await run('2025-06-11T08:00:00Z'), await run('2025-06-12T08:00:00Z')];

  const purge = (limits?: { batchSize: number, maxBatches: number }, now = NOW) => services
    .withOrigin({ type: 'job', tenantId, jobKind: 'jobs-retention', interactive: false })
    .crqIndicators.purgeExpiredRuns(now, limits);

  const runsLeft = async () => (await db.select({ id: crqIndicatorRuns.id }).from(crqIndicatorRuns).orderBy(asc(crqIndicatorRuns.createdAt)))
    .map((row) => row.id);

  it('should keep every run younger than the retention, however many a day', async () => {
    const ids = [await run('2026-11-20T08:00:00Z'), await run('2026-11-20T12:00:00Z'), await run('2026-11-20T20:00:00Z')];

    expect(await purge()).toEqual({ runsDeleted: 0 });
    expect(await runsLeft()).toEqual(ids);
  });

  it('should keep the last run of each UTC day past the retention, and delete the others', async () => {
    await run(`${OLD_DAY}T08:00:00Z`);
    await run(`${OLD_DAY}T12:00:00Z`);
    const lastOfDay = await run(`${OLD_DAY}T23:30:00Z`);
    const nextDay = await run('2025-06-11T00:30:00Z');

    expect(await purge()).toEqual({ runsDeleted: 2 });
    expect(await runsLeft()).toEqual([lastOfDay, nextDay]);
  });

  it('should keep the two latest runs of a scenario whatever their age, its headline and the delta beside it', async () => {
    await run(`${OLD_DAY}T08:00:00Z`);
    const latestTwo = [await run(`${OLD_DAY}T09:00:00Z`), await run(`${OLD_DAY}T10:00:00Z`)];

    expect(await purge()).toEqual({ runsDeleted: 1 });
    expect(await runsLeft()).toEqual(latestTwo);
  });

  it('should keep the last run of a day with an ALE and the last with a LEF, which the daily series read apart', async () => {
    const lastWithAle = await run(`${OLD_DAY}T08:00:00Z`);
    const lastWithLef = await run(`${OLD_DAY}T09:00:00Z`, { aleMean: null });
    const lastOfDay = await run(`${OLD_DAY}T10:00:00Z`, { aleMean: null, lefMean: null });
    const nextDay = await twoLaterDays();

    expect(await purge()).toEqual({ runsDeleted: 0 });
    expect(await runsLeft()).toEqual([lastWithAle, lastWithLef, lastOfDay, ...nextDay]);
  });

  it('should keep a run that a later run of its day stands for while that one is still within the retention', async () => {
    const beforeBound = await run(new Date(BOUND.getTime() - 60 * 60 * 1000).toISOString());
    const afterBound = await run(new Date(BOUND.getTime() + 60 * 60 * 1000).toISOString());

    expect(await purge()).toEqual({ runsDeleted: 0 });
    expect(await runsLeft()).toEqual([beforeBound, afterBound]);
  });

  it('should keep the newest run to compute a figure family, until a later run computes it', async () => {
    const levers = await run(`${OLD_DAY}T08:00:00Z`, { profile: ['levers'] });
    const lastOfDay = await run(`${OLD_DAY}T12:00:00Z`);
    const nextDay = await twoLaterDays();

    await purge();
    expect(await runsLeft()).toEqual([levers, lastOfDay, ...nextDay]);

    const laterLevers = await run('2026-11-20T08:00:00Z', { profile: ['levers'] });
    await purge();
    expect(await runsLeft()).toEqual([lastOfDay, ...nextDay, laterLevers]);
  });

  describe('the technique values a kept run reads, from the newest techniques run at or before it', () => {
    it('should delete a techniques run a later one of its day stands for, no kept run between them', async () => {
      await run(`${OLD_DAY}T08:00:00Z`, { profile: ['techniques'] });
      await run(`${OLD_DAY}T09:00:00Z`);
      const techniques = await run(`${OLD_DAY}T10:00:00Z`, { profile: ['techniques'] });
      const lastOfDay = await run(`${OLD_DAY}T12:00:00Z`);
      const nextDay = await twoLaterDays();

      expect(await purge()).toEqual({ runsDeleted: 2 });
      expect(await runsLeft()).toEqual([techniques, lastOfDay, ...nextDay]);
    });

    it('should keep a techniques run a kept run between it and the next one reads its values from', async () => {
      const techniques = await run(`${OLD_DAY}T08:00:00Z`, { profile: ['techniques'] });
      const leversOfOneControl = await run(`${OLD_DAY}T09:00:00Z`, { profile: [`levers:${uuidv7()}`] });
      const laterTechniques = await run(`${OLD_DAY}T10:00:00Z`, { profile: ['techniques'] });
      const lastOfDay = await run(`${OLD_DAY}T12:00:00Z`);
      const nextDay = await twoLaterDays();

      expect(await purge()).toEqual({ runsDeleted: 0 });
      expect(await runsLeft()).toEqual([techniques, leversOfOneControl, laterTechniques, lastOfDay, ...nextDay]);
    });

    it('should keep a techniques run the next one stands for only within the retention', async () => {
      const techniques = await run(`${OLD_DAY}T08:00:00Z`, { profile: ['techniques'] });
      const laterTechniques = await run('2026-11-20T08:00:00Z', { profile: ['techniques'] });
      const nextDay = await twoLaterDays();

      expect(await purge()).toEqual({ runsDeleted: 0 });
      expect(await runsLeft()).toEqual([techniques, ...nextDay, laterTechniques]);
    });
  });

  it('should keep a run holding a budget review figure at the review\'s current version, and not one at an expired version', async () => {
    const reviewId = await services.withOrigin(adminOrigin).budgetReviews.createBudgetReview({ organizationId, name: 'Exercice', periodStart: '2025-01-01' });
    const [{ version }] = await db.select({ version: budgetReviews.version }).from(budgetReviews).where(eq(budgetReviews.id, reviewId));
    const current = await run(`${OLD_DAY}T08:00:00Z`);
    const expired = await run(`${OLD_DAY}T09:00:00Z`);
    const lastOfDay = await run(`${OLD_DAY}T12:00:00Z`);
    const nextDay = await twoLaterDays();
    await db.insert(crqBudgetReviewResults).values([current, expired].map((runId, index) => ({
      id: uuidv7(),
      runId,
      reviewId,
      reviewVersion: index === 0 ? version : version - 1,
      basket: 'build' as const,
      aleReductionMean: 100,
    })));

    await purge();

    expect(await runsLeft()).toEqual([current, lastOfDay, ...nextDay]);
  });

  it('should leave the scenario\'s ALE history over the longest window it offers as it was', async () => {
    const daysAgo = (days: number, hours: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000).toISOString();
    let aleMean = 1_000;
    for (const days of [400, 367, CRQ_RUN_DETAIL_RETENTION_DAYS, 365, 200, 30, 1]) {
      for (const hours of [-3, -2, -1, 1, 2]) {
        aleMean += 10;
        await run(daysAgo(days, hours), { aleMean });
      }
    }
    const history = async () => {
      const timeline = await services.withOrigin(adminOrigin).crqIndicators.getRunTimeline(riskScenarioId, CRQ_RUN_DETAIL_RETENTION_DAYS);
      return [...timeline.latest, ...timeline.points].map((point) => [point.id, point.aleMean]);
    };
    const before = await history();

    expect((await purge(undefined, new Date())).runsDeleted).toBeGreaterThan(0);
    expect(await history()).toEqual(before);
  });

  it('should purge in batches, up to the batch cap', async () => {
    await run(`${OLD_DAY}T08:00:00Z`);
    await run(`${OLD_DAY}T09:00:00Z`);
    await run(`${OLD_DAY}T10:00:00Z`);
    await run(`${OLD_DAY}T11:00:00Z`);

    expect(await purge({ batchSize: 1, maxBatches: 2 })).toEqual({ runsDeleted: 2 });
    expect(await runsLeft()).toHaveLength(2);
  });

  it('should leave the runs of another tenant alone', async () => {
    const other = await createTenantWithAdmin(services);
    const { riskScenarioId: otherScenarioId } = await seedAttackRunScenario(services, other.origin, other.tenantId);
    const ids = [
      await run(`${OLD_DAY}T08:00:00Z`, { scenarioId: otherScenarioId }),
      await run(`${OLD_DAY}T09:00:00Z`, { scenarioId: otherScenarioId }),
      await run(`${OLD_DAY}T10:00:00Z`, { scenarioId: otherScenarioId }),
    ];

    expect(await purge()).toEqual({ runsDeleted: 0 });
    expect(await runsLeft()).toEqual(ids);
  });
});
