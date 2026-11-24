import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Asset dependency writes, input (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let primaryAssetId: string;
  let serverId: string;
  let databaseId: string;
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
    const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });

    organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Org' }]);
    primaryAssetId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Customer billing', description: null, ownerId: null, businessValueCategoryIds: [],
    });
    serverId = uuidv7();
    databaseId = uuidv7();
    for (const [id, name] of [[serverId, 'Web Server'], [databaseId, 'Database Server']]) {
      await scoped.supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
    }
  });

  const expectBadRequest = (res: Awaited<ReturnType<typeof client.mutation>>, message: string) => {
    expect(res.json.error.data.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(res.json.error)).toContain(message);
  };

  it('should refuse a create of supporting-to-primary links naming a pair twice', async () => {
    const res = await client.mutation('assetDependencies.createSupportToPrimaryLinks', [
      { id: uuidv7(), supportingAssetId: serverId, primaryAssetId },
      { id: uuidv7(), supportingAssetId: serverId, primaryAssetId, roles: ['stores'] },
    ], { tenantId });

    expectBadRequest(res, 'A pair cannot be linked twice in one call');
  });

  it('should refuse a create of supporting-to-primary links naming an id twice', async () => {
    const id = uuidv7();
    const res = await client.mutation('assetDependencies.createSupportToPrimaryLinks', [
      { id, supportingAssetId: serverId, primaryAssetId },
      { id, supportingAssetId: databaseId, primaryAssetId },
    ], { tenantId });

    expectBadRequest(res, 'A link id cannot appear twice in one call');
  });

  it('should refuse an update naming a link twice', async () => {
    const id = uuidv7();
    await client.mutation('assetDependencies.createSupportToPrimaryLinks', [{ id, supportingAssetId: serverId, primaryAssetId }], { tenantId });

    const res = await client.mutation('assetDependencies.updateSupportToPrimaryLinks', [
      { id, roles: ['stores'] },
      { id, roles: ['stores'] },
    ], { tenantId });

    expectBadRequest(res, 'A link cannot be updated twice in one call');
  });

  it('should refuse a create of supporting-to-supporting links naming a pair twice', async () => {
    const res = await client.mutation('assetDependencies.createSupportToSupportLinks', [
      { id: uuidv7(), providerAssetId: databaseId, dependentAssetId: serverId },
      { id: uuidv7(), providerAssetId: databaseId, dependentAssetId: serverId },
    ], { tenantId });

    expectBadRequest(res, 'A pair cannot be linked twice in one call');
  });

  it('should refuse a create of supporting-to-supporting links naming an id twice', async () => {
    const id = uuidv7();
    const res = await client.mutation('assetDependencies.createSupportToSupportLinks', [
      { id, providerAssetId: databaseId, dependentAssetId: serverId },
      { id, providerAssetId: serverId, dependentAssetId: databaseId },
    ], { tenantId });

    expectBadRequest(res, 'A link id cannot appear twice in one call');
  });

  it('should refuse a create of primary-to-primary links naming a primary asset as its own provider', async () => {
    const res = await client.mutation('assetDependencies.createPrimaryToPrimaryLinks', [
      { id: uuidv7(), dependentAssetId: primaryAssetId, providerAssetId: primaryAssetId },
    ], { tenantId });

    expectBadRequest(res, 'A primary asset cannot depend on itself');
  });

  it('should refuse a create of primary-to-primary links naming a pair twice', async () => {
    const providerAssetId = uuidv7();
    const res = await client.mutation('assetDependencies.createPrimaryToPrimaryLinks', [
      { id: uuidv7(), dependentAssetId: primaryAssetId, providerAssetId, strength: 'critical' },
      { id: uuidv7(), dependentAssetId: primaryAssetId, providerAssetId, strength: 'minor' },
    ], { tenantId });

    expectBadRequest(res, 'A pair cannot be linked twice in one call');
  });

  it('should refuse a primary-to-primary link between two organizations as a bad request', async () => {
    const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });
    const otherOrganizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: otherOrganizationId, name: 'Subsidiary' }]);
    const payrollId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: payrollId, organizationId: otherOrganizationId, name: 'Payroll', description: null, ownerId: null, businessValueCategoryIds: [],
    });

    const res = await client.mutation('assetDependencies.createPrimaryToPrimaryLinks', [
      { id: uuidv7(), dependentAssetId: primaryAssetId, providerAssetId: payrollId },
    ], { tenantId });

    expectBadRequest(res, 'A primary asset can only depend on a primary asset of its own organization');
  });

  it('should refuse a primary-to-primary link strength outside the closed list', async () => {
    const res = await client.mutation('assetDependencies.createPrimaryToPrimaryLinks', [
      { id: uuidv7(), dependentAssetId: primaryAssetId, providerAssetId: uuidv7(), strength: 'hard' },
    ], { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse an update of a primary-to-primary link changing nothing', async () => {
    const res = await client.mutation('assetDependencies.updatePrimaryToPrimaryLinks', [{ id: uuidv7() }], { tenantId });

    expectBadRequest(res, 'A link update needs a strength or a dependency resource type');
  });

  it('should refuse a primary-to-primary link naming another tenant\'s resource type as a bad request', async () => {
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other tenant' }, adminId);
    const [foreignType] = await services.withOrigin({ type: 'client', userId: adminId, tenantId: otherTenantId })
      .assetDependencies.listDependencyResourceTypes();
    const providerAssetId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId }).primaryAssets.createPrimaryAsset({
      id: providerAssetId, organizationId, name: 'Payments', description: null, ownerId: null, businessValueCategoryIds: [],
    });

    const res = await client.mutation('assetDependencies.createPrimaryToPrimaryLinks', [
      { id: uuidv7(), dependentAssetId: primaryAssetId, providerAssetId, dependencyResourceTypeId: foreignType.id },
    ], { tenantId });

    expectBadRequest(res, 'A dependency resource type must be one of this tenant');
  });

  it('should refuse a dependency resource type name already taken as a conflict', async () => {
    const res = await client.mutation('assetDependencies.createDependencyResourceType', { id: uuidv7(), name: 'SUPPLIER' }, { tenantId });

    expect(res.json.error.data.code).toBe('CONFLICT');
  });

  it('should delete a link named twice in one delete', async () => {
    const id = uuidv7();
    await client.mutation('assetDependencies.createSupportToPrimaryLinks', [{ id, supportingAssetId: serverId, primaryAssetId }], { tenantId });

    const res = await client.mutation('assetDependencies.deleteSupportToPrimaryLinks', [id, id], { tenantId });

    expect(res.status).toBe(200);
    const read = await client.query('assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId', { primaryAssetId }, { tenantId });
    expect(read.json.result.data).toEqual([]);
  });
});
