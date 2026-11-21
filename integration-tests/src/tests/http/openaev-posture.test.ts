import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FakeOpenaev } from '../../helpers/fake-openaev';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createUser } from '../../helpers/factories';
import { findingScoreFixtures } from '../../helpers/finding-score-fixtures';
import { startFakeOpenaev } from '../../helpers/fake-openaev';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { testConnectorsConfig } from '../../setup/mock';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

/**
 * The asset posture is what the OpenAEV sync stored in this tenant, never a live read of OpenAEV
 * with the deployment's connector token (opencrq #24, CTEM data segregation): a reader sees no more
 * of OpenAEV than the sync brought in, and a fake OpenAEV wired to the tenant is never called.
 */
describe('supportingAssets.getOpenaevPosture (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let adminId: string;
  let tenantId: string;
  let adminOrigin: EventOrigin;
  let openaevConnectorId: string;
  let fake: FakeOpenaev;
  const fixtures = findingScoreFixtures(services, db, () => ({ origin: adminOrigin, tenantId, userId: adminId }));

  const posture = (supportingAssetId: string, asTenantId = tenantId) =>
    client.query('supportingAssets.getOpenaevPosture', { supportingAssetId }, { tenantId: asTenantId });

  /** One OpenAEV finding of the asset, its latest test as given (`held` = not exposed); `null` = never tested. */
  const openaevFinding = async (assetId: string, held: boolean | null, connectorId = openaevConnectorId): Promise<void> => {
    const at = new Date(Date.now() - 60_000);
    const evidenceId = await fixtures.attachTechnique(assetId, at, connectorId);
    if (held !== null) {
      await insertSyncedVerdict(evidenceId, held ? 'dismissed' : 'applicable', at, { connectorId });
    }
  };

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
    const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId };
    openaevConnectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('openaev'))!;

    // A live OpenAEV with the connector token stays wired: the procedure must never call it.
    fake = await startFakeOpenaev();
    fake.addTenant('oa-main', 'Main').setPosture({ 'ep-1': { success: 99, failed: 99 } });
    testConnectorsConfig['openaev'] = { [tenantId]: { url: fake.url, token: fake.token } };
  });

  afterEach(async () => {
    delete testConnectorsConfig['openaev'];
    await fake.close();
  });

  it('counts the OpenAEV findings the sync stored: held as success, exposed as failed, and never calls OpenAEV', async () => {
    const assetId = await fixtures.createAsset('srv-posture');
    await openaevFinding(assetId, true);
    await openaevFinding(assetId, true);
    await openaevFinding(assetId, false);

    const res = await posture(assetId);

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ success: 2, failed: 1 });
    expect(fake.requests).toHaveLength(0);
  });

  it('leaves out findings no test spoke about and findings of another source', async () => {
    const assetId = await fixtures.createAsset('srv-posture');
    await openaevFinding(assetId, true);
    await openaevFinding(assetId, null);
    const otherAccount = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: otherAccount, name: 'Other Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('drata', otherAccount);
    const otherConnectorId = (await services.withOrigin({ type: 'connector', serviceAccountId: otherAccount, tenantId })
      .integrationSettings.getConnectorId('drata'))!;
    await openaevFinding(assetId, false, otherConnectorId);

    const res = await posture(assetId);

    expect(res.json.result.data).toEqual({ success: 1, failed: 0 });
  });

  it('is null while no OpenAEV test spoke about the asset', async () => {
    const assetId = await fixtures.createAsset('hand-made');
    await openaevFinding(assetId, null);

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

  describe('a restricted user', () => {
    let assetId: string;
    let otherTenantId: string;

    beforeEach(async () => {
      assetId = await fixtures.createAsset('srv-posture');
      await openaevFinding(assetId, false);

      otherTenantId = uuidv7();
      const outsider = await createUser(db);
      await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: otherTenantId }).tenants.addTenantUser(otherTenantId, outsider.userId);
      client.clearCookies();
      await signInAs(client, outsider.userId);
    });

    it('gets no count for an asset of a tenant it names in its own header', async () => {
      const res = await posture(assetId, otherTenantId);

      expect(res.json.result.data).toBeNull();
      expect(fake.requests).toHaveLength(0);
    });

    it('gets no count for an asset of a tenant it does not belong to', async () => {
      const res = await posture(assetId, tenantId);

      expect(res.json.result.data).toBeNull();
      expect(fake.requests).toHaveLength(0);
    });
  });
});
