import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { recomputeAttackOutcomeMixtures } from '../../helpers/attack-outcome-mixtures';
import { buildActor, EXPOSED_ESTATE, runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

/**
 * The wire contract of an engine run. Zod strips what the output schema does not declare, so a
 * key missing here never reaches a screen whatever the database holds: this is where the surface
 * obligations are checked to actually cross the boundary.
 */
describe('CRQ run payload (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let origin: EventOrigin;
  let riskScenarioId: string;
  let runId: string;

  // Built once because every assertion below only reads this run. A test that writes belongs in
  // another file, or this hook goes back to `beforeEach` and pays for a simulation per test.
  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Payload Tenant' }, adminId);

    origin = { type: 'client', userId: adminId, tenantId };
    // The default estate exposes nothing, so most worlds lose nothing and the ALE band has no width.
    ({ riskScenarioId } = await seedAttackRunScenario(services, origin, tenantId, EXPOSED_ESTATE));
    // A second actor of the ransomware crew's class, so the run admits more actors than it stores attacker rows.
    await services.withOrigin(origin).threatAnalyses.ingestBundle([
      buildActor('conti', 'Second ransomware crew', ['T1566', 'T1059', 'T1003', 'T1021', 'T1486']),
    ], tenantId, 'stix-import');
    await recomputeAttackOutcomeMixtures(services, tenantId);
    ({ runId } = await runAttackRun(services, origin, riskScenarioId, tenantId));
  }, 600_000);

  it('carries the outcome split, the vintages, the reach counts and the corners on the run', async () => {
    const res = await client.query('crqIndicators.getLatestRun', { riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    const run = res.json.result.data;
    expect(run.id).toBe(runId);
    expect(run.outcomeBlocked + run.outcomeEvicted + run.outcomeImpactDetected + run.outcomeImpactUndetected).toBeCloseTo(1, 10);
    expect(run.calibrationVintage).toMatch(/^replay-/);
    expect(run.catalogueVintage).toContain('attack-enterprise');
    expect(run.cornerConstants.length).toBeGreaterThan(0);
    expect(run.uncontestedPairCount).toBeGreaterThanOrEqual(0);
    expect(run.uncontestablePairCount).toBeGreaterThanOrEqual(0);
    // The two exposed servers carry findings.
    expect(run.unscannedAssetCount).toBe(run.estateAssetCount - 2);
    expect(run.aleAtMemorylessDetection).toBeGreaterThan(0);
    expect(run.threatEvidenceMode).toBe('attacker-mixture');
    expect(run.admittedActorCount).toBe(3);
    expect(run.tefLikely).toBe(1.5);
    expect(run).not.toHaveProperty('engine');
    expect(run).not.toHaveProperty('sleP50');
    expect(run).not.toHaveProperty('aleP50');
    expect(run.aleP10).toBeLessThan(run.aleP90);
  });

  it('ships the actors, the signed technique values, the reach gaps and the unplayable obstacles on the run detail', async () => {
    const res = await client.query('crqIndicators.getRunWithScores', { runId }, { tenantId });

    expect(res.status).toBe(200);
    const detail = res.json.result.data;
    expect(detail).not.toHaveProperty('techniqueScores');

    expect(detail.groupScores).toHaveLength(2);
    expect(detail.groupScores.map((actor: { actorClass: string }) => actor.actorClass).toSorted()).toEqual(['ransomware_operator', 'state_sponsored']);
    for (const actor of detail.groupScores) {
      expect(actor.groupName).toBeNull();
      expect(actor.groupEntityType).toBeNull();
      expect(actor.attackRunDays).toBeGreaterThan(0);
      expect(actor.reactionTimeExceededShare).toBeGreaterThanOrEqual(0);
    }

    expect(detail.techniqueWhatIfResults.length).toBe(detail.techniqueCount);
    const values: Array<{ externalId: string, preventValueMean: number, detectValueMean: number }> = detail.techniqueWhatIfResults;
    const total = (value: typeof values[number]): number => value.preventValueMean + value.detectValueMean;
    for (let index = 1; index < values.length; index += 1) {
      expect(total(values[index - 1])).toBeGreaterThanOrEqual(total(values[index]));
    }
    for (const value of values) {
      expect(value.externalId).toMatch(/^T\d{4}$/);
      expect(value.preventValueMean).toBeGreaterThanOrEqual(0);
      expect(value.detectValueMean).toBeGreaterThanOrEqual(0);
    }

    const gaps: Array<{ gap: string, externalId: string, family: string, name: string }> = detail.reachGaps;
    expect(gaps.filter((gap) => gap.gap === 'estate')).toHaveLength(detail.uncontestedPairCount);
    expect(gaps.filter((gap) => gap.gap === 'catalogue')).toHaveLength(detail.uncontestablePairCount);
    expect(gaps.every((gap) => gap.externalId.length > 0 && gap.family.length > 0 && gap.name.length > 0)).toBe(true);

    const obstacles: Array<{ groupKey: string | null, obstacleKey: string }> = detail.unplayableObstacles;
    const obstaclePairs = obstacles.map((obstacle) => `${obstacle.groupKey}|${obstacle.obstacleKey}`);
    expect(new Set(obstaclePairs).size).toBe(obstaclePairs.length);
    expect(obstacles.every((obstacle) => obstacle.groupKey !== null && obstacle.obstacleKey.length > 0)).toBe(true);
  });

  it('returns the control levers with their spread and their zero reason', async () => {
    const res = await client.query('crqIndicators.getWhatIfResults', { riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    const rows: Array<{ dimension: string, aleReductionMean: number, aleReductionP10: number, aleReductionP90: number, zeroReason: string | null }> = res.json.result.data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.aleReductionMean > 0)).toBe(true);
    expect(rows.every((row) => row.aleReductionP10 <= row.aleReductionP90)).toBe(true);
    expect(rows[0]).not.toHaveProperty('lefReduction');
  });
});
