import type { AssetCriticality, ConnectorAssetInput, EventOrigin } from '@app/module';
import { allServiceDefinitions, createServices, supportingAssetCriticalityLifts, supportingAssets, supportingAssetSources } from '@app/module';
import { and, eq, ne } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { holdWriteOpen, waitUntilBlockedByAnotherBackend } from '../../helpers/held-transaction';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('criticality lifts', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let connectorOrigin: EventOrigin;
  let connectorId: string;
  let identityAssetId: string;
  let deviceAssetId: string;

  const configureDefender = async (origin: EventOrigin, forTenantId: string) => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(origin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Defender Bot' });
    await services.withOrigin(origin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
    const id = (await services.withOrigin(origin).integrationSettings.getConnectorId('microsoft_graph'))!;
    return { connectorId: id, origin: { type: 'connector' as const, serviceAccountId, tenantId: forTenantId } };
  };

  const identityInput = (criticality: AssetCriticality): ConnectorAssetInput => ({
    sourceAssetId: 'obj-admin',
    categoryId: 'identity',
    connectorId,
    source: 'microsoft_graph',
    name: 'Domain Admin',
    criticality,
    properties: { family: 'identity', directoryObjectId: 'obj-admin' },
  });

  const deviceInput = (overrides: Partial<ConnectorAssetInput> = {}): ConnectorAssetInput => ({
    sourceAssetId: 'dev-1',
    categoryId: 'host',
    subcategoryId: 'laptop',
    connectorId,
    source: 'microsoft_graph',
    name: 'ACME-LT-0001',
    properties: { family: 'machine', hostname: 'acme-lt-0001.corp.example', directoryDeviceId: 'aad-1' },
    ...overrides,
  });

  const assign = (fromAssetId: string, toAssetId: string, retiredIds: Array<string> = []) =>
    services.withOrigin(connectorOrigin).supportingAssets.reconcileConnectorRelations({
      connectorId,
      kind: 'primary_user_of',
      observedAt: new Date(),
      relations: [{ fromAssetId, toAssetId, source: 'entra_registered_owner' }],
      retiredIds,
    });

  const runJob = (forTenantId = tenantId) => services
    .withOrigin({ type: 'job', tenantId: forTenantId, jobKind: 'asset-criticality-lift-recompute', interactive: false })
    .supportingAssets.recomputeCriticalityLifts();

  const bandOf = async (assetId: string) =>
    (await db.select({ criticality: supportingAssets.criticality }).from(supportingAssets).where(eq(supportingAssets.id, assetId)))[0].criticality;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    ({ connectorId, origin: connectorOrigin } = await configureDefender(setup.origin, setup.tenantId));

    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([identityInput('very_high'), deviceInput()]);
    identityAssetId = idMap.get('obj-admin')!;
    deviceAssetId = idMap.get('dev-1')!;
    await assign(identityAssetId, deviceAssetId);
  });

  it('should lift a device one band below the identity assigned to it, naming that identity', async () => {
    const { lifted, changed } = await runJob();

    expect({ lifted, changed }).toEqual({ lifted: 1, changed: 1 });
    expect(await bandOf(deviceAssetId)).toBe('high');
    const device = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(deviceAssetId);
    expect(device?.criticalityLift).toEqual({ criticality: 'high', fromAsset: { id: identityAssetId, name: 'Domain Admin', derivedName: 'obj-admin', criticality: 'very_high' } });
  });

  it('should write nothing on a run with nothing to change', async () => {
    await runJob();
    const [before] = await db.select({ updatedAt: supportingAssets.updatedAt }).from(supportingAssets).where(eq(supportingAssets.id, deviceAssetId));

    expect(await runJob()).toEqual({ lifted: 1, changed: 0 });
    const [after] = await db.select({ updatedAt: supportingAssets.updatedAt }).from(supportingAssets).where(eq(supportingAssets.id, deviceAssetId));
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('should follow a band set by hand on the identity, and its clearing', async () => {
    await runJob();

    await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(identityAssetId, { criticality: 'medium' });
    await runJob();
    expect(await bandOf(deviceAssetId)).toBe('unknown');
    expect(await db.select().from(supportingAssetCriticalityLifts)).toEqual([]);

    await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(identityAssetId);
    await runJob();
    expect(await bandOf(deviceAssetId)).toBe('high');
  });

  it('should keep the lift through the sync\'s, a resync\'s and a superseded source\'s retirement\'s own reprojection', async () => {
    await runJob();

    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([deviceInput()]);
    expect(await bandOf(deviceAssetId)).toBe('high');

    await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(deviceAssetId);
    expect(await bandOf(deviceAssetId)).toBe('high');

    // A second key the connector holds for the same device, as the one it replaced would be.
    const [source] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, deviceAssetId));
    await db.insert(supportingAssetSources).values({ ...source, id: uuidv7(), sourceAssetId: 'dev-1-old' });
    expect(await services.withOrigin(connectorOrigin).supportingAssets.retireSupersededSources({ connectorId, sourceAssetIds: ['dev-1-old'] })).toBe(1);
    expect(await bandOf(deviceAssetId)).toBe('high');
  });

  it('should wait for a sync reprojecting the same device rather than write back what it read before the sync committed', async () => {
    const syncing = holdWriteOpen((tx) => createServices([...allServiceDefinitions], tx)
      .withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([deviceInput({ name: 'ACME-LT-0001-RENAMED' })]));
    await syncing.locked;

    const running = runJob();
    expect(await waitUntilBlockedByAnotherBackend()).toBe(true);
    syncing.commit();
    await syncing.done;
    await running;

    const [device] = await db.select({ name: supportingAssets.name, criticality: supportingAssets.criticality })
      .from(supportingAssets).where(eq(supportingAssets.id, deviceAssetId));
    expect(device).toEqual({ name: 'ACME-LT-0001-RENAMED', criticality: 'high' });
  });

  it('should skip a device no connector observes any more, rather than fail the whole run', async () => {
    await runJob();
    await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(deviceAssetId, { properties: {
      family: 'machine', hostname: 'acme-lt-0001.corp.example',
    } });
    await db.delete(supportingAssetSources).where(and(eq(supportingAssetSources.supportingAssetId, deviceAssetId), ne(supportingAssetSources.origin, 'user')));

    await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(identityAssetId, { criticality: 'medium' });
    expect(await runJob()).toEqual({ lifted: 0, changed: 1 });
    expect(await db.select().from(supportingAssetCriticalityLifts)).toEqual([]);
  });

  it('should let a connector reading more severe than the lift win, and a band set by hand on the device outrank both', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([deviceInput({ criticality: 'very_high', criticalityRule: 'domain_controller' })]);
    await runJob();
    expect(await bandOf(deviceAssetId)).toBe('very_high');

    await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(deviceAssetId, { criticality: 'low' });
    await runJob();
    expect(await bandOf(deviceAssetId)).toBe('low');
  });

  it('should remove the lift a retired relation gave', async () => {
    await runJob();
    const [relation] = await services.withOrigin(connectorOrigin).supportingAssets.listConnectorRelations({ connectorId, kind: 'primary_user_of' });

    await services.withOrigin(connectorOrigin).supportingAssets.reconcileConnectorRelations({
      connectorId, kind: 'primary_user_of', observedAt: new Date(), relations: [], retiredIds: [relation.id],
    });
    await runJob();

    expect(await bandOf(deviceAssetId)).toBe('unknown');
    expect(await db.select().from(supportingAssetCriticalityLifts)).toEqual([]);
  });

  it('should keep the lift of a deleted identity until the next run removes it, and take a deleted device\'s with it', async () => {
    await runJob();

    await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([identityAssetId]);
    expect(await db.select().from(supportingAssetCriticalityLifts)).toEqual([expect.objectContaining({ supportingAssetId: deviceAssetId, fromAssetId: null })]);
    await runJob();
    expect(await bandOf(deviceAssetId)).toBe('unknown');

    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{ ...identityInput('very_high'), sourceAssetId: 'obj-admin-2' }]);
    await assign(idMap.get('obj-admin-2')!, deviceAssetId);
    await runJob();
    await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([deviceAssetId]);
    expect(await db.select().from(supportingAssetCriticalityLifts)).toEqual([]);
  });

  it('should store the rule behind a connector\'s reading and hand it to the detail', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([deviceInput({ criticality: 'very_high', criticalityRule: 'domain_controller' })]);

    const [source] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, deviceAssetId));
    expect(source.reportedCriticalityRule).toBe('domain_controller');
    const device = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(deviceAssetId);
    expect(device?.sources).toEqual([expect.objectContaining({ reportedCriticality: 'very_high', reportedCriticalityRule: 'domain_controller' })]);
  });

  it('should lift every device of a run that reprojects more than one batch', async () => {
    const inputs = Array.from({ length: 1_001 }, (_, i) => deviceInput({
      sourceAssetId: `dev-batch-${i}`,
      name: `ACME-LT-B${i}`,
      properties: { family: 'machine', hostname: `acme-lt-b${i}.corp.example`, directoryDeviceId: `aad-batch-${i}` },
    }));
    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets(inputs);
    await services.withOrigin(connectorOrigin).supportingAssets.reconcileConnectorRelations({
      connectorId,
      kind: 'primary_user_of',
      observedAt: new Date(),
      relations: inputs.map((input) => ({ fromAssetId: identityAssetId, toAssetId: idMap.get(input.sourceAssetId)!, source: 'entra_registered_owner' })),
      retiredIds: [],
    });

    expect(await runJob()).toEqual({ lifted: 1_002, changed: 1_002 });
    const bands = await db.select({ criticality: supportingAssets.criticality }).from(supportingAssets).where(eq(supportingAssets.categoryId, 'host'));
    expect(bands).toHaveLength(1_002);
    expect(bands.every(({ criticality }) => criticality === 'high')).toBe(true);
  });

  it('should be recomputed by its job alone', async () => {
    await expect(services.withOrigin(adminOrigin).supportingAssets.recomputeCriticalityLifts()).rejects.toThrow('by their job alone');
  });

  it('should never lift another tenant\'s device', async () => {
    const otherTenantId = await createTenant(services, adminUserId);

    expect(await runJob(otherTenantId)).toEqual({ lifted: 0, changed: 0 });
    expect(await db.select().from(supportingAssetCriticalityLifts)).toEqual([]);
    expect(await bandOf(deviceAssetId)).toBe('unknown');
  });
});
