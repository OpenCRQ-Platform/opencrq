import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FakeOpenaev, FakeOpenaevTenant } from '../../helpers/fake-openaev';
import { createUser } from '../../helpers/factories';
import { startFakeOpenaev } from '../../helpers/fake-openaev';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { testConnectorsConfig } from '../../setup/mock';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const POSTURE_ROUTE = '/dashboards/adhoc/series';

describe('supportingAssets.getOpenaevPosture (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let adminId: string;
  let tenantId: string;
  let adminOrigin: EventOrigin;
  let connectorOrigin: EventOrigin;
  let connectorId: string;
  let fake: FakeOpenaev;
  let mainTenant: FakeOpenaevTenant;
  let secondTenant: FakeOpenaevTenant;

  /** An asset reported by OpenAEV under the given source asset ids, which share one hardware id so they consolidate onto one asset. */
  const openaevAsset = async (sources: Array<{ sourceAssetId: string, openaevTenantId: string }>): Promise<string> => {
    const ids = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets(sources.map(({ sourceAssetId }) => ({
      sourceAssetId, connectorId, source: 'openaev', categoryId: 'host', name: 'srv-posture',
      properties: { family: 'machine', hardwareUuid: 'HW-POSTURE' },
    })));
    await services.withOrigin(connectorOrigin).openaevConnector.upsertAssets({
      connectorId,
      assets: sources.map(({ sourceAssetId, openaevTenantId }) => ({ sourceAssetId, openaevTenantId, needsDescriptionFetch: false })),
    });
    const [first] = sources;
    return ids.get(first.sourceAssetId)!;
  };

  const posture = (supportingAssetId: string, asTenantId = tenantId) =>
    client.query('supportingAssets.getOpenaevPosture', { supportingAssetId }, { tenantId: asTenantId });

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Posture Tenant' }, adminId);
    adminOrigin = { type: 'client', userId: adminId, tenantId };

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    connectorOrigin = { type: 'connector', serviceAccountId, tenantId };
    connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('openaev'))!;

    fake = await startFakeOpenaev();
    mainTenant = fake.addTenant('oa-main', 'Main');
    secondTenant = fake.addTenant('oa-second', 'Second');
    testConnectorsConfig['openaev'] = { [tenantId]: { url: fake.url, token: fake.token } };
  });

  afterEach(async () => {
    delete testConnectorsConfig['openaev'];
    await fake.close();
  });

  it('serves the counts OpenAEV reports for the asset', async () => {
    mainTenant.setPosture({ 'ep-1': { success: 3, failed: 1 } });
    const assetId = await openaevAsset([{ sourceAssetId: 'ep-1', openaevTenantId: 'oa-main' }]);

    const res = await posture(assetId);

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ success: 3, failed: 1 });
    expect(fake.requestsTo('POST', POSTURE_ROUTE, 'oa-main')).toHaveLength(1);
  });

  it('serves 0 and 0 when OpenAEV measured the asset with nothing validated, which is not never measured', async () => {
    mainTenant.setPosture({ 'ep-1': { success: 0, failed: 0 } });
    const assetId = await openaevAsset([{ sourceAssetId: 'ep-1', openaevTenantId: 'oa-main' }]);

    const res = await posture(assetId);

    expect(res.json.result.data).toEqual({ success: 0, failed: 0 });
  });

  it('sums the counts of every OpenAEV source consolidated onto the asset, across OpenAEV tenants', async () => {
    mainTenant.setPosture({ 'ep-1': { success: 3, failed: 1 }, 'ep-other': { success: 50, failed: 50 } });
    secondTenant.setPosture({ 'ep-2': { success: 2, failed: 4 } });
    const assetId = await openaevAsset([
      { sourceAssetId: 'ep-1', openaevTenantId: 'oa-main' },
      { sourceAssetId: 'ep-2', openaevTenantId: 'oa-second' },
    ]);

    const res = await posture(assetId);

    expect(res.json.result.data).toEqual({ success: 5, failed: 5 });
  });

  it('is null, and calls nothing, for an asset no OpenAEV source reports', async () => {
    const assetId = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id: assetId, name: 'Hand-made', description: null, ownerId: null, exposure: 'internal', categoryId: 'host', criticality: 'low',
    });

    const res = await posture(assetId);

    expect(res.status).toBe(200);
    expect(res.json.result.data).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });

  it('is null for an unknown asset', async () => {
    const res = await posture(uuidv7());

    expect(res.status).toBe(200);
    expect(res.json.result.data).toBeNull();
  });

  it('is null, and calls nothing, when OpenAEV is not configured for the tenant', async () => {
    delete testConnectorsConfig['openaev'];
    mainTenant.setPosture({ 'ep-1': { success: 3, failed: 1 } });
    const assetId = await openaevAsset([{ sourceAssetId: 'ep-1', openaevTenantId: 'oa-main' }]);

    const res = await posture(assetId);

    expect(res.json.result.data).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });

  it('is null when OpenAEV has no counter for the asset', async () => {
    mainTenant.setPosture({});
    const assetId = await openaevAsset([{ sourceAssetId: 'ep-1', openaevTenantId: 'oa-main' }]);

    const res = await posture(assetId);

    expect(res.json.result.data).toBeNull();
  });

  it('is null when OpenAEV fails to answer', async () => {
    mainTenant.setPostureStatus(500);
    const assetId = await openaevAsset([{ sourceAssetId: 'ep-1', openaevTenantId: 'oa-main' }]);

    const res = await posture(assetId);

    expect(res.status).toBe(200);
    expect(res.json.result.data).toBeNull();
    expect(fake.requestsTo('POST', POSTURE_ROUTE, 'oa-main')).toHaveLength(1);
  });

  describe('another tenant', () => {
    let otherTenantId: string;
    let assetId: string;

    beforeEach(async () => {
      mainTenant.setPosture({ 'ep-1': { success: 3, failed: 1 } });
      assetId = await openaevAsset([{ sourceAssetId: 'ep-1', openaevTenantId: 'oa-main' }]);

      otherTenantId = uuidv7();
      const outsider = await createUser(db);
      await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: otherTenantId }).tenants.addTenantUser(otherTenantId, outsider.userId);
      testConnectorsConfig['openaev'] = {
        [tenantId]: { url: fake.url, token: fake.token },
        [otherTenantId]: { url: fake.url, token: fake.token },
      };
      client.clearCookies();
      await signInAs(client, outsider.userId);
    });

    it('does not read the posture of an asset of a tenant the member names in their own header', async () => {
      const res = await posture(assetId, otherTenantId);

      expect(res.json.result.data).toBeNull();
      expect(fake.requests).toHaveLength(0);
    });

    it('does not read the posture of an asset of a tenant the caller does not belong to', async () => {
      const res = await posture(assetId, tenantId);

      expect(res.json.result.data).toBeNull();
      expect(fake.requests).toHaveLength(0);
    });
  });
});
