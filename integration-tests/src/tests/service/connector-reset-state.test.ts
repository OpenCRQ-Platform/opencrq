import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin, createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs } from '../../helpers/sign-in';

const services = createTestServices(db);

describe('connector reset state', () => {
  let adminOrigin: EventOrigin;
  let serviceAccountId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: 'Bot drata',
    });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('drata', serviceAccountId);
  });

  const settings = () => services.withOrigin(adminOrigin).integrationSettings;

  it('drops the watermark a sync had recorded', async () => {
    await settings().markSynced('drata', new Date('2026-08-01T00:00:00Z'));
    expect((await settings().getIntegrationSettings('drata'))?.lastReportedAt).not.toBeNull();

    await settings().clearSyncWatermark('drata');

    expect((await settings().getIntegrationSettings('drata'))?.lastReportedAt).toBeNull();
  });

  it('leaves the service account bound, so the connector still runs', async () => {
    await settings().markSynced('drata');
    await settings().clearSyncWatermark('drata');

    expect((await settings().getIntegrationSettings('drata'))?.serviceAccountId).toBe(serviceAccountId);
  });

  it('touches no other connector', async () => {
    const otherAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: otherAccountId,
      name: 'Bot openaev',
    });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', otherAccountId);
    await settings().markSynced('openaev');

    await settings().clearSyncWatermark('drata');

    expect((await settings().getIntegrationSettings('openaev'))?.lastReportedAt).not.toBeNull();
  });

  it('is harmless on a connector that has never synced', async () => {
    await settings().clearSyncWatermark('drata');

    expect((await settings().getIntegrationSettings('drata'))?.lastReportedAt).toBeNull();
  });
});

describe('openaev connector reset state (HTTP/tRPC)', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let connectorId: string;
  let client: ReturnType<typeof createTrpcTestClient>;

  const connectorState = () => services.withOrigin(adminOrigin).openaevConnector;
  const key = { connectorId: '', openaevTenantId: 'oaev-tenant-1', stream: 'attack' as const };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Bot openaev' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
    key.connectorId = connectorId;

    client = createTrpcTestClient(await getTestServer());
    await signInAs(client, setup.userId);

    await services.withOrigin(adminOrigin).integrationSettings.markSynced('openaev', new Date('2026-10-01T00:00:00Z'));
    await connectorState().saveStreamCursor({ ...key, cursor: 'cursor-1' });
    await connectorState().upsertAttackObservations({
      connectorId,
      openaevTenantId: key.openaevTenantId,
      observations: [{
        observationId: 'obs-1',
        sourceAssetId: 'asset-1',
        scenarioId: 'scenario-1',
        attackPatternExternalId: 'T1059',
        expectationType: 'DETECTION',
        simulationStartDate: new Date('2026-09-01T00:00:00Z'),
        simulationStatus: 'FINISHED',
      }],
      reportedAt: new Date('2026-10-01T00:00:00Z'),
    });
    await connectorState().upsertAssets({
      connectorId,
      assets: [{ sourceAssetId: 'asset-1', openaevTenantId: key.openaevTenantId, needsDescriptionFetch: true }],
    });
  });

  it('throws away the cursors, the observation mirror and the asset registry, with the inventory date', async () => {
    const res = await client.mutation('connectors.resetState', { source: 'openaev' }, { tenantId });

    expect(res.status).toBe(200);
    expect(await connectorState().getStreamStates(connectorId)).toEqual([]);
    expect(await connectorState().listObservationPairs(connectorId)).toEqual([]);
    expect(await connectorState().listSourceAssetIds({ connectorId, openaevTenantId: key.openaevTenantId })).toEqual([]);
    expect((await services.withOrigin(adminOrigin).integrationSettings.getIntegrationSettings('openaev'))?.lastReportedAt).toBeNull();
  });

  it('refuses a tenant member who cannot manage security, and erases nothing', async () => {
    const regularUser = await createUser(db);
    await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, regularUser.userId);
    client.clearCookies();
    await signInAs(client, regularUser.userId);

    const res = await client.mutation('connectors.resetState', { source: 'openaev' }, { tenantId });

    expect(res.json.error.data.code).toBe('FORBIDDEN');
    expect(await connectorState().getStreamStates(connectorId)).toHaveLength(1);
    expect(await connectorState().listObservationPairs(connectorId)).toHaveLength(1);
    expect(await connectorState().listSourceAssetIds({ connectorId, openaevTenantId: key.openaevTenantId })).toEqual(['asset-1']);
    expect((await services.withOrigin(adminOrigin).integrationSettings.getIntegrationSettings('openaev'))?.lastReportedAt).not.toBeNull();
  });

  it('leaves the state of another connector alone', async () => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Bot drata' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('drata', serviceAccountId);
    await services.withOrigin(adminOrigin).integrationSettings.markSynced('drata', new Date('2026-10-01T00:00:00Z'));

    await client.mutation('connectors.resetState', { source: 'drata' }, { tenantId });

    expect((await services.withOrigin(adminOrigin).integrationSettings.getIntegrationSettings('openaev'))?.lastReportedAt).not.toBeNull();
    expect(await connectorState().getStreamStates(connectorId)).toHaveLength(1);
    expect(await connectorState().listObservationPairs(connectorId)).toHaveLength(1);
  });
});
