import { MAX_FINANCIAL_AMOUNT_USD } from '@app/module/client';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

const EMPTY_ANSWERS = {
  loadedDailyLabourCost: null,
  annualRevenue: null,
  grossMarginPct: null,
  operatingDaysBand: null,
  seasonalPeakPct: null,
  itDependentRevenuePct: null,
  timeToRevenueImpactBand: null,
  fullRestoreBand: null,
  revenueRecaptureBand: null,
  restoreTestRecency: null,
  recordsHeldGate: null,
  individualsBand: null,
  cardTransactionsBand: null,
  sensitiveRecordsBand: null,
  largestRepositoryBand: null,
  regulatoryRegime: null,
  customerCountBand: null,
  b2cRevenuePct: null,
  recurringRevenuePct: null,
  contractedRevenueBand: null,
  contractualLiabilityCapBand: null,
  paymentFlowDailyValueBand: null,
  outOfBandVerificationGate: null,
  outOfBandThreshold: null,
  rdIpValueBand: null,
  ransomPaymentPosture: null,
  ransomPaymentCeiling: null,
  worstOutageBand: null,
  costliestIncidentBand: null,
};

describe('Financial Profiles (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantId: string;
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
      .organizations.createOrganizations([{ id: organizationId, name: 'Org' }]);
  });

  it('returns null, not undefined, when no profile exists yet', async () => {
    const res = await client.query('financialProfiles.getFinancialProfile', { organizationId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toBeNull();
  });

  it('rejects a non-positive annual revenue with BAD_REQUEST', async () => {
    const res = await client.mutation(
      'financialProfiles.saveFinancialProfile',
      { organizationId, answers: { ...EMPTY_ANSWERS, annualRevenue: -100 } },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
    expect(res.json.error.data.zodError).not.toBeNull();

    const read = await client.query('financialProfiles.getFinancialProfile', { organizationId }, { tenantId });
    expect(read.json.result.data).toBeNull();
  });

  it('rejects an annual revenue too large to be read back with BAD_REQUEST, and keeps the profile readable', async () => {
    const res = await client.mutation(
      'financialProfiles.saveFinancialProfile',
      { organizationId, answers: { ...EMPTY_ANSWERS, annualRevenue: 250_000_000_260_000_000 } },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');

    const read = await client.query('financialProfiles.getFinancialProfile', { organizationId }, { tenantId });
    expect(read.status).toBe(200);
    expect(read.json.result.data).toBeNull();
  });

  it('saves and reads back the largest amount the questionnaire accepts', async () => {
    const res = await client.mutation(
      'financialProfiles.saveFinancialProfile',
      { organizationId, answers: { ...EMPTY_ANSWERS, annualRevenue: MAX_FINANCIAL_AMOUNT_USD, ransomPaymentCeiling: MAX_FINANCIAL_AMOUNT_USD } },
      { tenantId },
    );
    expect(res.status).toBe(200);

    const read = await client.query('financialProfiles.getFinancialProfile', { organizationId }, { tenantId });
    expect(read.status).toBe(200);
    expect(read.json.result.data.annualRevenue).toBe(MAX_FINANCIAL_AMOUNT_USD);
  });

  it('rejects a negative loaded daily labour cost with BAD_REQUEST', async () => {
    const res = await client.mutation(
      'financialProfiles.saveFinancialProfile',
      { organizationId, answers: { ...EMPTY_ANSWERS, loadedDailyLabourCost: -50 } },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('rejects a percentage above 100 with BAD_REQUEST', async () => {
    const res = await client.mutation(
      'financialProfiles.saveFinancialProfile',
      { organizationId, answers: { ...EMPTY_ANSWERS, grossMarginPct: 150 } },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('rejects an unknown band value with BAD_REQUEST', async () => {
    const res = await client.mutation(
      'financialProfiles.saveFinancialProfile',
      { organizationId, answers: { ...EMPTY_ANSWERS, operatingDaysBand: 'never' } },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('saves valid answers and reads them back', async () => {
    const res = await client.mutation(
      'financialProfiles.saveFinancialProfile',
      { organizationId, answers: { ...EMPTY_ANSWERS, grossMarginPct: 42, operatingDaysBand: 'about_250' } },
      { tenantId },
    );
    expect(res.status).toBe(200);

    const read = await client.query('financialProfiles.getFinancialProfile', { organizationId }, { tenantId });
    expect(read.json.result.data.grossMarginPct).toBe(42);
    expect(read.json.result.data.operatingDaysBand).toBe('about_250');
  });

  it('rejects a request carrying no tenant context with BAD_REQUEST', async () => {
    const res = await client.query('financialProfiles.getFinancialProfile', { organizationId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('rejects saving the first profile for an organization from another tenant', async () => {
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);

    const res = await client.mutation(
      'financialProfiles.saveFinancialProfile',
      { organizationId, answers: EMPTY_ANSWERS },
      { tenantId: otherTenantId },
    );

    expect(res.json.error).toBeTruthy();

    const read = await client.query('financialProfiles.getFinancialProfile', { organizationId }, { tenantId });
    expect(read.json.result.data).toBeNull();
  });
});
