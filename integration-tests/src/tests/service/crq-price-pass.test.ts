import type { EventOrigin, ScenarioPricingPassOptions } from '@app/module';
import { assetEvidence, attackOutcomeMixtures, controlCapabilities, crqBudgetReviewResults, crqIndicatorRuns, deriveSeedId, InputsNotReadyError, LossDriver_LostMarginFromDowntime, organizations, supportingAssetRelations, supportingAssets, threatAnalyses } from '@app/module';
import { and, desc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recomputeAttackOutcomeMixtures } from '../../helpers/attack-outcome-mixtures';
import { createTenantWithAdmin } from '../../helpers/factories';
import { seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { heldCveFeeds } from '../../helpers/held-cve-feeds';

const services = createTestServices(db);

describe('CRQ price pass over unchanged inputs', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 50 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const seed = async (options: { losses?: boolean } = {}) => {
    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId, options));
  };

  const pass = (options: ScenarioPricingPassOptions = {}) => services
    .withOrigin({ type: 'job', tenantId, jobKind: 'crq-price-recompute', interactive: false })
    .crqIndicators.priceAllScenarios(tenantId, undefined, undefined, options);

  const runCount = async () => (await db.select({ id: crqIndicatorRuns.id }).from(crqIndicatorRuns)
    .where(eq(crqIndicatorRuns.riskScenarioId, riskScenarioId))).length;

  it('should write no run for a scenario whose inputs did not change since its latest run', async () => {
    await seed();
    expect(await pass()).toMatchObject({ priced: 1, unchanged: 0 });

    expect(await pass()).toMatchObject({ priced: 0, unchanged: 1 });
    expect(await runCount()).toBe(1);
  });

  it('should name the scenario it re-priced, and none on a pass over unchanged inputs', async () => {
    await seed();
    const progress: Array<{ walked: number, total: number }> = [];

    const onProgress = (update: { walked: number, total: number }) => {
      progress.push(update);
      return Promise.resolve();
    };

    expect(await pass({ onProgress }))
      .toMatchObject({ priced: 1, moved: [riskScenarioId], walked: 1, total: 1 });
    expect(progress).toEqual([{ walked: 0, total: 1 }]);

    expect(await pass()).toMatchObject({ priced: 0, unchanged: 1, moved: [], walked: 1, total: 1 });
  });

  it('should still write the run of a manual simulation over unchanged inputs', async () => {
    await seed();
    await pass();

    const outcome = await services.withOrigin(adminOrigin).crqIndicators.runAttackRunEngine(riskScenarioId, tenantId);

    expect(outcome).toHaveProperty('runId');
    expect(await runCount()).toBe(2);
  });

  const scoped = () => services.withOrigin(adminOrigin);

  /** The fixture's actors carry no activity date, so neither the day nor a half-life moves their shares. */
  const dateOneActor = () => db.update(threatAnalyses)
    .set({ lastObservedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
    .where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.name, 'Ransomware crew')));

  /** A capability the scenario's run is priced against, so its posture is one of the run's inputs. */
  const capabilityPricedHere = async () => {
    const capabilities = await db.select({ id: controlCapabilities.id }).from(controlCapabilities).orderBy(controlCapabilities.id);
    for (const { id } of capabilities) {
      const priced = await scoped().crqIndicators.getScenariosPricedAgainstCapabilities([id], organizationId, tenantId);
      if (priced.some((scenario) => scenario.riskScenarioId === riskScenarioId)) {
        return id;
      }
    }
    throw new Error('no capability plays in the fixture scenario');
  };

  const raiseDowntimeLoss = async () => {
    const current = await scoped().scenarioLossEstimates.getScenarioLossEstimates(riskScenarioId);
    await scoped().scenarioLossEstimates.upsertScenarioLossEstimates(riskScenarioId, [
      { lossDriverId: deriveSeedId(tenantId, LossDriver_LostMarginFromDowntime), action: 'set', minValue: 100_000, likelyValue: 900_000, maxValue: 3_000_000 },
    ], {
      maxUpdatedAt: current.reduce<Date | null>((latest, row) => (latest === null || row.updatedAt > latest ? row.updatedAt : latest), null),
      rowCount: current.length,
    });
  };

  const supportingAssetNamed = async (name: string) => (await db.select({ id: supportingAssets.id }).from(supportingAssets)
    .where(and(eq(supportingAssets.tenantId, tenantId), eq(supportingAssets.name, name))))[0].id;

  const changes: Array<[string, () => Promise<unknown>]> = [
    ['an asset joining the estate', () => db.insert(supportingAssets).values({
      id: uuidv7(), tenantId, name: 'Jump host', exposure: 'internet_facing', categoryId: 'host', criticality: 'high',
    })],
    ['a finding on an asset', async () => {
      await heldCveFeeds(scoped().cve).upsertCvssScores([{ cveId: 'CVE-2024-3400', cvss: 10, lastModified: '2024-04-12T00:00:00.000Z' }]);
      const flaw = await scoped().cve.getCveByCveId('CVE-2024-3400');
      await db.insert(assetEvidence).values({ id: uuidv7(), tenantId, supportingAssetId: await supportingAssetNamed('Workstation 1'), cveId: flaw!.id });
    }],
    ['a control assessment', async () => scoped().controlCapabilities.upsertAssessment(await capabilityPricedHere(), 'L3', 'L3', null)],
    ['the techniques of an actor', () => scoped().threatAnalyses.ingestBundle([{
      threat: {
        stixId: 'intrusion-set--volt',
        entityType: 'intrusion-set',
        name: 'State actor',
        description: null,
        mitreGroupId: null,
        confidence: null,
        stixCreated: null,
        firstSeen: null,
        lastSeen: null,
        primaryMotivation: null,
        resourceLevel: null,
        sophistication: null,
        objective: null,
        labels: ['state-sponsored'],
      },
      aliases: [],
      secondaryMotivations: [],
      goals: [],
      threatActorTypes: [],
      roles: [],
      attributions: [],
      locations: [],
      sectors: [],
      cves: [],
      techniques: ['T1566', 'T1190', 'T1078', 'T1059', 'T1003', 'T1021', 'T1486'].map((mitreExternalId, index) => ({
        stixId: `attack-pattern--volt-new-${index}`,
        stixRelationId: `relationship--volt-new-${index}`,
        name: `Technique ${mitreExternalId}`,
        mitreExternalId,
        producerStixId: 'identity--test-producer',
        producerName: 'Test Producer',
        isInferred: false,
        relCreated: new Date(),
        relStartTime: null,
        relStopTime: null,
        relModified: null,
        relConfidence: 80,
      })),
    }], tenantId, 'stix-import')],
    ['a loss estimate', () => raiseDowntimeLoss()],
    ['the threat event frequency', () => scoped().crqIndicators.upsertTefInput({ riskScenarioId, min: 0.5, likely: 2, max: 4 })],
    ['the CRQ settings', () => scoped().crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 60 })],
    ['the declared phishing simulation rate', () => scoped().crqIndicatorSettings.updateCrqIndicatorSettings({ phishingFailureRate: 0.2, phishingFailureMeasuredOn: '2026-09-01' })],
    ['the threat relevance settings', async () => {
      await dateOneActor();
      await recomputeAttackOutcomeMixtures(services, tenantId);
      await pass();
      const settings = await scoped().threatRelevanceSettings.getThreatRelevanceSettings();
      await scoped().threatRelevanceSettings.updateThreatRelevanceSettings({ ...settings, actHalfLifeObservedDays: settings.actHalfLifeObservedDays * 2 });
    }],
    ['the reaction time', () => db.update(organizations)
      .set({ reactionTimeMin: 2, reactionTimeLikely: 24, reactionTimeMax: 96 })
      .where(eq(organizations.id, organizationId))],
  ];

  it.each(changes)('should write a run on the pass after %s changed', async (_, change) => {
    await seed();
    await pass();

    await change();
    await recomputeAttackOutcomeMixtures(services, tenantId);
    const runsBefore = await runCount();

    expect(await pass()).toMatchObject({ priced: 1, unchanged: 0 });
    expect(await runCount()).toBe(runsBefore + 1);
  });

  it('should write no run on the pass after the same phishing simulation rate was saved again', async () => {
    await seed();
    const declaration = { phishingFailureRate: 0.2, phishingFailureMeasuredOn: '2026-09-01' };
    await scoped().crqIndicatorSettings.updateCrqIndicatorSettings(declaration);
    await pass();

    await scoped().crqIndicatorSettings.updateCrqIndicatorSettings(declaration);

    expect(await pass()).toMatchObject({ priced: 0, unchanged: 1 });
  });

  it('should write a run on the pass after the declared phishing simulation rate was cleared', async () => {
    await seed();
    await scoped().crqIndicatorSettings.updateCrqIndicatorSettings({ phishingFailureRate: 0.2, phishingFailureMeasuredOn: '2026-09-01' });
    await pass();

    await scoped().crqIndicatorSettings.updateCrqIndicatorSettings({ phishingFailureRate: null, phishingFailureMeasuredOn: null });

    expect(await pass()).toMatchObject({ priced: 1, unchanged: 0 });
  });

  it('should write a run on the pass after a person was recorded as the primary user of a device carrying a client-side flaw', async () => {
    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId, {
      cves: [{
        cveId: 'CVE-2099-0100',
        vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H',
        epss: 0.5,
        onAssets: ['Workstation 1'],
      }],
    }));
    const accountId = uuidv7();
    await db.insert(supportingAssets).values({
      id: accountId, tenantId, name: 'Nadia', exposure: 'internal', categoryId: 'identity', subcategoryId: 'user_account', criticality: 'low',
    });
    await scoped().integrationSettings.configureIntegration('microsoft_graph', null);
    const connectorId = (await scoped().integrationSettings.getConnectorId('microsoft_graph'))!;
    await pass();

    await db.insert(supportingAssetRelations).values({
      id: uuidv7(),
      tenantId,
      connectorId,
      fromAssetId: accountId,
      toAssetId: await supportingAssetNamed('Workstation 1'),
      kind: 'primary_user_of',
      source: 'entra_registered_owner',
      firstSeenAt: new Date(),
      lastReportedAt: new Date(),
    });

    expect(await pass()).toMatchObject({ priced: 1, unchanged: 0 });
  });

  const hardenThisScenario = async (planId: string) => scoped().treatmentPlans.addTreatmentPlanMoves(planId, [
    { capabilityId: await capabilityPricedHere(), targetStrengthRung: 'L3', targetCoverageBucket: 'L3' },
  ]);

  const planOnThisScenario = async () => {
    const planId = await scoped().treatmentPlans.createTreatmentPlan({ organizationId, name: 'Harden the estate' });
    await hardenThisScenario(planId);
    return planId;
  };

  it('should write a run on the pass after a treatment plan moved, for a scenario the pass runs in full', async () => {
    await seed({ losses: false });
    await pass();

    await planOnThisScenario();

    expect(await pass()).toMatchObject({ priced: 1, unchanged: 0 });
  });

  it('should write a run on the pass after a treatment plan was saved with the same moves, for a scenario the pass runs in full', async () => {
    await seed({ losses: false });
    const planId = await planOnThisScenario();
    await pass();

    await hardenThisScenario(planId);

    expect(await pass()).toMatchObject({ priced: 1, unchanged: 0 });
  });

  /** What `crq-simulation` runs: the full profile, the scope's open budget reviews priced. */
  const simulate = async () => {
    const outcome = await scoped().crqIndicators.runAttackRunEngine(riskScenarioId, tenantId, undefined, undefined, undefined, { priceBudgetReviews: true });
    if (outcome === null || 'skipped' in outcome) {
      throw new Error('the attack run engine priced nothing');
    }
    return outcome;
  };

  const openReviewOnThisScope = async () => {
    const reviewId = await scoped().budgetReviews.createBudgetReview({ organizationId, name: 'Exercice', periodStart: `${new Date().getUTCFullYear()}-01-01` });
    await scoped().budgetReviews.createBudgetReviewLine(reviewId, { name: 'EDR', nature: 'build', amountSpent: 10_000, capabilityIds: [await capabilityPricedHere()] });
  };

  it('should write no run on the pass that follows a full simulation over unchanged inputs, which leaves the plan up to date', async () => {
    await seed();
    const planId = await planOnThisScenario();
    await openReviewOnThisScope();
    const { runId } = await simulate();
    expect(await db.select().from(crqBudgetReviewResults).where(eq(crqBudgetReviewResults.runId, runId))).not.toEqual([]);

    expect(await pass()).toMatchObject({ priced: 0, unchanged: 1 });
    expect(await runCount()).toBe(1);
    expect((await scoped().treatmentPlans.getTreatmentPlanProjection(planId))!.scenarios[0])
      .toMatchObject({ state: 'priced', olderThanHeadline: false });
  });

  it('should write no run on the pass that follows a full simulation over unchanged inputs, for a scenario the pass runs in full', async () => {
    await seed({ losses: false });
    await planOnThisScenario();
    await openReviewOnThisScope();
    await simulate();

    expect(await pass()).toMatchObject({ priced: 0, unchanged: 1 });
    expect(await runCount()).toBe(1);
  });

  it('should write a run on the pass that follows a full simulation once an input changed', async () => {
    await seed();
    await simulate();

    await raiseDowntimeLoss();

    expect(await pass()).toMatchObject({ priced: 1, unchanged: 0 });
    expect(await runCount()).toBe(2);
  });

  it('should refuse a scenario whose attacker mixture is not stored yet, and price it once the job has written it', async () => {
    await seed();
    await db.delete(attackOutcomeMixtures).where(eq(attackOutcomeMixtures.tenantId, tenantId));

    const refused = await pass();

    expect(refused).toMatchObject({ priced: 0, unchanged: 0, skipped: 0 });
    expect(refused!.refused).toEqual([{
      riskScenarioId,
      reason: 'Cannot run the attack run engine: the attacker mixture of this outcome is not computed yet',
    }]);
    expect(await runCount()).toBe(0);

    await recomputeAttackOutcomeMixtures(services, tenantId);

    expect(await pass()).toMatchObject({ priced: 1, refused: [] });
    expect(await runCount()).toBe(1);
  });

  it('should signal that its inputs are not ready when a simulation meets an attacker mixture that is not stored yet', async () => {
    await seed();
    await db.delete(attackOutcomeMixtures).where(eq(attackOutcomeMixtures.tenantId, tenantId));

    await expect(simulate()).rejects.toBeInstanceOf(InputsNotReadyError);
    expect(await runCount()).toBe(0);
  });

  const latestRun = async () => (await db.select().from(crqIndicatorRuns)
    .where(eq(crqIndicatorRuns.riskScenarioId, riskScenarioId))
    .orderBy(desc(crqIndicatorRuns.createdAt), desc(crqIndicatorRuns.id)))[0];

  /** What an input the result does not depend on leaves behind: the latest run's inputs fingerprint no longer matches. */
  const moveAnInputTheResultIgnores = async () => db.update(crqIndicatorRuns)
    .set({ inputsFingerprint: 'an older read' })
    .where(eq(crqIndicatorRuns.id, (await latestRun()).id));

  it('should write a run on the pass after a release, whose code may price the same inputs differently', async () => {
    await seed();
    await pass({ appVersion: 'main-aaaaaaaa' });

    expect(await pass({ appVersion: 'main-bbbbbbbb' })).toMatchObject({ priced: 1, unchanged: 0, sameResult: 0 });
  });

  describe('a pass whose result equals the latest run\'s', () => {
    it('should store no run', async () => {
      await seed();
      await pass();
      await moveAnInputTheResultIgnores();

      expect(await pass()).toMatchObject({ priced: 0, unchanged: 0, sameResult: 1 });
      expect(await runCount()).toBe(1);
    });

    it('should skip the next pass over the same inputs before the engine', async () => {
      await seed();
      await pass();
      await moveAnInputTheResultIgnores();
      await pass();

      expect(await pass()).toMatchObject({ priced: 0, unchanged: 1, sameResult: 0 });
    });

    it('should keep the moments of the latest run, which the result has held since', async () => {
      await seed();
      await pass();
      const before = await latestRun();
      await moveAnInputTheResultIgnores();

      await pass();

      expect(await latestRun()).toEqual(before);
    });

    it('should store one price run after a full simulation, which dates its figure families older, then none', async () => {
      await seed();
      const planId = await planOnThisScenario();
      await simulate();
      await moveAnInputTheResultIgnores();

      expect(await pass()).toMatchObject({ priced: 1, sameResult: 0 });
      expect((await scoped().treatmentPlans.getTreatmentPlanProjection(planId))!.scenarios[0])
        .toMatchObject({ state: 'priced', olderThanHeadline: true });

      await moveAnInputTheResultIgnores();
      expect(await pass()).toMatchObject({ priced: 0, sameResult: 1 });
      expect(await runCount()).toBe(2);
    });

    it('should store no run for a scenario the pass runs in full', async () => {
      await seed({ losses: false });
      await planOnThisScenario();
      await pass();
      await moveAnInputTheResultIgnores();

      expect(await pass()).toMatchObject({ priced: 0, sameResult: 1 });
      expect(await runCount()).toBe(1);
    });
  });

  it('should write a run on the first pass of a new day, which the actors\' activity has decayed into', async () => {
    await seed();
    await dateOneActor();
    await recomputeAttackOutcomeMixtures(services, tenantId);
    await pass();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    await recomputeAttackOutcomeMixtures(services, tenantId);

    expect(await pass()).toMatchObject({ priced: 1, unchanged: 0 });
  });
});
