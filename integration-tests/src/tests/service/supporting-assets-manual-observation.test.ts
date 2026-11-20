import type { AssetCategory, EventOrigin } from '@app/module';
import { createSecuredSchema, integrationSettings, InvalidAssetClassificationError, SupportingAssetNotFoundError, supportingAssetSources, supportingAssetTags, tags, tagSources } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

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

  describe('manual observation', () => {
    let graphOrigin: EventOrigin;
    let graphConnectorId: string;
    let openaevOrigin: EventOrigin;
    let openaevConnectorId: string;

    beforeEach(async () => {
      const graphAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: graphAccountId, name: 'Graph Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', graphAccountId);
      graphOrigin = { type: 'connector', serviceAccountId: graphAccountId, tenantId: adminTenantId };
      graphConnectorId = (await services.withOrigin(graphOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;

      const openaevAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: openaevAccountId, name: 'OpenAEV Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', openaevAccountId);
      openaevOrigin = { type: 'connector', serviceAccountId: openaevAccountId, tenantId: adminTenantId };
      openaevConnectorId = (await services.withOrigin(openaevOrigin).integrationSettings.getConnectorId('openaev'))!;
    });

    const createManualAsset = async (categoryId: AssetCategory, name: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'unknown', categoryId,
      });
      return id;
    };

    it('lets a connector adopt a hand-created AI target that shares its endpoint and model', async () => {
      const id = await createManualAsset('ai_target', 'Copilot (manual)');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'ai_target', endpointUrl: 'https://api.acme.test/v1/chat', model: 'gpt-4o',
      } });

      const idMap = await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ai-1', connectorId: openaevConnectorId, source: 'openaev', categoryId: 'ai_target', name: 'copilot',
        properties: { family: 'ai_target', endpointUrl: 'https://api.acme.test/v1/chat', model: 'gpt-4o' },
      }]);

      expect(idMap.get('ai-1')).toBe(id);
      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.sources).toHaveLength(2);
      expect(new Set(asset!.sources.map((s) => s.origin))).toEqual(new Set(['user', 'connector']));
    });

    it('adopts a hand-typed MAC address once the connector reports it in its normalized form', async () => {
      const id = await createManualAsset('host', 'Laptop (manual)');
      // Typed as a human would type it; the connector below reports the same physical address
      // already normalized (`aabbccddeeff`), which only a hand-typed value going through the same
      // normalization pipeline as a connector's own input can ever join.
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', macAddresses: ['AA:BB:CC:DD:EE:FF'],
      } });

      const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-mac-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'Device 1',
        properties: { family: 'machine', macAddresses: ['aabbccddeeff'] },
      }]);

      expect(idMap.get('device-mac-1')).toBe(id);
      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.sources).toHaveLength(2);
      expect(new Set(asset!.sources.map((s) => s.origin))).toEqual(new Set(['user', 'connector']));
    });

    it('keeps the name typed at creation after a connector adopts the asset', async () => {
      const id = await createManualAsset('host', 'My Laptop');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', macAddresses: ['AA:BB:CC:DD:EE:FF'],
      } });

      await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-mac-2', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'DESKTOP-XYZ',
        properties: { family: 'machine', macAddresses: ['aabbccddeeff'] },
      }]);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.sources).toHaveLength(2); // confirms the adoption this name-pin protects against actually happened
      expect(asset!.name).toBe('My Laptop');
      expect(asset!.manualValues.some((v) => v.attribute === 'name')).toBe(true);
    });

    it('lets an adopting connector set the exposure and criticality left unknown at creation', async () => {
      const id = await createManualAsset('host', 'Web front (manual)');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', macAddresses: ['AA:BB:CC:DD:EE:01'],
      } });

      await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-mac-3', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'WEB-01',
        exposure: 'internet_facing', criticality: 'high',
        properties: { family: 'machine', macAddresses: ['aabbccddee01'] },
      }]);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.sources).toHaveLength(2);
      expect(asset!.exposure).toBe('internet_facing');
      expect(asset!.criticality).toBe('high');
      expect(asset!.manualValues.map((v) => v.attribute)).not.toEqual(expect.arrayContaining(['exposure']));
      expect(asset!.manualValues.map((v) => v.attribute)).not.toEqual(expect.arrayContaining(['criticality']));
    });

    it('lets the manual block win a field the connector also reports, and falls back to the connector for a field it leaves null', async () => {
      const id = await createManualAsset('host', 'Hand-made');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', macAddresses: ['AA:BB:CC:DD:EE:FF'], platform: 'Windows',
      } });

      await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-mac-3', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'Device 3',
        properties: { family: 'machine', macAddresses: ['aabbccddeeff'], platform: 'Linux', seenIp: '10.0.0.9' },
      }]);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.sources).toHaveLength(2); // the merge below is only meaningful across two distinct sources
      // The manual block outranks the connector on the field they both report (`platform`), but a
      // field it leaves null (`seenIp`) still falls back to the connector.
      expect(asset!.properties).toMatchObject({ family: 'machine', platform: 'windows', seenIp: '10.0.0.9' });
    });

    it('lets a resync erase the manual block and hand the family back to the connector', async () => {
      const id = await createManualAsset('host', 'Hand-made');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', macAddresses: ['AA:BB:CC:DD:EE:FF'],
      } });
      await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-mac-4', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'Device 4',
        properties: { family: 'machine', macAddresses: ['aabbccddeeff'], hostname: 'srv-connector.local' },
      }]);
      const before = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(before!.sources).toHaveLength(2);

      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(id);

      const after = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(after!.sources).toHaveLength(1);
      expect(after!.sources[0].origin).toBe('connector');
      expect(after!.properties).toMatchObject({ family: 'machine', hostname: 'srv-connector.local' });
      expect(after!.manualProperties).toBeNull();
    });

    it('leaves a hand-created asset\'s manual observation untouched by a resync it has no connector observation to resync from', async () => {
      const id = await createManualAsset('host', 'Solo');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', hostname: 'solo.local',
      } });

      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(id);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.sources).toHaveLength(1);
      expect(asset!.sources[0].origin).toBe('user');
      expect(asset!.manualProperties).toMatchObject({ family: 'machine', hostname: 'solo.local' });
    });

    it('does not touch a manually set tag when resyncing an asset with connectors', async () => {
      const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-tag-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'Device 5',
      }]);
      const assetId = idMap.get('device-tag-1')!;
      const tagIdBySourceTagId = await services.withOrigin(openaevOrigin).supportingAssets.upsertTagVocabulary(openaevConnectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);
      const tagId = tagIdBySourceTagId.get('oa-tag-1')!;
      await services.withOrigin(adminOrigin).supportingAssets.setAssetTags(null, [{ supportingAssetId: assetId, tagIds: [tagId] }]);

      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(assetId);

      const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
      expect(links).toHaveLength(1);
      expect(links[0].connectorId).toBeNull();
      expect(links[0].tagId).toBe(tagId);
    });

    it('still filters `user` to a hand-created asset once it carries a manual property observation, not only when it carries none', async () => {
      const id = await createManualAsset('host', 'Hand-made with data');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', hostname: 'hand-made.local',
      } });

      const result = await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: null, source: 'user', mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      });

      expect(result.items.map((a) => a.id)).toContain(id);
      expect(result.total).toBe(1);
    });

    it('lets a connector adopt a hand-typed machine on FQDN, platform and a shared IP', async () => {
      const id = await createManualAsset('host', 'Build server (manual)');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', hostname: 'build-01.acme.local', platform: 'Linux', ipAddresses: ['10.0.0.21'],
      } });

      const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-fqdn-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'BUILD-01',
        properties: { family: 'machine', hostname: 'build-01.acme.local', platform: 'linux', ipAddresses: ['10.0.0.21', '10.0.0.22'] },
      }]);

      expect(idMap.get('device-fqdn-1')).toBe(id);
    });

    it('refuses the MAC match to a connector whose hostname disagrees with the one typed by hand', async () => {
      const id = await createManualAsset('host', 'Laptop (manual)');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', hostname: 'laptop-alice', macAddresses: ['AA:BB:CC:DD:EE:10'],
      } });

      const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-veto-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'LAPTOP-BOB',
        properties: { family: 'machine', hostname: 'laptop-bob', macAddresses: ['aabbccddee10'] },
      }]);

      expect(idMap.get('device-veto-1')).not.toBe(id);
    });

    it('keeps an Unknown exposure chosen on update against the connector that reports another', async () => {
      const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-exposure-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'WEB-02',
        exposure: 'internet_facing',
      }]);
      const id = idMap.get('device-exposure-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { exposure: 'unknown' });
      await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-exposure-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'WEB-02',
        exposure: 'internet_facing',
      }]);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.exposure).toBe('unknown');
      expect(asset!.manualValues.find((v) => v.attribute === 'exposure')?.value).toBe('unknown');
    });

    it('leaves an asset untouched by a resync once the connector that observed it is deleted', async () => {
      const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-orphan-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'ORPHAN-01',
        properties: { family: 'machine', hostname: 'orphan-01.acme.local' },
      }]);
      const id = idMap.get('device-orphan-1')!;
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, {
        name: 'Renamed by hand', properties: { family: 'machine', hostname: 'orphan-01.corp.local' },
      });
      await db.delete(integrationSettings).where(eq(integrationSettings.id, graphConnectorId));

      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(id);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.name).toBe('Renamed by hand');
      expect(asset!.manualProperties).toMatchObject({ family: 'machine', hostname: 'orphan-01.corp.local' });
    });

    it('leaves the hand-typed observation out of the toolbar observation count', async () => {
      await createManualAsset('host', 'Hand-made');
      const handTypedId = await createManualAsset('host', 'Hand-typed');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(handTypedId, { properties: {
        family: 'machine', hostname: 'hand-typed.local',
      } });
      await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-count-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'COUNTED',
      }]);

      const result = await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: null, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      });

      expect(result.total).toBe(3);
      expect(result.totalObservations).toBe(1);
    });

    it("writes nothing onto another tenant's asset, in either tenant", async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const foreignId = uuidv7();
      await services.withOrigin(otherOrigin).supportingAssets.createSupportingAsset({
        id: foreignId, name: 'Foreign', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });

      await expect(services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(foreignId, {
        name: 'Hijacked', properties: { family: 'machine', hostname: 'hijack.local' }, tagNames: ['PCI'],
      })).rejects.toThrow(SupportingAssetNotFoundError);

      expect(await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, foreignId))).toEqual([]);
      expect(await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, foreignId))).toEqual([]);
      expect(await db.select().from(tags)).toEqual([]);
      const foreign = await services.withOrigin(otherOrigin).supportingAssets.getSupportingAsset(foreignId);
      expect(foreign!.name).toBe('Foreign');
    });

    it('scopes a manual observation and its property block to its own tenant', async () => {
      const id = await createManualAsset('host', 'Hand-made');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', hostname: 'srv-manual.local',
      } });

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherViews = createSecuredSchema(db, otherOrigin);
      const ownViews = createSecuredSchema(db, adminOrigin);

      expect(await db.select().from(otherViews.supportingAssetSources)).toEqual([]);
      expect(await db.select().from(otherViews.supportingAssetMachineProperties)).toEqual([]);
      expect((await db.select().from(ownViews.supportingAssetSources)).length).toBe(1);
      expect((await db.select().from(ownViews.supportingAssetMachineProperties)).length).toBe(1);
    });

    it('refuses a property block of another family than the asset category', async () => {
      const id = await createManualAsset('host', 'Hand-made');

      await expect(services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'ai_target', model: 'gpt-4o',
      } })).rejects.toThrow(InvalidAssetClassificationError);
      expect(await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, id))).toEqual([]);
    });

    it('refuses to create an asset with a subcategory of another category', async () => {
      const id = uuidv7();

      await expect(services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'Impossible', exposure: 'unknown', categoryId: 'identity', subcategoryId: 'server',
      })).rejects.toThrow(InvalidAssetClassificationError);
      expect(await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id)).toBeNull();
    });

    it('creates nothing when the properties sent with a new asset are refused', async () => {
      const id = uuidv7();

      await expect(services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'Half-made', exposure: 'unknown', categoryId: 'host', properties: { family: 'ai_target', model: 'gpt-4o' }, tagNames: ['PCI'],
      })).rejects.toThrow(InvalidAssetClassificationError);
      expect(await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id)).toBeNull();
      expect(await db.select().from(tags)).toEqual([]);
    });

    it('keeps the scalar edit unsaved when the properties sent with it are refused', async () => {
      const id = await createManualAsset('host', 'Before');

      await expect(services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, {
        name: 'After', properties: { family: 'ai_target', model: 'gpt-4o' },
      })).rejects.toThrow(InvalidAssetClassificationError);
      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.name).toBe('Before');
    });

    it('refuses an edit that pairs a subcategory with another category than the asset\'s', async () => {
      const id = await createManualAsset('host', 'Hand-made');

      await expect(services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { subcategoryId: 'user_account' }))
        .rejects.toThrow(InvalidAssetClassificationError);
    });

    it('drops a subcategory, and its pin, that the new category no longer contains', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'Server', exposure: 'unknown', categoryId: 'host', subcategoryId: 'server',
      });

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'network_device' });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.subcategoryId).toBeNull();
      expect(asset!.manualValues.map((v) => v.attribute)).not.toContain('subcategory');
    });

    it('keeps the hand-typed block, hidden, when the category moves to a family that has none, and shows it again on the way back', async () => {
      const id = await createManualAsset('host', 'Hand-made');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', hostname: 'hand-made.local',
      } });

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'identity' });

      const moved = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(moved!.properties).toBeNull();
      expect(moved!.manualProperties).toBeNull();
      expect(moved!.propertiesByFamily).toEqual([{
        properties: expect.objectContaining({ family: 'machine', hostname: 'hand-made.local' }),
        manualProperties: expect.objectContaining({ family: 'machine', hostname: 'hand-made.local' }),
      }]);

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'host' });

      const back = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(back!.properties).toMatchObject({ family: 'machine', hostname: 'hand-made.local' });
      expect(back!.manualProperties).toMatchObject({ family: 'machine', hostname: 'hand-made.local' });
    });

    it('keeps the machine block when an AI target block is typed after a category switch, and shows each on its own family', async () => {
      const id = await createManualAsset('host', 'Hand-made');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', hostname: 'hand-made.local',
      } });

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'ai_target', properties: {
        family: 'ai_target', model: 'gpt-4o',
      } });

      const asAiTarget = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asAiTarget!.properties).toMatchObject({ family: 'ai_target', model: 'gpt-4o' });
      expect(asAiTarget!.propertiesByFamily.map((entry) => entry.properties.family)).toEqual(['machine', 'ai_target']);

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'host' });

      const asHost = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asHost!.properties).toMatchObject({ family: 'machine', hostname: 'hand-made.local' });
    });

    it('does not let a connector adopt an asset through a hand-typed block of a family the asset has left', async () => {
      const id = await createManualAsset('host', 'Laptop (manual)');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', macAddresses: ['AA:BB:CC:DD:EE:FF'],
      } });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'identity' });

      const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-left-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'Device 1',
        properties: { family: 'machine', macAddresses: ['aabbccddeeff'] },
      }]);

      expect(idMap.get('device-left-1')).not.toBe(id);
    });

    it('lets a connector adopt the asset through that same block once the category is moved back to its family', async () => {
      const id = await createManualAsset('host', 'Laptop (manual)');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', macAddresses: ['AA:BB:CC:DD:EE:FF'],
      } });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'identity' });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'host' });

      const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-back-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'Device 1',
        properties: { family: 'machine', macAddresses: ['aabbccddeeff'] },
      }]);

      expect(idMap.get('device-back-1')).toBe(id);
    });

    it('does not fuse a second connector onto an asset a person moved out of the family the first one reports', async () => {
      const graphIdMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'device-moved-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'Device 1',
        properties: { family: 'machine', macAddresses: ['aabbccddee02'] },
      }]);
      const id = graphIdMap.get('device-moved-1')!;
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'identity' });

      const openaevIdMap = await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'endpoint-moved-1', connectorId: openaevConnectorId, source: 'openaev', categoryId: 'host', name: 'device-1',
        properties: { family: 'machine', macAddresses: ['aabbccddee02'] },
      }]);

      expect(openaevIdMap.get('endpoint-moved-1')).not.toBe(id);
      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.properties).toBeNull();
    });

    it('keeps the hand-typed block when the category moves within the same family', async () => {
      const id = await createManualAsset('host', 'Hand-made');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', hostname: 'hand-made.local',
      } });

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'network_device' });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.manualProperties).toMatchObject({ family: 'machine', hostname: 'hand-made.local' });
    });
  });

  describe('manual tags and properties', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;

    beforeEach(async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      connectorOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
      connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('openaev'))!;
    });

    const createManualAsset = async (name: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      return id;
    };

    const createConnectorAssetTaggedWith = async (tagIds: Array<string>) => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'ep-1', categoryId: 'host', connectorId, source: 'openaev', name: 'srv-01' },
      ]);
      const assetId = idMap.get('ep-1')!;
      await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [{ supportingAssetId: assetId, tagIds }]);
      return assetId;
    };

    it('shows one chip for a tag both a connector and a person put on the same asset, while keeping both authors\' links', async () => {
      const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);
      const tagId = tagIdBySourceTagId.get('oa-tag-1')!;
      const assetId = await createConnectorAssetTaggedWith([tagId]);

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['Critical'] });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.tags.map((t) => t.id)).toEqual([tagId]);

      // The dedupe above must come from the reader, not from a lost link: two authors still assert it.
      const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
      expect(links).toHaveLength(2);
      expect(new Set(links.map((l) => l.connectorId))).toEqual(new Set([connectorId, null]));
      expect(new Set(links.map((l) => l.tagId))).toEqual(new Set([tagId]));
    });

    it('creates a new vocabulary entry with a manual origin when the tag name does not exist yet', async () => {
      const assetId = await createManualAsset('Solo asset');

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['Brand new tag'] });

      const tagRows = await db.select().from(tags).where(eq(tags.name, 'Brand new tag'));
      expect(tagRows).toHaveLength(1);
      const sourceRows = await db.select().from(tagSources).where(eq(tagSources.tagId, tagRows[0].id));
      expect(sourceRows).toHaveLength(1);
      expect(sourceRows[0].connectorId).toBeNull();
      expect(sourceRows[0].sourceTagId).toBeNull();

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.tags.map((t) => t.name)).toEqual(['Brand new tag']);
    });

    it('attaches to an existing vocabulary entry instead of creating a duplicate when the name already exists', async () => {
      const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-2', name: 'Reviewed', color: '#00ff00' },
      ]);
      const tagId = tagIdBySourceTagId.get('oa-tag-2')!;
      const assetId = await createManualAsset('Needs review');

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['Reviewed'] });

      expect(await db.select().from(tags)).toHaveLength(1);
      const sourceRows = await db.select().from(tagSources).where(eq(tagSources.tagId, tagId));
      expect(sourceRows).toHaveLength(2);
      expect(sourceRows.some((s) => s.connectorId === null && s.sourceTagId === null)).toBe(true);
    });

    it('records an XTM One push as its own tag origin, and a push and a person each replace only their own tags', async () => {
      const assetId = await createManualAsset('Pushed asset');

      await services.withOrigin(connectorOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['Pushed', 'Shared by both'] });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['Shared by both', 'Typed'] });

      const managed = await services.withOrigin(adminOrigin).supportingAssets.listManagedTags();
      const sourcesOf = (name: string) => managed.find((tag) => tag.name === name)?.sources.map((source) => source.kind).toSorted();
      expect(sourcesOf('Pushed')).toEqual(['xtm_one']);
      expect(sourcesOf('Shared by both')).toEqual(['manual', 'xtm_one']);
      expect(sourcesOf('Typed')).toEqual(['manual']);

      // A new push without "Pushed" removes only XTM One's link: the person's tags stay.
      await services.withOrigin(connectorOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['Shared by both'] });
      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.tags.map((t) => t.name).toSorted()).toEqual(['Shared by both', 'Typed']);
      const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
      expect(links.filter((l) => l.pushedByXtmOne)).toHaveLength(1);
      expect(links.filter((l) => !l.pushedByXtmOne)).toHaveLength(2);
    });

    it('removing a manual tag does not remove a connector\'s link to the same tag', async () => {
      const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-3', name: 'Shared', color: null },
      ]);
      const tagId = tagIdBySourceTagId.get('oa-tag-3')!;
      const assetId = await createConnectorAssetTaggedWith([tagId]);
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['Shared'] });
      expect(await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId))).toHaveLength(2);

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: [] });

      const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
      expect(links).toHaveLength(1);
      expect(links[0].connectorId).toBe(connectorId);
      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.tags.map((t) => t.id)).toEqual([tagId]);
    });

    it('leaves an orphaned manual-only tag in the tenant vocabulary after its last link is removed', async () => {
      const assetId = await createManualAsset('Orphan host');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['Temp tag'] });
      const [tagRow] = await db.select().from(tags).where(eq(tags.name, 'Temp tag'));

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: [] });

      expect(await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId))).toHaveLength(0);
      expect(await db.select().from(tags).where(eq(tags.id, tagRow.id))).toHaveLength(1);
      const vocabulary = await services.withOrigin(adminOrigin).supportingAssets.listTags();
      expect(vocabulary.map((t) => t.id)).toContain(tagRow.id);
    });

    it('round-trips a manually set property block through getSupportingAsset, in both properties and manualProperties', async () => {
      const id = await createManualAsset('Manual laptop');

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: {
        family: 'machine', hostname: 'srv-roundtrip.local', platform: 'Windows', macAddresses: ['AA:BB:CC:DD:EE:00'],
      } });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      const expected = { family: 'machine', hostname: 'srv-roundtrip.local', platform: 'windows', macAddresses: ['aabbccddee00'] };
      expect(asset!.properties).toMatchObject(expected);
      expect(asset!.manualProperties).toMatchObject(expected);
    });

    it('edits the properties of a manual asset created with them, every time, even when the source row itself does not change', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'Typed host', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
        properties: { family: 'machine', hostname: 'srv-first.local' },
      });

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: { family: 'machine', hostname: 'srv-second.local' } });
      expect((await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id))!.manualProperties).toMatchObject({ hostname: 'srv-second.local' });

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { properties: { family: 'machine', hostname: 'srv-third.local' } });
      expect((await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id))!.manualProperties).toMatchObject({ hostname: 'srv-third.local' });
    });

    it('lists the tenant\'s whole tag vocabulary, not just tags an asset carries, isolated per tenant', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-4', name: 'Unused', color: '#123456' },
      ]);
      const assetId = await createManualAsset('Tagged host');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['Hand tag'] });

      const vocabulary = await services.withOrigin(adminOrigin).supportingAssets.listTags();
      expect(new Set(vocabulary.map((t) => t.name))).toEqual(new Set(['Unused', 'Hand tag']));

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherVocabulary = await services.withOrigin(otherOrigin).supportingAssets.listTags();
      expect(otherVocabulary).toHaveLength(0);
    });
  });
});
