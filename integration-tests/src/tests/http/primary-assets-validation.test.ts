import { BusinessValueCategory_PersonalData, deriveSeedId } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Primary Assets Validation (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let organizationId: string;
  let adminId: string;
  let personalData: string;

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

    personalData = deriveSeedId(tenantId, BusinessValueCategory_PersonalData);
  });

  const createPayload = (businessValueCategoryIds: Array<string>) => ({
    id: uuidv7(),
    organizationId,
    name: 'Customer records',
    description: null,
    ownerId: null,
    businessValueCategoryIds,
  });

  it('should refuse creating a primary asset that holds no business resource', async () => {
    const res = await client.mutation('primaryAssets.createPrimaryAsset', createPayload([]), { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse emptying the business resources of an existing primary asset', async () => {
    const created = createPayload([personalData]);
    await client.mutation('primaryAssets.createPrimaryAsset', created, { tenantId });

    const res = await client.mutation(
      'primaryAssets.updatePrimaryAsset',
      { id: created.id, businessValueCategoryIds: [] },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should accept a primary asset that holds one', async () => {
    const res = await client.mutation('primaryAssets.createPrimaryAsset', createPayload([personalData]), { tenantId });

    expect(res.json.error).toBeUndefined();
  });

  it('should answer a duplicate reference in the risk scope with a conflict', async () => {
    await client.mutation('primaryAssets.createPrimaryAsset', { ...createPayload([personalData]), reference: 'FIN-03' }, { tenantId });

    const res = await client.mutation('primaryAssets.createPrimaryAsset', { ...createPayload([personalData]), reference: 'FIN-03' }, { tenantId });

    expect(res.json.error.data.code).toBe('CONFLICT');
    expect(res.json.error.data.reason).toBe('DUPLICATE_PRIMARY_ASSET_REFERENCE');
  });

  it('should refuse an unknown security need level', async () => {
    const res = await client.mutation('primaryAssets.createPrimaryAsset', { ...createPayload([personalData]), availability: 'critical' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse a negative duration', async () => {
    const res = await client.mutation('primaryAssets.createPrimaryAsset', { ...createPayload([personalData]), rtoMinutes: -1 }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should store the onboarding template and return it on the list', async () => {
    const created = await client.mutation('primaryAssets.createPrimaryAsset', {
      ...createPayload([personalData]), onboardingTemplate: 'customer-data',
    }, { tenantId });
    expect(created.json.error).toBeUndefined();

    const res = await client.query('primaryAssets.getPrimaryAssets', { organizationId }, { tenantId });

    expect(res.json.result.data[0]).toMatchObject({ onboardingTemplate: 'customer-data' });
  });

  it('should return no onboarding template for a primary asset created without one', async () => {
    await client.mutation('primaryAssets.createPrimaryAsset', createPayload([personalData]), { tenantId });

    const res = await client.query('primaryAssets.getPrimaryAssets', { organizationId }, { tenantId });

    expect(res.json.result.data[0].onboardingTemplate).toBeNull();
  });

  it('should answer CONFLICT to a second primary asset of the same template in the risk scope', async () => {
    const payload = { ...createPayload([personalData]), onboardingTemplate: 'customer-data' };
    await client.mutation('primaryAssets.createPrimaryAsset', payload, { tenantId });

    const res = await client.mutation('primaryAssets.createPrimaryAsset', { ...payload, id: uuidv7() }, { tenantId });

    expect(res.json.error.data.code).toBe('CONFLICT');
  });

  it('should refuse an unknown onboarding template', async () => {
    const res = await client.mutation('primaryAssets.createPrimaryAsset', {
      ...createPayload([personalData]), onboardingTemplate: 'not-a-template',
    }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should return the native fields on the list', async () => {
    await client.mutation('primaryAssets.createPrimaryAsset', {
      ...createPayload([personalData]), reference: 'FIN-03', businessFunction: 'Finance', traceability: 'high', rtoMinutes: 240,
    }, { tenantId });

    const res = await client.query('primaryAssets.getPrimaryAssets', { organizationId }, { tenantId });

    expect(res.json.result.data[0]).toMatchObject({ reference: 'FIN-03', businessFunction: 'Finance', traceability: 'high', rtoMinutes: 240 });
  });
});
