import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Risk scenario dependency graph (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let tenantId: string;
  let origin: EventOrigin;
  let riskScenarioId: string;
  let primaryAssetId: string;
  let storeId: string;
  let clusterId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Graph Tenant' }, adminId);
    origin = { type: 'client', userId: adminId, tenantId };
    const scoped = services.withOrigin(origin);

    const organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Graph Org' }]);
    primaryAssetId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Customer billing', description: null, ownerId: null, businessValueCategoryIds: [],
    });
    storeId = uuidv7();
    clusterId = uuidv7();
    for (const [id, name] of [[storeId, 'db-fact-prod'], [clusterId, 'esx-cluster-02']]) {
      await scoped.supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
    }
    await scoped.assetDependencies.createSupportToPrimaryLinks([{
      id: uuidv7(), supportingAssetId: storeId, primaryAssetId, roles: ['stores', 'processes'],
    }]);
    await scoped.assetDependencies.createSupportToSupportLinks([{
      id: uuidv7(), providerAssetId: clusterId, dependentAssetId: storeId,
    }]);

    const attackOutcomes = await scoped.attackOutcomes.getAttackOutcomes();
    riskScenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Billing outage',
      description: null,
      attackOutcomeId: attackOutcomes[0].id,
      primaryAssetIds: [primaryAssetId],
    });
  });

  it('should carry the roles of each link to a primary asset through the output schema', async () => {
    const res = await client.query('riskScenarios.getDependencyGraph', { riskScenarioId, depth: 3 }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ dependentId: primaryAssetId, providerId: storeId, roles: ['stores', 'processes'] }),
      expect.objectContaining({ dependentId: storeId, providerId: clusterId, roles: null }),
    ]));
  });
});
