import type { AssetCategory, ConnectorAssetInput, EventOrigin } from '@app/module';
import { createSecuredSchema, supportingAssetAiTargetProperties, supportingAssetIdentityProperties, supportingAssetMachineProperties, supportingAssets, supportingAssetSources } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

type VersionedTable = 'supporting_assets' | 'supporting_asset_sources' | 'supporting_asset_machine_properties' | 'supporting_asset_tags' | 'tags' | 'tag_sources';

/** xmin is the row version: it only moves when Postgres actually rewrites the row. */
const rowVersions = async (table: VersionedTable): Promise<Map<string, string>> => {
  const { rows } = await db.execute<{ id: string, v: string }>(sql`SELECT id::text AS id, xmin::text AS v FROM ${sql.raw(table)}`);
  return new Map(rows.map((row) => [row.id, row.v]));
};

const movedRowIds = (before: Map<string, string>, after: Map<string, string>): Array<string> =>
  [...after].filter(([id, version]) => before.get(id) !== version).map(([id]) => id);

describe('Supporting Assets Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;
  });

  describe('family property tables', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;
    let graphOrigin: EventOrigin;
    let graphConnectorId: string;

    beforeEach(async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      connectorOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
      connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('openaev'))!;

      const graphAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: graphAccountId, name: 'Graph Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', graphAccountId);
      graphOrigin = { type: 'connector', serviceAccountId: graphAccountId, tenantId: adminTenantId };
      graphConnectorId = (await services.withOrigin(graphOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
    });

    it('scopes the machine-properties table to its own tenant', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-machine-1', connectorId, source: 'openaev', categoryId: 'host', name: 'srv-machine',
        properties: { family: 'machine', hostname: 'srv-machine.local' },
      }]);

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherViews = createSecuredSchema(db, otherOrigin);
      const ownViews = createSecuredSchema(db, adminOrigin);

      expect(await db.select().from(otherViews.supportingAssetMachineProperties)).toEqual([]);
      expect((await db.select().from(ownViews.supportingAssetMachineProperties)).length).toBe(1);
    });

    it('scopes the ai-target-properties table to its own tenant', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-ai-1', connectorId, source: 'openaev', categoryId: 'ai_target', name: 'copilot',
        properties: { family: 'ai_target', endpointUrl: 'https://api.acme.test/v1/chat', model: 'gpt-4o' },
      }]);

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherViews = createSecuredSchema(db, otherOrigin);
      const ownViews = createSecuredSchema(db, adminOrigin);

      expect(await db.select().from(otherViews.supportingAssetAiTargetProperties)).toEqual([]);
      expect((await db.select().from(ownViews.supportingAssetAiTargetProperties)).length).toBe(1);
    });

    it('drops the previous family\'s property row when a source changes family, rather than letting it shadow the new one', async () => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-reclassified', connectorId, source: 'openaev', categoryId: 'host', name: 'chat-host',
        properties: { family: 'machine', hostname: 'chat-host.local' },
      }]);
      const assetId = idMap.get('ep-reclassified')!;
      const [sourceRow] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, assetId));

      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-reclassified', connectorId, source: 'openaev', categoryId: 'ai_target', name: 'chat-host',
        properties: { family: 'ai_target', endpointUrl: 'https://api.acme.test/v1/chat', model: 'gpt-4o' },
      }]);

      expect(await db.select().from(supportingAssetMachineProperties).where(eq(supportingAssetMachineProperties.supportingAssetSourceId, sourceRow.id))).toHaveLength(0);
      expect(await db.select().from(supportingAssetAiTargetProperties).where(eq(supportingAssetAiTargetProperties.supportingAssetSourceId, sourceRow.id))).toHaveLength(1);
    });

    it('keeps the machine identity of a source that reports no property block at all, which a detail call may simply not have returned', async () => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-no-detail', connectorId, source: 'openaev', categoryId: 'host', name: 'srv-no-detail',
        properties: { family: 'machine', hostname: 'srv-no-detail.local' },
      }]);
      const assetId = idMap.get('ep-no-detail')!;
      const [sourceRow] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, assetId));

      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-no-detail', connectorId, source: 'openaev', categoryId: 'host', name: 'srv-no-detail',
      }]);

      expect(await db.select().from(supportingAssetMachineProperties).where(eq(supportingAssetMachineProperties.supportingAssetSourceId, sourceRow.id))).toHaveLength(1);
    });

    it('cascades a property row\'s delete from its own source row, not only from the asset', async () => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-machine-2', connectorId, source: 'openaev', categoryId: 'host', name: 'srv-machine-2',
        properties: { family: 'machine', hostname: 'srv-machine-2.local' },
      }]);
      const assetId = idMap.get('ep-machine-2')!;
      const [sourceRow] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, assetId));
      expect(await db.select().from(supportingAssetMachineProperties).where(eq(supportingAssetMachineProperties.supportingAssetSourceId, sourceRow.id))).toHaveLength(1);

      await db.delete(supportingAssetSources).where(eq(supportingAssetSources.id, sourceRow.id));

      expect(await db.select().from(supportingAssetMachineProperties).where(eq(supportingAssetMachineProperties.supportingAssetSourceId, sourceRow.id))).toHaveLength(0);
    });

    it('merges the property block field by field, so a field the top-authority source omits still shows', async () => {
      const graphMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'mde-props', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'srv-props',
        properties: { family: 'machine', hostname: 'srv-props.corp.local', hardwareUuid: 'HW-PROPS-1' },
      }]);
      const assetId = graphMap.get('mde-props')!;
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-props', connectorId, source: 'openaev', categoryId: 'host', name: 'srv-props (OpenAEV)',
        properties: { family: 'machine', hostname: 'srv-props.corp.local', hardwareUuid: 'HW-PROPS-1', seenIp: '10.0.0.9' },
      }]);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);

      expect(asset!.sources).toHaveLength(2);
      // Defender outranks OpenAEV on the hostname it also reports, but reports no seen IP at all.
      expect(asset!.properties).toMatchObject({ family: 'machine', hostname: 'srv-props.corp.local', seenIp: '10.0.0.9' });
    });

    it('resolves the descriptive cloud block and the url onto the canonical asset', async () => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-cloud', connectorId, source: 'openaev', categoryId: 'cloud_resource', name: 'prod-vm',
        url: 'https://prod-vm.acme.test',
        properties: {
          family: 'machine',
          hostname: 'prod-vm.acme.test',
          cloudProvider: 'azure',
          cloudNativeType: 'azure_virtual_machine',
          cloudRegion: 'westeurope',
        },
      }]);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('ep-cloud')!);

      expect(asset!.url).toBe('https://prod-vm.acme.test');
      expect(asset!.properties).toMatchObject({
        family: 'machine',
        cloudProvider: 'azure',
        cloudNativeType: 'azure_virtual_machine',
        cloudRegion: 'westeurope',
      });
    });

    it('reads the hardware vendor and model back identically, and null when the connector reports none', async () => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        {
          sourceAssetId: 'ep-hw', connectorId, source: 'openaev', categoryId: 'host', name: 'switch-hw',
          properties: { family: 'machine', hostname: 'switch-hw.local', vendor: 'Cisco Meraki', model: 'MS220-48' },
        },
        {
          sourceAssetId: 'ep-no-hw', connectorId, source: 'openaev', categoryId: 'host', name: 'switch-no-hw',
          properties: { family: 'machine', hostname: 'switch-no-hw.local' },
        },
      ]);

      const withHardware = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('ep-hw')!);
      const withoutHardware = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('ep-no-hw')!);

      expect(withHardware!.properties).toMatchObject({ family: 'machine', vendor: 'Cisco Meraki', model: 'MS220-48' });
      expect(withoutHardware!.properties).toMatchObject({ family: 'machine', vendor: null, model: null });
    });

    it('reads the operating system and its version back, and null when the connector reports none', async () => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        {
          sourceAssetId: 'ep-os', connectorId, source: 'openaev', categoryId: 'host', name: 'laptop-os',
          properties: { family: 'machine', hostname: 'laptop-os.local', operatingSystem: 'Windows 11 25H2', osVersion: '10.0.26200.9711' },
        },
        {
          sourceAssetId: 'ep-no-os', connectorId, source: 'openaev', categoryId: 'host', name: 'laptop-no-os',
          properties: { family: 'machine', hostname: 'laptop-no-os.local' },
        },
      ]);

      const withOs = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('ep-os')!);
      const withoutOs = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('ep-no-os')!);

      expect(withOs!.properties).toMatchObject({ family: 'machine', operatingSystem: 'Windows 11 25H2', osVersion: '10.0.26200.9711' });
      expect(withoutOs!.properties).toMatchObject({ family: 'machine', operatingSystem: null, osVersion: null });
    });

    it('keeps an operating system typed by hand over the one a later sync reports', async () => {
      const reported = (operatingSystem: string, osVersion: string): ConnectorAssetInput => ({
        sourceAssetId: 'ep-os-pinned', connectorId, source: 'openaev', categoryId: 'host', name: 'laptop-pinned',
        properties: { family: 'machine', hostname: 'laptop-pinned.local', operatingSystem, osVersion },
      });
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([reported('Windows 10 22H2', '10.0.19045.6456')]);
      const id = idMap.get('ep-os-pinned')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, {
        properties: { family: 'machine', operatingSystem: 'Windows 11 25H2' },
      });
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([reported('Windows 10 21H2', '10.0.19044.5737')]);

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(detail!.properties).toMatchObject({ family: 'machine', operatingSystem: 'Windows 11 25H2', osVersion: '10.0.19044.5737' });
      expect(detail!.manualProperties).toMatchObject({ family: 'machine', operatingSystem: 'Windows 11 25H2', osVersion: null });
    });
  });

  describe('bulkUpsertAssets idempotency', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;

    beforeEach(async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      connectorOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
      connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('openaev'))!;
    });

    it('writes no duplicate rows when the same payload is upserted twice', async () => {
      const payload = [{
        sourceAssetId: 'ep-idem-1', connectorId, source: 'openaev', categoryId: 'ai_target' as AssetCategory, name: 'copilot',
        properties: { family: 'ai_target' as const, endpointUrl: 'https://api.acme.test/v1/chat', model: 'gpt-4o' },
        firstSeenAt: new Date('2026-01-01T00:00:00Z'), lastSeenAt: new Date('2026-01-05T00:00:00Z'),
      }];

      const firstMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets(payload);
      const secondMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets(payload);

      const assetId = firstMap.get('ep-idem-1')!;
      expect(secondMap.get('ep-idem-1')).toBe(assetId);

      expect(await db.select().from(supportingAssets).where(eq(supportingAssets.id, assetId))).toHaveLength(1);
      const sources = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, assetId));
      expect(sources).toHaveLength(1);
      expect(await db.select().from(supportingAssetAiTargetProperties).where(eq(supportingAssetAiTargetProperties.supportingAssetSourceId, sources[0].id))).toHaveLength(1);
    });

    describe('no rewrite of an unchanged row', () => {
      const machineAsset = (over: Partial<ConnectorAssetInput> = {}): ConnectorAssetInput => ({
        sourceAssetId: 'ep-n1', connectorId, source: 'openaev', categoryId: 'host', name: 'srv-n1', description: 'first',
        properties: { family: 'machine', hostname: 'srv-n1', ipAddresses: ['10.0.0.1'], operatingSystem: 'Ubuntu', osVersion: '24.04' },
        firstSeenAt: new Date('2026-01-01T00:00:00Z'), lastSeenAt: new Date('2026-01-05T00:00:00Z'),
        ...over,
      });
      const otherMachineAsset = (): ConnectorAssetInput => machineAsset({
        sourceAssetId: 'ep-n2', name: 'srv-n2', properties: { family: 'machine', hostname: 'srv-n2', ipAddresses: ['10.0.0.2'] },
      });
      const upsert = (assets: Array<ConnectorAssetInput>) => services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets(assets);
      const snapshot = async () => ({
        assets: await rowVersions('supporting_assets'),
        sources: await rowVersions('supporting_asset_sources'),
        properties: await rowVersions('supporting_asset_machine_properties'),
      });

      it('touches no row of the asset, its source or its properties when the same payload comes twice', async () => {
        await upsert([machineAsset(), otherMachineAsset()]);
        const before = await snapshot();
        const [sourceBefore] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.sourceAssetId, 'ep-n1'));

        await upsert([machineAsset(), otherMachineAsset()]);

        const after = await snapshot();
        expect(movedRowIds(before.assets, after.assets)).toEqual([]);
        expect(movedRowIds(before.sources, after.sources)).toEqual([]);
        expect(movedRowIds(before.properties, after.properties)).toEqual([]);
        const [sourceAfter] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.sourceAssetId, 'ep-n1'));
        expect(sourceAfter.updatedAt).toEqual(sourceBefore.updatedAt);
      });

      it('touches no machine-properties row when the same address sets come back in another order', async () => {
        const withAddresses = (ipAddresses: Array<string>, macAddresses: Array<string>) => machineAsset({
          properties: { family: 'machine', hostname: 'srv-n1', ipAddresses, macAddresses },
        });
        await upsert([withAddresses(['10.0.0.1', '10.0.0.2'], ['eaee5e1c7fdc', '623c720747ab'])]);
        const before = await snapshot();

        await upsert([withAddresses(['10.0.0.2', '10.0.0.1', '10.0.0.2'], ['623c720747ab', 'eaee5e1c7fdc'])]);

        const after = await snapshot();
        expect(movedRowIds(before.properties, after.properties)).toEqual([]);
        expect(movedRowIds(before.sources, after.sources)).toEqual([]);
        expect(movedRowIds(before.assets, after.assets)).toEqual([]);
      });

      it('rewrites only the source whose reported field changed, and the reprojection follows', async () => {
        const idMap = await upsert([machineAsset(), otherMachineAsset()]);
        const before = await snapshot();

        await upsert([machineAsset({ description: 'second' }), otherMachineAsset()]);

        const after = await snapshot();
        const [changedSource] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.sourceAssetId, 'ep-n1'));
        expect(movedRowIds(before.sources, after.sources)).toEqual([changedSource.id]);
        expect(movedRowIds(before.assets, after.assets)).toEqual([idMap.get('ep-n1')]);
        expect(movedRowIds(before.properties, after.properties)).toEqual([]);
        const [asset] = await db.select().from(supportingAssets).where(eq(supportingAssets.id, idMap.get('ep-n1')!));
        expect(asset.description).toBe('second');
      });

      it('rewrites the source without moving its updated_at when only last_seen_at advances', async () => {
        const idMap = await upsert([machineAsset()]);
        const before = await snapshot();
        const [sourceBefore] = await db.select().from(supportingAssetSources);

        await upsert([machineAsset({ lastSeenAt: new Date('2026-01-09T00:00:00Z') })]);

        const after = await snapshot();
        const [sourceAfter] = await db.select().from(supportingAssetSources);
        expect(movedRowIds(before.sources, after.sources)).toEqual([sourceBefore.id]);
        expect(sourceAfter.lastSeenAt).toEqual(new Date('2026-01-09T00:00:00Z'));
        expect(sourceAfter.updatedAt).toEqual(sourceBefore.updatedAt);
        const [asset] = await db.select().from(supportingAssets).where(eq(supportingAssets.id, idMap.get('ep-n1')!));
        expect(asset.lastSeenAt).toEqual(new Date('2026-01-09T00:00:00Z'));
      });

      describe('ranking between sources of one authority', () => {
        const sharedMachine = (sourceAssetId: string, name: string, lastSeenAt: Date | null, hostname = 'srv-shared'): ConnectorAssetInput => machineAsset({
          sourceAssetId, name, lastSeenAt, properties: { family: 'machine', hostname, hardwareUuid: 'HW-SHARED' },
        });
        const reportedOn = new Date('2026-01-05T00:00:00Z');
        const assetOf = async (sourceAssetId: string) => {
          const [source] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.sourceAssetId, sourceAssetId));
          const [asset] = await db.select().from(supportingAssets).where(eq(supportingAssets.id, source.supportingAssetId));
          return { source, asset };
        };

        it('gives the name to the source still seeing the asset over one silent since its last change', async () => {
          await upsert([sharedMachine('ep-a', 'alpha', reportedOn)]);
          await upsert([sharedMachine('ep-b', 'bravo', reportedOn)]);
          await upsert([sharedMachine('ep-a', 'alpha-renamed', reportedOn)]);
          const { source: alphaRenamed, asset: renamed } = await assetOf('ep-a');
          expect(renamed.name).toBe('alpha-renamed');
          const bravoBefore = (await assetOf('ep-b')).source;

          await upsert([sharedMachine('ep-b', 'bravo', new Date(alphaRenamed.updatedAt.getTime() + 1_000))]);

          const { source: bravoAfter, asset } = await assetOf('ep-b');
          expect(bravoAfter.updatedAt).toEqual(bravoBefore.updatedAt);
          expect(asset.name).toBe('bravo');
        });

        it('keeps a sighting dated in the future from outranking a later change', async () => {
          await upsert([sharedMachine('ep-a', 'alpha', reportedOn)]);
          await upsert([sharedMachine('ep-b', 'bravo', new Date('2100-01-01T00:00:00Z'))]);
          expect((await assetOf('ep-b')).source.lastSeenAt!.getTime()).toBeLessThan(new Date('2100-01-01T00:00:00Z').getTime());

          await upsert([sharedMachine('ep-a', 'alpha-renamed', reportedOn)]);

          expect((await assetOf('ep-a')).asset.name).toBe('alpha-renamed');
        });

        it('ranks a source reporting no sighting on its last change', async () => {
          await upsert([sharedMachine('ep-a', 'alpha', null)]);
          await upsert([sharedMachine('ep-b', 'bravo', reportedOn)]);
          expect((await assetOf('ep-a')).asset.name).toBe('bravo');

          await upsert([sharedMachine('ep-a', 'alpha-renamed', null)]);

          expect((await assetOf('ep-a')).asset.name).toBe('alpha-renamed');
        });

        it('gives the property block to the source whose block changed last', async () => {
          await upsert([sharedMachine('ep-a', 'alpha', reportedOn, 'srv-a')]);
          await upsert([sharedMachine('ep-b', 'bravo', reportedOn, 'srv-old')]);
          await upsert([sharedMachine('ep-a', 'alpha-renamed', reportedOn, 'srv-a')]);
          const assetId = (await assetOf('ep-a')).asset.id;
          const propertiesOf = async () => (await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId))?.properties;
          expect(await propertiesOf()).toMatchObject({ hostname: 'srv-a' });

          await upsert([sharedMachine('ep-b', 'bravo', reportedOn, 'srv-new')]);

          expect(await propertiesOf()).toMatchObject({ hostname: 'srv-new' });
        });
      });

      it('leaves the source alone when the connector reports an older or no last_seen_at', async () => {
        await upsert([machineAsset()]);
        const before = await snapshot();

        await upsert([machineAsset({ lastSeenAt: new Date('2026-01-02T00:00:00Z'), firstSeenAt: new Date('2026-01-03T00:00:00Z') })]);
        await upsert([machineAsset({ lastSeenAt: null, firstSeenAt: null })]);

        const after = await snapshot();
        expect(movedRowIds(before.sources, after.sources)).toEqual([]);
        expect(movedRowIds(before.assets, after.assets)).toEqual([]);
      });

      it('applies a property change and moves its source\'s updated_at when the source row itself is unchanged', async () => {
        await upsert([machineAsset()]);
        const before = await snapshot();
        const [sourceBefore] = await db.select().from(supportingAssetSources);

        await upsert([machineAsset({ properties: { family: 'machine', hostname: 'srv-n1', ipAddresses: ['10.0.0.9'] } })]);

        const after = await snapshot();
        const [sourceAfter] = await db.select().from(supportingAssetSources);
        expect(movedRowIds(before.sources, after.sources)).toEqual([sourceBefore.id]);
        expect(sourceAfter.updatedAt.getTime()).toBeGreaterThan(sourceBefore.updatedAt.getTime());
        expect(movedRowIds(before.properties, after.properties)).toHaveLength(1);
        const [properties] = await db.select().from(supportingAssetMachineProperties);
        expect(properties.ipAddresses).toEqual(['10.0.0.9']);
      });

      it('keeps matching only on the first write of a source, whatever a later payload reports', async () => {
        const first = await upsert([
          machineAsset({ properties: { family: 'machine', hostname: 'srv-n1', hardwareUuid: 'HW-N1' } }),
          machineAsset({ sourceAssetId: 'ep-n2', name: 'srv-n2', properties: { family: 'machine', hostname: 'srv-n2', hardwareUuid: 'HW-N2' } }),
        ]);
        expect(first.get('ep-n1')).not.toBe(first.get('ep-n2'));

        const second = await upsert([
          machineAsset({ properties: { family: 'machine', hostname: 'srv-n1', hardwareUuid: 'HW-N2' } }),
        ]);

        expect(second.get('ep-n1')).toBe(first.get('ep-n1'));
        expect(await db.select().from(supportingAssets)).toHaveLength(2);
      });

      it('writes an AI target block whose one value changed', async () => {
        const aiTarget = (model: string): ConnectorAssetInput => machineAsset({
          sourceAssetId: 'ai-n1', name: 'copilot', categoryId: 'ai_target',
          properties: { family: 'ai_target', endpointUrl: 'https://api.acme.test/v1/chat', model },
        });
        await upsert([aiTarget('gpt-4o')]);

        await upsert([aiTarget('gpt-4o-mini')]);

        const [block] = await db.select().from(supportingAssetAiTargetProperties);
        expect(block.model).toBe('gpt-4o-mini');
        expect(block.endpointUrl).toBe('https://api.acme.test/v1/chat');
      });

      it('writes an identity block whose one value changed', async () => {
        const identity = (jobTitle: string): ConnectorAssetInput => machineAsset({
          sourceAssetId: 'id-n1', name: 'Nadia', categoryId: 'identity',
          properties: { family: 'identity', directoryObjectId: 'obj-n1', jobTitle },
        });
        await upsert([identity('engineer')]);

        await upsert([identity('architect')]);

        const [block] = await db.select().from(supportingAssetIdentityProperties);
        expect(block.jobTitle).toBe('architect');
        expect(block.directoryObjectId).toBe('obj-n1');
      });

      describe('a source column that alone changed', () => {
        const withReported = (over: Partial<ConnectorAssetInput>) => machineAsset({
          externalReference: 'ext-1', url: 'https://srv-n1.test/v1', linkedPerson: 'Ada Lovelace', exposure: 'internal', ...over,
        });

        const cases: Array<{
          column: 'externalReference' | 'reportedUrl' | 'reportedLinkedPerson' | 'reportedExposure',
          before: Partial<ConnectorAssetInput>,
          after: Partial<ConnectorAssetInput>,
          expected: string,
        }> = [
          { column: 'externalReference', before: { externalReference: 'ext-1' }, after: { externalReference: 'ext-2' }, expected: 'ext-2' },
          { column: 'reportedUrl', before: { url: 'https://srv-n1.test/v1' }, after: { url: 'https://srv-n1.test/v2' }, expected: 'https://srv-n1.test/v2' },
          { column: 'reportedLinkedPerson', before: { linkedPerson: 'Ada Lovelace' }, after: { linkedPerson: 'Grace Hopper' }, expected: 'Grace Hopper' },
          { column: 'reportedExposure', before: { exposure: 'internal' }, after: { exposure: 'internet_facing' }, expected: 'internet_facing' },
        ];

        it.each(cases)('writes $column', async ({ column, before, after, expected }) => {
          await upsert([withReported(before)]);
          const sourceBefore = (await rowVersions('supporting_asset_sources'));

          await upsert([withReported(after)]);

          const [source] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.sourceAssetId, 'ep-n1'));
          expect(source[column]).toBe(expected);
          expect(movedRowIds(sourceBefore, await rowVersions('supporting_asset_sources'))).toEqual([source.id]);
        });
      });
    });
  });
});
