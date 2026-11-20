import type { EventOrigin } from '@app/module';
import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_ServiceDisruption,
  controlCapabilities,
  crqIndicatorGroupScores,
  crqIndicatorRunReachGaps,
  crqIndicatorRuns,
  mitreTechniques,
  SCENARIO_GROUP_BOOST_G,
  supportingAssets,
  supportToPrimaryLinks,
} from '@app/module';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AttackRunScenarioOptions } from '../../helpers/attack-run-scenario';
import { EXPOSED_ESTATE, runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * The engine over a risk scope's estate. The fixture's scope is open and holds 102 assets across
 * three families; closing it over three of them is what makes the narrowing observable in the
 * figures rather than only in the run row.
 */
describe('the attack run engine on a risk scope estate', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;

  const scoped = () => services.withOrigin(adminOrigin);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId));
  });

  const closeOver = async (assetIds: Array<string>) => {
    await scoped().organizations.updateOrganization(organizationId, {
      estateMode: 'closed',
      mapping: { added: assetIds, removed: [] },
    });
  };

  const anyAssets = async (howMany: number) => (await db
    .select({ id: supportingAssets.id })
    .from(supportingAssets)
    .where(eq(supportingAssets.tenantId, tenantId))
    .orderBy(asc(supportingAssets.name))
    .limit(howMany)).map((asset) => asset.id);

  /** The assets the fixture put behind the scenario's primary asset. */
  const targetedAssets = async () => (await db
    .select({ id: supportToPrimaryLinks.supportingAssetId })
    .from(supportToPrimaryLinks)).map((link) => link.id);

  it('should walk the whole tenant estate in an open scope and the mapping alone in a closed one', async () => {
    const open = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
    expect(open.reach.estateAssetCount).toBe(102);

    await closeOver(await anyAssets(3));
    const closed = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);

    expect(closed.reach.estateAssetCount).toBe(3);
    // The estate is the population every route term is weighed over, so narrowing it moves the
    // answer: two runs reporting the same figure would mean the join changed nothing.
    expect(closed.result.vulnerability.mean).not.toBe(open.result.vulnerability.mean);
  }, 600_000);

  it('should record the estate it walked, the boost it applied, the job that computed it and when it read its inputs', async () => {
    const { runId } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);

    const [openRun] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    expect(openRun.estateMode).toBe('open');
    expect(openRun.estateAssetCount).toBe(102);
    // Four crown jewels of the hundred and two sit behind the scenario's primary asset, so the boost
    // separated something.
    expect(openRun.boostApplied).toBe(SCENARIO_GROUP_BOOST_G);
    expect(openRun.jobId).toBeNull();

    await closeOver(await anyAssets(3));
    const jobId = uuidv7();
    const closed = await scoped().crqIndicators.runAttackRunEngine(riskScenarioId, tenantId, undefined, undefined, jobId);
    const closedRunId = closed !== null && 'runId' in closed ? closed.runId : null;
    expect(closedRunId).not.toBeNull();

    const [closedRun] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, closedRunId!));
    expect(closedRun.jobId).toBe(jobId);
    expect(closedRun.readAt!.getTime()).toBeLessThan(closedRun.createdAt.getTime());
    expect(closedRun.estateMode).toBe('closed');
    expect(closedRun.estateAssetCount).toBe(3);
  }, 600_000);

  it('should report no boost when every asset it walked is one the scenario aims at', async () => {
    const targeted = await targetedAssets();
    expect(targeted).toHaveLength(4);
    await closeOver(targeted);

    const { runId } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
    const [run] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    expect(run.estateAssetCount).toBe(4);
    // All targets is the same weighting as no target: the boost is relative, and a run that
    // reported the constant here would credit a target that separated nothing.
    expect(run.boostApplied).toBe(1);
  }, 600_000);

  it('should start no run at all in a closed scope holding nothing', async () => {
    await scoped().organizations.updateOrganization(organizationId, { estateMode: 'closed' });

    const outcome = await scoped().crqIndicators.runAttackRunEngine(riskScenarioId, tenantId);

    expect(outcome).toEqual({ skipped: 'no-mapped-asset' });
    expect(await scoped().crqIndicators.getLatestRun(riskScenarioId)).toBeUndefined();
  }, 600_000);

  it('should skip quietly when the scenario was deleted after its run was queued', async () => {
    await scoped().riskScenarios.deleteRiskScenarios([riskScenarioId]);

    const outcome = await scoped().crqIndicators.runAttackRunEngine(riskScenarioId, tenantId);

    expect(outcome).toEqual({ skipped: 'no-scenario' });
  }, 600_000);

  describe('a declared estate', () => {
    const declare = async (answers: Array<{ kind: 'workstations' | 'servers' | 'people', low: number, high: number, internetFacing?: boolean }>) => {
      await scoped().declaredEstate.saveDeclaredEstate(organizationId, answers.map(({ kind, low, high, internetFacing }) =>
        ({ kind, bounds: { low, high }, internetFacing: internetFacing ?? null })));
    };
    const storedRun = async (runId: string) => (await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId)))[0];

    it('should price a closed scope that maps no asset but declares its estate', async () => {
      await scoped().organizations.updateOrganization(organizationId, { estateMode: 'closed' });
      await declare([{ kind: 'workstations', low: 251, high: 1000 }, { kind: 'servers', low: 11, high: 50, internetFacing: true }, { kind: 'people', low: 251, high: 1000 }]);

      const { runId, result, reach } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);

      expect(reach.estateAssetCount).toBe(0);
      expect(result.vulnerability.mean).toBeGreaterThan(0);
      const run = await storedRun(runId);
      expect(run.declaredAssetCount).toBeGreaterThan(0);
      expect(run.declaredAssetShare).toBe(1);
    }, 600_000);

    it('should read a closed scope that maps nothing as priceable once it declares its estate', async () => {
      await scoped().organizations.updateOrganization(organizationId, { estateMode: 'closed' });
      await declare([{ kind: 'servers', low: 11, high: 50 }]);

      const [overview] = await scoped().riskScenarios.getRiskScenariosOverview(organizationId);
      expect(overview.readiness.status).not.toBe('no-mapped-asset');
      expect(await scoped().organizations.getOrganization(organizationId)).toMatchObject({ mappedAssetCount: 0, noMappedAsset: false });
      expect((await scoped().organizations.getOrganizations()).find((row) => row.id === organizationId)).toMatchObject({ noMappedAsset: false });
      expect((await scoped().dashboard.getScenarioSummaries(organizationId)).every((summary) => !summary.noMappedAsset)).toBe(true);
    }, 600_000);

    it('should complete the measured estate up to the low bound, and add nothing where it already reaches it', async () => {
      const measured = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
      expect((await storedRun(measured.runId)).declaredAssetCount).toBeNull();

      await declare([{ kind: 'workstations', low: 1, high: 10 }]);
      const reached = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
      expect(reached.reach.declared).toEqual({ assetCount: 0, assetShare: 0 });
      expect(reached.result).toEqual(measured.result);

      await declare([{ kind: 'servers', low: 40, high: 40 }]);
      const completed = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
      expect(completed.reach.estateAssetCount).toBe(measured.reach.estateAssetCount);
      expect(completed.reach.declared?.assetCount).toBe(40);
      expect(completed.result.vulnerability.mean).not.toBe(measured.result.vulnerability.mean);
    }, 600_000);
  });

  it('should read the scenario as unpriceable while its scope maps nothing', async () => {
    await scoped().organizations.updateOrganization(organizationId, { estateMode: 'closed' });

    const [overview] = await scoped().riskScenarios.getRiskScenariosOverview(organizationId);
    expect(overview.readiness.status).toBe('no-mapped-asset');

    await closeOver(await anyAssets(1));
    const [remapped] = await scoped().riskScenarios.getRiskScenariosOverview(organizationId);
    expect(remapped.readiness.status).not.toBe('no-mapped-asset');
  }, 600_000);
});

