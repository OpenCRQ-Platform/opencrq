import type { EventOrigin } from '@app/module';
import { BusinessValueCategory_PersonalData, deriveSeedId, scenarioLossEstimates } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_ANSWERS, FULLY_ANSWERED_PROFILE_ANSWERS } from '../../helpers/financial-profile-answers';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const FINANCIAL_ESTIMATES_RECOMPUTE_JOB = 'financial-estimates-recompute';
const CRQ_SIMULATION_JOB = 'crq-simulation';

describe('Scenario Loss Estimates & Financial Profiles triggers (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let adminId: string;
  let organizationId: string;
  let riskScenarioId: string;
  let lossDriverId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Financial Onboarding Tenant' }, adminId);

    const origin = { type: 'client' as const, userId: adminId, tenantId };
    organizationId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Test Org' }]);

    const attackOutcomes = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
    const attackOutcomeId = attackOutcomes[0].id;
    riskScenarioId = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Scenario under test',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });

    const lossDrivers = await services.withOrigin(origin).lossDrivers.getLossDrivers();
    lossDriverId = lossDrivers[0].id;
  });

  it('round-trips a set entry through the HTTP boundary, including the coerced updatedAt', async () => {
    const firstRes = await client.mutation('scenarioLossEstimates.upsertScenarioLossEstimates', {
      riskScenarioId,
      estimates: [{ lossDriverId, action: 'set', minValue: 10_000, likelyValue: 20_000, maxValue: 40_000 }],
      updatedAt: null,
      rowCount: 0,
    }, { tenantId });
    expect(firstRes.status).toBe(200);

    const readRes = await client.query('scenarioLossEstimates.getScenarioLossEstimates', { riskScenarioId }, { tenantId });
    expect(readRes.status).toBe(200);
    const [row] = readRes.json.result.data;
    expect(row.provenance).toBe('manual');
    expect(row.lowConfidence).toBe(false);

    // The client reads updatedAt back as a JSON string; sending it straight back must round-trip.
    const secondRes = await client.mutation('scenarioLossEstimates.upsertScenarioLossEstimates', {
      riskScenarioId,
      estimates: [{ lossDriverId, action: 'set', minValue: 15_000, likelyValue: 20_000, maxValue: 40_000 }],
      updatedAt: row.updatedAt,
      rowCount: 1,
    }, { tenantId });
    expect(secondRes.status).toBe(200);
  });

  it('rejects a stale fingerprint over HTTP', async () => {
    const firstRes = await client.mutation('scenarioLossEstimates.upsertScenarioLossEstimates', {
      riskScenarioId,
      estimates: [{ lossDriverId, action: 'set', minValue: 1, likelyValue: 2, maxValue: 3 }],
      updatedAt: null,
      rowCount: 0,
    }, { tenantId });
    expect(firstRes.status).toBe(200);

    // Still claiming the empty scenario it first read, though a row now exists.
    const res = await client.mutation('scenarioLossEstimates.upsertScenarioLossEstimates', {
      riskScenarioId,
      estimates: [{ lossDriverId, action: 'set', minValue: 5, likelyValue: 6, maxValue: 7 }],
      updatedAt: null,
      rowCount: 0,
    }, { tenantId });

    expect(res.status).toBe(409);
    expect(res.json.error.data.reason).toBe('STALE_WRITE');
  });

  it('answers a precondition failure over HTTP when a driver to revert has no derived figure', async () => {
    const res = await client.mutation('scenarioLossEstimates.upsertScenarioLossEstimates', {
      riskScenarioId,
      estimates: [],
      updatedAt: null,
      rowCount: 0,
      revertLossDriverIds: [lossDriverId],
    }, { tenantId });

    expect(res.json.error.data.code).toBe('PRECONDITION_FAILED');
  });

  it('should ask for a scenario\'s estimates straight away when it is created over HTTP', async () => {
    const origin = { type: 'client' as const, userId: adminId, tenantId };
    const attackOutcomes = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
    const newScenarioId = uuidv7();

    const res = await client.mutation('riskScenarios.createRiskScenario', {
      id: newScenarioId,
      organizationId,
      name: 'Freshly created scenario',
      description: null,
      attackOutcomeId: attackOutcomes[0].id,
      primaryAssetIds: [],
    }, { tenantId });
    expect(res.status).toBe(200);

    const jobs = await services.withOrigin(origin)
      .jobs.listJobs({ tenantId, kind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ riskScenarioId: newScenarioId });
  });

  // The whole point of asking at creation: the analyst opens Financial Impact on a scenario the
  // wizard just made and finds it priced. Covers the chain end to end — the router's ask, and the
  // amounts the job it books actually writes.
  it('should price a scenario created over HTTP from the scope\'s questionnaire answers', async () => {
    const origin = { type: 'client' as const, userId: adminId, tenantId };
    const scoped = services.withOrigin(origin);

    await scoped.organizations.updateOrganization(organizationId, { employeeCount: 150 });
    await scoped.financialProfiles.saveFinancialProfile(organizationId, FULLY_ANSWERED_PROFILE_ANSWERS);

    // An activated driver needs a primary asset carrying a business value category: without one the
    // scenario's activation set is empty and the derivation has nothing to price.
    const primaryAssetId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: primaryAssetId,
      organizationId,
      name: 'CRM',
      description: null,
      ownerId: null,
      businessValueCategoryIds: [deriveSeedId(tenantId, BusinessValueCategory_PersonalData)],
    });

    const attackOutcomes = await scoped.attackOutcomes.getAttackOutcomes();
    const newScenarioId = uuidv7();
    const res = await client.mutation('riskScenarios.createRiskScenario', {
      id: newScenarioId,
      organizationId,
      name: 'Priced at creation',
      description: null,
      attackOutcomeId: attackOutcomes[0].id,
      primaryAssetIds: [primaryAssetId],
    }, { tenantId });
    expect(res.status).toBe(200);

    // Nothing is priced yet: the router books the work, it does not do it.
    const beforeRun = await client.query('scenarioLossEstimates.getScenarioLossEstimates', { riskScenarioId: newScenarioId }, { tenantId });
    expect(beforeRun.json.result.data).toHaveLength(0);

    const [job] = await scoped.jobs.listJobs({ tenantId, kind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB });
    expect(job.payload).toEqual({ riskScenarioId: newScenarioId });

    // What the handler does with that payload. `changed` is the flag it books the CRQ run on, so a
    // scenario priced from nothing must report it: that is what gives the analyst an ALE without
    // having to ask for one.
    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, interactive: false };
    const { recomputed, changed } = await services.withOrigin(jobOrigin)
      .scenarioLossEstimates.recomputeQuestionnaireEstimatesForScenario(newScenarioId);
    expect(recomputed).toBe(true);
    expect(changed).toBe(true);

    const afterRun = await client.query('scenarioLossEstimates.getScenarioLossEstimates', { riskScenarioId: newScenarioId }, { tenantId });
    const rows = afterRun.json.result.data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row: { provenance: string }) => row.provenance === 'questionnaire')).toBe(true);
    expect(rows.some((row: { likelyValue: number | null }) => row.likelyValue !== null && row.likelyValue > 0)).toBe(true);
  });

  // The notice rides on the summary, not on a read of its own: a separate query reading `jobs`
  // refetched on every unrelated job of the tenant and cleared itself long before the amounts on
  // screen were refreshed.
  const recomputePending = async (scenarioId: string = riskScenarioId) => {
    const res = await client.query('scenarioLossEstimates.getFinancialSummary', { riskScenarioId: scenarioId }, { tenantId });
    expect(res.status).toBe(200);
    return res.json.result.data.recomputePending;
  };

  const answerTheQuestionnaire = async () => {
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .financialProfiles.saveFinancialProfile(organizationId, EMPTY_ANSWERS);
  };

  // The tenant-wide sweep, which is what a questionnaire save actually resolves to: the dispatcher
  // can only ask for a whole tenant, and only a run that covered every scenario of the profile may
  // clear the notice.
  const runTheRecompute = async () => {
    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, interactive: false };
    await services.withOrigin(jobOrigin).scenarioLossEstimates.recomputeQuestionnaireEstimates({});
  };

  it('should report nothing pending for a scope that never answered the questionnaire', async () => {
    expect(await recomputePending()).toBe(false);
  });

  it('should report pending from the save until a recompute has derived the answers', async () => {
    await answerTheQuestionnaire();
    expect(await recomputePending()).toBe(true);

    await runTheRecompute();
    expect(await recomputePending()).toBe(false);
  });

  it('should clear the notice even when the recompute found every amount unchanged', async () => {
    // The guard against keying the notice on the rows' own timestamps: a recompute that changes no
    // value writes no row, and a timestamp comparison would stay pending for good.
    await answerTheQuestionnaire();
    await runTheRecompute();
    await runTheRecompute();

    expect(await recomputePending()).toBe(false);
  });

  it('should report pending again when the answers change after a recompute', async () => {
    await answerTheQuestionnaire();
    await runTheRecompute();
    expect(await recomputePending()).toBe(false);

    await answerTheQuestionnaire();
    expect(await recomputePending()).toBe(true);
  });

  const declare = async (kind: 'workstations' | 'iot_ot_devices', bounds: { low: number, high: number } | null) => {
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .declaredEstate.saveDeclaredEstate(organizationId, [{ kind, bounds, internetFacing: null }]);
  };

  it('should report pending when the declared workstations change, and when they are cleared', async () => {
    await answerTheQuestionnaire();
    await runTheRecompute();

    await declare('workstations', { low: 1_001, high: 5_000 });
    expect(await recomputePending()).toBe(true);
    await runTheRecompute();
    expect(await recomputePending()).toBe(false);

    await declare('workstations', null);
    expect(await recomputePending()).toBe(true);
  });

  it('should not report pending when a kind the losses never read changes', async () => {
    await answerTheQuestionnaire();
    await runTheRecompute();

    await declare('iot_ot_devices', { low: 11, high: 50 });
    expect(await recomputePending()).toBe(false);
  });

  it('should clear the scenario it recomputed and leave a sibling it has not reached pending', async () => {
    // Each scenario answers for itself: the one just derived describes its amounts as current,
    // while the sibling nothing has redone still says so. A marker on the profile could only give
    // both the same answer, and gave the wrong one to whichever page the reader was on.
    const origin = { type: 'client' as const, userId: adminId, tenantId };
    const attackOutcomes = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
    const siblingId = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: siblingId,
      organizationId,
      name: 'Sibling scenario',
      description: null,
      attackOutcomeId: attackOutcomes[0].id,
      primaryAssetIds: [],
    });

    await answerTheQuestionnaire();
    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, interactive: false };
    await services.withOrigin(jobOrigin).scenarioLossEstimates.recomputeQuestionnaireEstimatesForScenario(riskScenarioId);
    expect(await recomputePending()).toBe(false);
    expect(await recomputePending(siblingId)).toBe(true);

    await runTheRecompute();
    expect(await recomputePending(siblingId)).toBe(false);
  });

  // The recompute reads `risk_scenarios` and now writes it too, so the dispatcher books it again on
  // its own stamp. Convergence is what keeps that from running for ever: the second pass finds the
  // version already recorded, writes no row, and the change trigger — which fires per row — stays
  // silent.
  it('should stamp nothing on a second recompute that found the same answers', async () => {
    await answerTheQuestionnaire();
    await runTheRecompute();

    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, interactive: false };
    const jobScoped = services.withOrigin(jobOrigin);
    const answersVersion = await jobScoped.financialProfiles.getAnswersVersion(organizationId);

    expect(await jobScoped.riskScenarios.markEstimatesDerived(riskScenarioId, answersVersion!)).toBe(false);
  });

  it('should not let a recompute clear a save that landed while it ran', async () => {
    // The derivation's two ends, played apart with a save in between: it reads the answer version
    // before any input it derives from and stamps that version once done, so a save committing in
    // between leaves the stamp behind the answers and the notice up. Played rather than driven
    // because the service container hands out wrapped methods, leaving no seam to commit a save
    // inside a real run; what the ordering itself rests on is the comment at that call site.
    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, interactive: false };
    const jobScoped = services.withOrigin(jobOrigin);
    await answerTheQuestionnaire();

    const answersVersion = await jobScoped.financialProfiles.getAnswersVersion(organizationId);
    await answerTheQuestionnaire();
    await jobScoped.riskScenarios.markEstimatesDerived(riskScenarioId, answersVersion!);

    expect(await recomputePending()).toBe(true);
  });

  it('should leave the notice up when the sweep only backfilled', async () => {
    // A backfill leaves already-derived rows alone, so it has refreshed nothing it could vouch for.
    await answerTheQuestionnaire();
    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, interactive: false };
    await services.withOrigin(jobOrigin).scenarioLossEstimates.recomputeQuestionnaireEstimates({ backfillOnly: true });

    expect(await recomputePending()).toBe(true);
  });

  // The analyst is editing these figures by hand and decides when they are worth pricing, so the
  // scenario's readiness item invites the run rather than one being booked behind them.
  it('should book no CRQ run when the analyst upserts estimates by hand', async () => {
    await client.mutation('scenarioLossEstimates.upsertScenarioLossEstimates', {
      riskScenarioId,
      estimates: [{ lossDriverId, action: 'set', minValue: 10_000, likelyValue: 20_000, maxValue: 40_000 }],
      updatedAt: null,
      rowCount: 0,
    }, { tenantId });

    const jobs = await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .jobs.listJobs({ tenantId, kind: CRQ_SIMULATION_JOB });
    expect(jobs).toEqual([]);
  });

  it('should book no CRQ run when the analyst takes a row back to its computed value', async () => {
    const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });
    await scoped.organizations.updateOrganization(organizationId, { employeeCount: 150 });
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
    await runTheRecompute();

    const automatic = await client.query('scenarioLossEstimates.getAutomaticEstimates', { riskScenarioId }, { tenantId });
    const derivedDriverId: string = automatic.json.result.data[0].lossDriverId;
    const fingerprint = async () => {
      const rows: Array<{ updatedAt: string }> = (await client.query('scenarioLossEstimates.getScenarioLossEstimates', { riskScenarioId }, { tenantId })).json.result.data;
      const updatedAt = rows.reduce<string | null>((max, row) => (max === null || row.updatedAt > max ? row.updatedAt : max), null);
      return { updatedAt, rowCount: rows.length };
    };
    const manualRes = await client.mutation('scenarioLossEstimates.upsertScenarioLossEstimates', {
      riskScenarioId,
      estimates: [{ lossDriverId: derivedDriverId, action: 'set', minValue: 1, likelyValue: 2, maxValue: 3 }],
      ...(await fingerprint()),
    }, { tenantId });
    expect(manualRes.status).toBe(200);
    const jobsBefore = await scoped.jobs.listJobs({ tenantId, kind: CRQ_SIMULATION_JOB });

    const revertRes = await client.mutation('scenarioLossEstimates.upsertScenarioLossEstimates', {
      riskScenarioId,
      estimates: [],
      ...(await fingerprint()),
      revertLossDriverIds: [derivedDriverId],
    }, { tenantId });

    expect(revertRes.status).toBe(200);
    const rows: Array<{ lossDriverId: string, provenance: string }> = (await client.query('scenarioLossEstimates.getScenarioLossEstimates', { riskScenarioId }, { tenantId })).json.result.data;
    expect(rows.find((row) => row.lossDriverId === derivedDriverId)?.provenance).toBe('questionnaire');
    expect(await scoped.jobs.listJobs({ tenantId, kind: CRQ_SIMULATION_JOB })).toEqual(jobsBefore);
  });

  // What the analyst asked for: a questionnaire save re-prices the scope's scenarios, and the CRQ
  // figures must follow rather than invite a manual Run.
  it('should re-simulate only the scenarios whose amounts the recompute actually moved', async () => {
    const origin = { type: 'client' as const, userId: adminId, tenantId };
    const scoped = services.withOrigin(origin);

    await scoped.organizations.updateOrganization(organizationId, { employeeCount: 150 });
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

    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, interactive: false };
    const first = await services.withOrigin(jobOrigin).scenarioLossEstimates.recomputeQuestionnaireEstimates({});
    expect(first.changedScenarioIds).toContain(riskScenarioId);

    // Immediately again, on answers nobody touched: every derived value matches, so nothing is
    // rewritten and nothing is re-simulated.
    const second = await services.withOrigin(jobOrigin).scenarioLossEstimates.recomputeQuestionnaireEstimates({});
    expect(second.recomputedScenarios).toBeGreaterThan(0);
    expect(second.changedScenarioIds).toEqual([]);
  });

  it('should not re-simulate a scenario whose rows only moved coefficient set', async () => {
    // The write plan rewrites a row when the model version alone differs. The amounts the ALE
    // prices have not moved, so a coefficient-set bump must not book a run for every scenario.
    const origin = { type: 'client' as const, userId: adminId, tenantId };
    const scoped = services.withOrigin(origin);
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

    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, interactive: false };
    const first = await services.withOrigin(jobOrigin).scenarioLossEstimates.recomputeQuestionnaireEstimates({});
    expect(first.changedScenarioIds).toContain(riskScenarioId);

    await db.update(scenarioLossEstimates)
      .set({ modelVersion: 'an-older-coefficient-set' })
      .where(eq(scenarioLossEstimates.riskScenarioId, riskScenarioId));

    const second = await services.withOrigin(jobOrigin).scenarioLossEstimates.recomputeQuestionnaireEstimates({});
    expect(second.recomputedScenarios).toBeGreaterThan(0);
    expect(second.changedScenarioIds).toEqual([]);
  });

  it('saving a financial profile books no recompute job by hand', async () => {
    const res = await client.mutation('financialProfiles.saveFinancialProfile', {
      organizationId,
      answers: EMPTY_ANSWERS,
    }, { tenantId });
    expect(res.status).toBe(200);

    // `financial_profiles` is in the observed job's read set, so this write already wakes it
    // through the recompute dispatcher. A hand-written enqueue here would be a second trigger,
    // and the one that forgets when a new input path appears.
    const jobs = await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .jobs.listJobs({ tenantId, kind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB });
    expect(jobs).toHaveLength(0);
  });
});
