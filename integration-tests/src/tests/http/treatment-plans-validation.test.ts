import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Treatment Plans Validation (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;
  let organizationId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);

    organizationId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .organizations.createOrganizations([{ id: organizationId, name: 'Payment platform' }]);
  });

  it('should create a plan and read it back with its moves', async () => {
    const created = await client.mutation('treatmentPlans.createTreatmentPlan', {
      organizationId, name: 'Q3 hardening', rationale: 'The audit asked for it', costOneOff: 12000,
    }, { tenantId });

    const planId = created.json.result.data;
    const res = await client.query('treatmentPlans.getTreatmentPlan', { id: planId }, { tenantId });

    expect(res.json.result.data).toMatchObject({
      id: planId, name: 'Q3 hardening', rationale: 'The audit asked for it', costOneOff: 12000, moves: [],
    });
  });

  it('should create a plan as a draft even when the payload asks for another status', async () => {
    const created = await client.mutation('treatmentPlans.createTreatmentPlan', {
      organizationId, name: 'Straight to active', status: 'active',
    }, { tenantId });

    const res = await client.query(
      'treatmentPlans.getTreatmentPlan', { id: created.json.result.data }, { tenantId },
    );

    expect(res.json.result.data.status).toBe('draft');
  });

  it('should refuse a move that sets no target with a client error', async () => {
    const created = await client.mutation('treatmentPlans.createTreatmentPlan', { organizationId, name: 'Empty move' }, { tenantId });

    const res = await client.mutation('treatmentPlans.addTreatmentPlanMoves', {
      planId: created.json.result.data,
      moves: [{ capabilityId: uuidv7(), targetStrengthRung: null, targetCoverageBucket: null }],
    }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse a plan created with a move that sets no target with a client error', async () => {
    const res = await client.mutation('treatmentPlans.createTreatmentPlan', {
      organizationId,
      name: 'Empty move',
      moves: [{ capabilityId: uuidv7(), targetStrengthRung: null, targetCoverageBucket: null }],
    }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse two moves for one capability with a client error', async () => {
    const capabilityId = uuidv7();
    const res = await client.mutation('treatmentPlans.createTreatmentPlan', {
      organizationId,
      name: 'Split control',
      moves: [
        { capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null },
        { capabilityId, targetStrengthRung: null, targetCoverageBucket: 'L2' },
      ],
    }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse a plan that names no risk scope', async () => {
    const res = await client.mutation('treatmentPlans.createTreatmentPlan', { name: 'Scopeless' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse a negative cost with a client error', async () => {
    const res = await client.mutation('treatmentPlans.createTreatmentPlan', {
      organizationId, name: 'Paid to take it', costOneOff: -1,
    }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should read the cost and the return on the list row', async () => {
    await client.mutation('treatmentPlans.createTreatmentPlan', {
      organizationId, name: 'Costed', costOneOff: 100_000, costRecurringAnnual: 20_000,
    }, { tenantId });

    const res = await client.query('treatmentPlans.getTreatmentPlans', { organizationId }, { tenantId });

    expect(res.json.result.data[0]).toMatchObject({ costYear1: 120_000, returnPercent: null });
  });

  it('should refuse a call that carries no tenant header', async () => {
    const res = await client.query('treatmentPlans.getTreatmentPlans', {});

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });
});