describe('the attack run engine and the paths an attack takes', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const storedRunOf = async (
    attackOutcome?: string,
    { unlinked = false, actorTechniquesOmitted, assets }: { unlinked?: boolean } & Pick<AttackRunScenarioOptions, 'actorTechniquesOmitted' | 'assets'> = {},
  ) => {
    const { riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId, { attackOutcome, actorTechniquesOmitted, assets });
    if (unlinked) {
      await db.delete(supportToPrimaryLinks);
    }
    const { runId } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
    const [run] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    return run;
  };

  it('should store path shares summing to one, and a target', async () => {
    const run = await storedRunOf();

    const shares = [run.pathShareStoppedAtInitialAccess, run.pathShareDirect, run.pathShareLong, run.pathShareWithoutInitialAccess];
    expect(shares.every((share) => share !== null)).toBe(true);
    expect(shares.reduce((sum, share) => sum! + share!, 0)).toBeCloseTo(1, 9);
    expect(run.noTarget).toBe(false);
    expect(run.pathShareWithoutInitialAccess).toBe(0);
  }, 600_000);

  it('should record no target and no direct path when the primary asset has no supporting asset', async () => {
    const run = await storedRunOf(undefined, { unlinked: true });

    expect(run.noTarget).toBe(true);
    expect(run.pathShareDirect).toBe(0);
  }, 600_000);

  it('should play the direct path when an exposed flawed asset supports the primary asset, and stop once it no longer does', async () => {
    const { riskScenarioId, primaryAssetId, assetIdByName } = await seedAttackRunScenario(services, adminOrigin, tenantId, EXPOSED_ESTATE);
    const storedRunTargeting = async (assetName?: string) => {
      // The fixture links the crown jewels too: unlinking them leaves the asset named below the only target.
      await db.delete(supportToPrimaryLinks);
      if (assetName !== undefined) {
        await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: assetIdByName.get(assetName)!, primaryAssetId }]);
      }
      const { runId } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
      const [run] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
      return run;
    };

    const listedFlaw = await storedRunTargeting('Web server 1');
    const minorFlaw = await storedRunTargeting('Web server 2');
    const unlinked = await storedRunTargeting();

    expect(listedFlaw.noTarget).toBe(false);
    // Both servers share the family's unknown flaw floor: only the target's own finding sets them apart.
    expect(listedFlaw.pathShareDirect!).toBeGreaterThan(minorFlaw.pathShareDirect!);
    expect(unlinked.noTarget).toBe(true);
    expect(unlinked.pathShareDirect).toBe(0);
  }, 600_000);

  it('should send every attack of a service disruption around initial access, and price it on an exposed host, with no actor documenting T1498 or T1499', async () => {
    const run = await storedRunOf(AttackOutcome_ServiceDisruption, { actorTechniquesOmitted: ['T1498', 'T1499'], assets: EXPOSED_ESTATE.assets });

    expect(run.pathShareWithoutInitialAccess).toBeCloseTo(1, 9);
    expect(run.vulnerabilityMean).toBeGreaterThan(0);
    expect(run.pathShareStoppedAtInitialAccess).toBeCloseTo(0, 9);
    expect(run.pathShareDirect).toBe(0);
    expect(run.pathShareLong).toBe(0);
    const actors = await db.select().from(crqIndicatorGroupScores).where(eq(crqIndicatorGroupScores.runId, run.id));
    expect(actors.length).toBeGreaterThan(0);
    expect(actors.every((actor) => actor.reactionTimeExceededShare === null)).toBe(true);
  }, 600_000);

  it('should report T1498 and T1499 as uncovered with no control, and as covered once a DDoS control contests them', async () => {
    const floods = ['T1498', 'T1499'];
    const { riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId, {
      attackOutcome: AttackOutcome_ServiceDisruption,
      actorTechniquesOmitted: floods,
      assets: EXPOSED_ESTATE.assets,
      posture: false,
    });
    const runOf = async () => {
      const { runId } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
      const [run] = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
      const gaps = await db.selectDistinct({ externalId: mitreTechniques.externalId })
        .from(crqIndicatorRunReachGaps)
        .innerJoin(mitreTechniques, eq(mitreTechniques.id, crqIndicatorRunReachGaps.mitreTechniqueId))
        .where(and(eq(crqIndicatorRunReachGaps.runId, runId), eq(crqIndicatorRunReachGaps.gap, 'estate'), inArray(mitreTechniques.externalId, floods)))
        .orderBy(asc(mitreTechniques.externalId));
      return { run, uncontested: gaps.map((gap) => gap.externalId) };
    };

    const bare = await runOf();
    const [ddos] = await db.select({ id: controlCapabilities.id }).from(controlCapabilities).where(eq(controlCapabilities.externalId, 'DDOS'));
    await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(ddos.id, 'L2', 'L2', null);
    const covered = await runOf();

    expect(bare.uncontested).toEqual(floods);
    expect(bare.run.coveredTechniqueCount).toBe(0);
    expect(covered.uncontested).toEqual([]);
    expect(covered.run.techniqueCount).toBe(bare.run.techniqueCount);
    // DDOS also detects seven of the other techniques the actors play.
    expect(covered.run.coveredTechniqueCount).toBe(floods.length + 7);
  }, 600_000);

  it('should price a service disruption at nothing when no asset is exposed, the unknown ones counting as internal by default', async () => {
    const run = await storedRunOf(AttackOutcome_ServiceDisruption, { actorTechniquesOmitted: ['T1498', 'T1499'] });

    expect(run.pathShareWithoutInitialAccess).toBeCloseTo(1, 9);
    expect(run.vulnerabilityMean).toBe(0);
  }, 600_000);

  it('should price a service disruption on an unknown-exposure host once the tenant counts unknown as internet-facing', async () => {
    const assets: AttackRunScenarioOptions['assets'] = [{ name: 'Gateway', categoryId: 'host', exposure: 'unknown', criticality: 'medium', count: 1 }];
    const internal = await storedRunOf(AttackOutcome_ServiceDisruption, { assets });
    expect(internal.vulnerabilityMean).toBe(0);

    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: 'internet_facing' });
    const exposed = await storedRunOf(AttackOutcome_ServiceDisruption, { assets });
    expect(exposed.vulnerabilityMean).toBeGreaterThan(0);
  }, 600_000);

  it('should send a floor of financial fraud attacks around initial access, and price it, with no actor documenting T1657', async () => {
    const run = await storedRunOf(AttackOutcome_FinancialFraudFundsTheft, { actorTechniquesOmitted: ['T1657'] });

    expect(run.pathShareWithoutInitialAccess).toBeCloseTo(0.05, 9);
    expect(run.vulnerabilityMean).toBeGreaterThan(0);
  }, 600_000);

  it('should send no data breach attack around initial access', async () => {
    const run = await storedRunOf(AttackOutcome_DataBreachResale);

    expect(run.pathShareWithoutInitialAccess).toBe(0);
  }, 600_000);
});
