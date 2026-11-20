import type { AssetCriticality, ConnectorAssetInput, EventOrigin } from '@app/module';
import { supportingAssetRelations } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('access relation graph', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let connectorOrigin: EventOrigin;
  let connectorId: string;
  let claire: string;
  let marc: string;
  let laptop: string;
  let workstation: string;
  let server: string;

  const configureConnector = async (origin: EventOrigin, forTenantId: string) => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(origin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Graph Bot' });
    await services.withOrigin(origin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
    const id = (await services.withOrigin(origin).integrationSettings.getConnectorId('microsoft_graph'))!;
    return { connectorId: id, origin: { type: 'connector' as const, serviceAccountId, tenantId: forTenantId } };
  };

  const identity = (key: string, name: string, criticality: AssetCriticality): ConnectorAssetInput => ({
    sourceAssetId: key, categoryId: 'identity', connectorId, source: 'microsoft_graph', name, criticality, properties: { family: 'identity', directoryObjectId: key },
  });

  const device = (key: string, criticality: AssetCriticality = 'unknown'): ConnectorAssetInput => ({
    sourceAssetId: key,
    categoryId: 'host',
    subcategoryId: 'laptop',
    connectorId,
    source: 'microsoft_graph',
    name: key,
    criticality,
    properties: { family: 'machine', hostname: `${key}.corp.example`, directoryDeviceId: `aad-${key}` },
  });

  const graph = (assetId: string, depth: number) => services.withOrigin(adminOrigin).assetDependencies.getSupportingAssetRelationGraph(assetId, depth);

  const ids = (assets: ReadonlyArray<{ id: string }>) => assets.map((asset) => asset.id).sort();

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    ({ connectorId, origin: connectorOrigin } = await configureConnector(setup.origin, setup.tenantId));

    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identity('obj-claire', 'Claire Martin', 'very_high'),
      identity('obj-marc', 'Marc Dubois', 'medium'),
      device('laptop'),
      device('workstation', 'high'),
      device('server'),
    ]);
    claire = idMap.get('obj-claire')!;
    marc = idMap.get('obj-marc')!;
    laptop = idMap.get('laptop')!;
    workstation = idMap.get('workstation')!;
    server = idMap.get('server')!;

    await services.withOrigin(connectorOrigin).supportingAssets.reconcileConnectorRelations({
      connectorId,
      kind: 'primary_user_of',
      observedAt: new Date('2026-10-01T08:00:00Z'),
      relations: [
        { fromAssetId: claire, toAssetId: laptop, source: 'entra_registered_owner' },
        { fromAssetId: claire, toAssetId: workstation, source: 'intune_primary_user' },
        { fromAssetId: marc, toAssetId: workstation, source: 'entra_registered_owner' },
      ],
      retiredIds: [],
    });
    await services
      .withOrigin({ type: 'job', tenantId, jobKind: 'asset-criticality-lift-recompute', interactive: false })
      .supportingAssets.recomputeCriticalityLifts();
  });

  it('should draw a device and its assigned user, the arrow pointing at the user', async () => {
    const result = await graph(laptop, 1);

    expect(ids(result.assets)).toEqual([claire, laptop].sort());
    expect(result.links).toEqual([expect.objectContaining({
      dependentId: claire, providerId: laptop, kind: 'primary_user_of', sources: ['entra_registered_owner'],
    })]);
  });

  it('should draw an identity with every device assigned to it', async () => {
    const result = await graph(claire, 1);

    expect(ids(result.assets)).toEqual([claire, laptop, workstation].sort());
    expect(result.links.map((link) => link.providerId).sort()).toEqual([laptop, workstation].sort());
  });

  it('should reach the other devices of the same user two levels from a device, and count what the depth leaves out', async () => {
    const oneLevel = await graph(laptop, 1);
    expect(oneLevel.truncated).toEqual([{ assetId: claire, hiddenProviderCount: 1, foldedBy: 'depth' }]);
    expect(oneLevel.hiddenAssetCount).toBe(2);

    const twoLevels = await graph(laptop, 2);
    expect(ids(twoLevels.assets)).toEqual([claire, laptop, workstation].sort());
    expect(twoLevels.truncated).toEqual([{ assetId: workstation, hiddenProviderCount: 1, foldedBy: 'depth' }]);
    expect(twoLevels.hiddenAssetCount).toBe(1);
  });

  it('should name the lift on the device it gives its band to, and on no device whose own reading already reaches it', async () => {
    const result = await graph(claire, 1);
    const liftOf = (assetId: string) => result.assets.find((asset) => asset.id === assetId)?.criticalityLift;

    expect(liftOf(laptop)).toEqual({ criticality: 'high', fromAssetId: claire });
    expect(liftOf(workstation)).toBeNull();
    expect(liftOf(claire)).toBeNull();
  });

  it('should draw one link for a pair two connectors both relate, with both sources and the widest window', async () => {
    const otherConnectorId = (await configureOpenAev()).connectorId;
    await db.insert(supportingAssetRelations).values({
      id: uuidv7(),
      tenantId,
      connectorId: otherConnectorId,
      fromAssetId: claire,
      toAssetId: laptop,
      kind: 'primary_user_of',
      source: 'intune_primary_user',
      firstSeenAt: new Date('2026-09-01T08:00:00Z'),
      lastReportedAt: new Date('2026-10-05T08:00:00Z'),
    });

    const result = await graph(laptop, 1);

    expect(result.links).toEqual([expect.objectContaining({
      sources: ['entra_registered_owner', 'intune_primary_user'],
      firstSeenAt: new Date('2026-09-01T08:00:00Z'),
      lastReportedAt: new Date('2026-10-05T08:00:00Z'),
    })]);
  });

  it('should draw no dependency link, and leave an asset with no relation alone', async () => {
    await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{ id: uuidv7(), providerAssetId: server, dependentAssetId: laptop }]);

    expect(ids((await graph(laptop, 1)).assets)).toEqual([claire, laptop].sort());
    const alone = await graph(server, 3);
    expect(ids(alone.assets)).toEqual([server]);
    expect(alone.links).toEqual([]);
  });

  it('should refuse the graph of another tenant\'s asset', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

    await expect(services.withOrigin(otherOrigin).assetDependencies.getSupportingAssetRelationGraph(laptop, 1)).rejects.toThrow('Access Denied');
  });

  const configureOpenAev = async () => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test OpenAEV Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    return { connectorId: (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))! };
  };
});
