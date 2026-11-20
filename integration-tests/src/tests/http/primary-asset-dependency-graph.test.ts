import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

describe('Primary asset dependency graph (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let primaryAssetId: string;
  let scoped: ReturnType<typeof services.withOrigin>;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: 'admin@test.com' });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });

    const organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Org' }]);
    primaryAssetId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Customer billing', description: null, ownerId: null, businessValueCategoryIds: [],
    });
  });

  it('should read the graph of a primary asset the tenant holds', async () => {
    const res = await client.query('assetDependencies.getPrimaryAssetDependencyGraph', { primaryAssetId }, { tenantId });

    expect(res.status).toBe(200);
  });

  it('should answer NOT_FOUND for a primary asset the tenant does not hold', async () => {
    const res = await client.query('assetDependencies.getPrimaryAssetDependencyGraph', { primaryAssetId: uuidv7() }, { tenantId });

    expect(res.status).toBe(404);
    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });

  it('should answer NOT_FOUND for a primary asset deleted since it was listed', async () => {
    await scoped.primaryAssets.deletePrimaryAssets([primaryAssetId]);

    const res = await client.query('assetDependencies.getPrimaryAssetDependencyGraph', { primaryAssetId }, { tenantId });

    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });
});
