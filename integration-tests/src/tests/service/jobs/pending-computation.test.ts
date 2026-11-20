import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const RECOMPUTE_KIND = 'financial-estimates-recompute';
const SIMULATION_KIND = 'crq-simulation';
const TENANT_WIDE_KINDS = ['attack-outcome-mixture-recompute', 'crq-price-recompute'];
const simulationKey = (riskScenarioId: string) => `${SIMULATION_KIND}-${riskScenarioId}`;

describe('jobs: a computation pending for a risk scenario', () => {
  let tenantId: string;
  let origin: EventOrigin;
  let adminId: string;
  let riskScenarioId: string;

  const system = () => services.withOrigin(SYSTEM_ORIGIN).jobs;
  const isPending = (asTenantId = tenantId, asOrigin = origin) =>
    services.withOrigin(asOrigin).jobs.hasActiveComputationForScenario(asTenantId, {
      riskScenarioId,
      recomputeKind: RECOMPUTE_KIND,
      simulationKey: simulationKey(riskScenarioId),
      tenantWideKinds: TENANT_WIDE_KINDS,
    });

  const enqueueRecompute = (payload: Record<string, unknown>, jobTenantId = tenantId) =>
    system().enqueueJob({ kind: RECOMPUTE_KIND, tenantId: jobTenantId, payload });

  const enqueueSimulation = (jobTenantId = tenantId) => system().enqueueJob({
    kind: SIMULATION_KIND,
    tenantId: jobTenantId,
    payload: { riskScenarioId },
    idempotencyKey: simulationKey(riskScenarioId),
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    origin = setup.origin;
    adminId = setup.userId;
    riskScenarioId = uuidv7();
  });

  it('is not pending while no job exists', async () => {
    expect(await isPending()).toBe(false);
  });

  it('is pending for a queued recompute naming the scenario', async () => {
    await enqueueRecompute({ riskScenarioId });

    expect(await isPending()).toBe(true);
  });

  it('is pending for a queued tenant-wide recompute, which covers every scenario', async () => {
    await enqueueRecompute({});

    expect(await isPending()).toBe(true);
  });

  it('is not pending for a recompute naming another scenario', async () => {
    await enqueueRecompute({ riskScenarioId: uuidv7() });

    expect(await isPending()).toBe(false);
  });

  it('is pending for a running recompute', async () => {
    await enqueueRecompute({ riskScenarioId });
    await system().claimNext('worker-1', [RECOMPUTE_KIND], 30_000);

    expect(await isPending()).toBe(true);
  });

  it('is pending for an active simulation of the scenario', async () => {
    await enqueueSimulation();

    expect(await isPending()).toBe(true);
  });

  it('is not pending for the simulation of another scenario', async () => {
    await system().enqueueJob({
      kind: SIMULATION_KIND,
      tenantId,
      payload: { riskScenarioId: uuidv7() },
      idempotencyKey: simulationKey(uuidv7()),
    });

    expect(await isPending()).toBe(false);
  });

  it.each(TENANT_WIDE_KINDS)('is pending for an active %s run, whatever its payload', async (kind) => {
    const { jobId } = await system().enqueueJob({ kind, tenantId, payload: { date: '2026-11-16' } });
    expect(await isPending()).toBe(true);

    await system().cancelJob(jobId);
    expect(await isPending()).toBe(false);
  });

  it('is not pending for an active run of a kind outside the computation', async () => {
    await system().enqueueJob({ kind: 'finding-score-recompute', tenantId, payload: {} });

    expect(await isPending()).toBe(false);
  });

  it('is not pending once the jobs are terminal', async () => {
    const { jobId: recomputeId } = await enqueueRecompute({ riskScenarioId });
    const { jobId: tenantWideId } = await enqueueRecompute({});
    const { jobId: simulationId } = await enqueueSimulation();
    expect(await isPending()).toBe(true);

    await system().cancelJob(recomputeId);
    await system().cancelJob(tenantWideId);
    expect(await isPending()).toBe(true);

    await system().cancelJob(simulationId);
    expect(await isPending()).toBe(false);
  });

  it('is not pending for a job of a succeeded run', async () => {
    const { jobId } = await enqueueRecompute({ riskScenarioId });
    await system().claimNext('worker-1', [RECOMPUTE_KIND], 30_000);
    await system().recordSuccess(jobId, 'worker-1');

    expect(await isPending()).toBe(false);
  });

  it('does not count another tenant\'s jobs', async () => {
    const otherTenantId = await createTenant(services, adminId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminId, tenantId: otherTenantId };
    await enqueueRecompute({}, otherTenantId);
    await enqueueRecompute({ riskScenarioId }, otherTenantId);
    await enqueueSimulation(otherTenantId);

    expect(await isPending()).toBe(false);
    expect(await isPending(otherTenantId, otherOrigin)).toBe(true);
  });

  it('does not let a caller of one tenant read another tenant\'s jobs by naming its id', async () => {
    const otherTenantId = await createTenant(services, adminId);
    await enqueueRecompute({ riskScenarioId }, otherTenantId);

    expect(await isPending(otherTenantId, origin)).toBe(false);
  });
});
