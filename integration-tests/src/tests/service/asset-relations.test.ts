import type { ConnectorAssetInput, EventOrigin } from '@app/module';
import { supportingAssetRelations } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('asset relations', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let connectorOrigin: EventOrigin;
  let connectorId: string;
  let identityAssetId: string;
  let deviceAssetId: string;
  let otherDeviceAssetId: string;

  const configureDefender = async (origin: EventOrigin, tenantId: string) => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(origin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Defender Bot' });
    await services.withOrigin(origin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
    const id = (await services.withOrigin(origin).integrationSettings.getConnectorId('microsoft_graph'))!;
    return { connectorId: id, origin: { type: 'connector' as const, serviceAccountId, tenantId } };
  };

  const deviceInput = (sourceAssetId: string, directoryDeviceId: string | null, macAddresses: Array<string> = []): ConnectorAssetInput => ({
    sourceAssetId,
    categoryId: 'host',
    subcategoryId: 'laptop',
    connectorId,
    source: 'microsoft_graph',
    name: sourceAssetId,
    properties: { family: 'machine', hostname: `${sourceAssetId}.corp.example`, macAddresses, directoryDeviceId },
  });

  const reconcile = (params: {
    relations: Array<{ fromAssetId: string, toAssetId: string, source: 'entra_registered_owner' | 'intune_primary_user' }>,
    retiredIds?: Array<string>,
    observedAt?: Date,
  }) => services.withOrigin(connectorOrigin).supportingAssets.reconcileConnectorRelations({
    connectorId,
    kind: 'primary_user_of',
    observedAt: params.observedAt ?? new Date(),
    relations: params.relations,
    retiredIds: params.retiredIds ?? [],
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    ({ connectorId, origin: connectorOrigin } = await configureDefender(setup.origin, setup.tenantId));

    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      { sourceAssetId: 'obj-nadia', categoryId: 'identity', connectorId, source: 'microsoft_graph', name: 'Nadia Fournier', properties: { family: 'identity', directoryObjectId: 'obj-nadia' } },
      deviceInput('dev-1', 'aad-1'),
      deviceInput('dev-2', null, ['A4:B1:C2:D3:E4:F5']),
    ]);
    identityAssetId = idMap.get('obj-nadia')!;
    deviceAssetId = idMap.get('dev-1')!;
    otherDeviceAssetId = idMap.get('dev-2')!;
  });

  it('should hand the connector both ends a relation joins on', async () => {
    const endpoints = await services.withOrigin(connectorOrigin).supportingAssets.getConnectorRelationEndpoints(connectorId);

    expect(endpoints.identities).toEqual([{ supportingAssetId: identityAssetId, sourceAssetId: 'obj-nadia' }]);
    expect(endpoints.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ supportingAssetId: deviceAssetId, directoryDeviceId: 'aad-1', macAddresses: [] }),
      expect.objectContaining({ supportingAssetId: otherDeviceAssetId, directoryDeviceId: null, macAddresses: ['a4b1c2d3e4f5'] }),
    ]));
  });

  it('should list the relations the connector holds', async () => {
    await reconcile({ relations: [{ fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' }] });

    const held = await services.withOrigin(connectorOrigin).supportingAssets.listConnectorRelations({ connectorId, kind: 'primary_user_of' });

    expect(held).toEqual([{ id: expect.any(String), fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' }]);
  });

  it('should read a primary user on the device and the identity, each from its own end', async () => {
    await reconcile({ relations: [{ fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' }] });

    const device = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(deviceAssetId);
    const identity = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(identityAssetId);
    expect(device?.relations).toEqual([expect.objectContaining({
      kind: 'primary_user_of',
      direction: 'incoming',
      source: 'entra_registered_owner',
      otherAsset: expect.objectContaining({ id: identityAssetId, name: 'Nadia Fournier', categoryId: 'identity' }),
    })]);
    expect(identity?.relations).toEqual([expect.objectContaining({
      direction: 'outgoing',
      otherAsset: expect.objectContaining({ id: deviceAssetId, categoryId: 'host' }),
    })]);
  });

  it('should keep one relation per pair, its first sighting, and the source that reported it last', async () => {
    const first = new Date('2026-10-01T08:00:00Z');
    await reconcile({ observedAt: first, relations: [{ fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' }] });
    await reconcile({
      observedAt: new Date('2026-10-02T08:00:00Z'),
      relations: [
        { fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'intune_primary_user' },
        { fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'intune_primary_user' },
      ],
    });

    const rows = await db.select().from(supportingAssetRelations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'intune_primary_user', firstSeenAt: first, lastReportedAt: new Date('2026-10-02T08:00:00Z') });
  });

  it('should delete exactly the relations a pass retires, leaving the others as they were', async () => {
    const first = new Date('2026-10-01T08:00:00Z');
    await reconcile({
      observedAt: first,
      relations: [
        { fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' },
        { fromAssetId: identityAssetId, toAssetId: otherDeviceAssetId, source: 'intune_primary_user' },
      ],
    });
    const retired = (await db.select().from(supportingAssetRelations)).find((row) => row.toAssetId === deviceAssetId)!;

    const { removed } = await reconcile({ observedAt: new Date('2026-10-02T08:00:00Z'), relations: [], retiredIds: [retired.id] });

    expect(removed).toBe(1);
    const rows = await db.select().from(supportingAssetRelations);
    expect(rows).toEqual([expect.objectContaining({ toAssetId: otherDeviceAssetId, lastReportedAt: first })]);
  });

  it('should go with either end', async () => {
    await reconcile({
      relations: [
        { fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' },
        { fromAssetId: identityAssetId, toAssetId: otherDeviceAssetId, source: 'entra_registered_owner' },
      ],
    });

    await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([deviceAssetId]);
    expect((await db.select().from(supportingAssetRelations)).map((row) => row.toAssetId)).toEqual([otherDeviceAssetId]);

    await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([identityAssetId]);
    expect(await db.select().from(supportingAssetRelations)).toEqual([]);
  });

  it('should never join two tenants\' assets, nor show a relation to another tenant', async () => {
    await reconcile({ relations: [{ fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' }] });
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin = { type: 'client' as const, userId: adminUserId, tenantId: otherTenantId };
    const otherDefender = await configureDefender(otherOrigin, otherTenantId);

    await expect(services.withOrigin(otherDefender.origin).supportingAssets.reconcileConnectorRelations({
      connectorId: otherDefender.connectorId,
      kind: 'primary_user_of',
      observedAt: new Date(),
      relations: [{ fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' }],
      retiredIds: [],
    })).rejects.toThrow();
    expect(await services.withOrigin(otherOrigin).supportingAssets.getSupportingAsset(deviceAssetId)).toBeNull();
    expect(await db.select().from(supportingAssetRelations)).toHaveLength(1);
  });

  it('should never retire another tenant\'s relation, nor list it', async () => {
    await reconcile({ relations: [{ fromAssetId: identityAssetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' }] });
    const [relation] = await db.select().from(supportingAssetRelations);
    const otherTenantId = await createTenant(services, adminUserId);
    const otherDefender = await configureDefender({ type: 'client', userId: adminUserId, tenantId: otherTenantId }, otherTenantId);
    const otherServices = services.withOrigin(otherDefender.origin).supportingAssets;

    const { removed } = await otherServices.reconcileConnectorRelations({
      connectorId: otherDefender.connectorId,
      kind: 'primary_user_of',
      observedAt: new Date(),
      relations: [],
      retiredIds: [relation.id],
    });

    expect(removed).toBe(0);
    expect(await otherServices.listConnectorRelations({ connectorId, kind: 'primary_user_of' })).toEqual([]);
    expect(await db.select().from(supportingAssetRelations)).toHaveLength(1);
  });
});
