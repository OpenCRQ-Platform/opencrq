import type { AssetCategory, ConnectorAssetInput, EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceSources, cve, supportingAssetManualValues, supportingAssetSources } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const insertCve = async (tenantId: string, cveTextId: string): Promise<string> => {
  const id = uuidv7();
  await db.insert(cve).values([{ id, tenantId, cveId: cveTextId }]);
  return id;
};

/** What the asset's findings tab lists, in every state. */
const findingsOf = async (origin: EventOrigin, supportingAssetId: string) => (await services.withOrigin(origin).findingScore.listAssetFindings({
  supportingAssetId, page: 1, limit: 50, state: null, mitreTechniqueExternalId: null, expectationType: null, search: null, sortBy: 'name', sortDesc: false,
})).items;

describe('Supporting Assets Service', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
  });

  describe('CRUD', () => {
    it('should create and retrieve a supporting asset', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id,
        name: 'Web Server Apache',
        description: 'Main web server',
        ownerId: null,
        exposure: 'internet_facing',
        categoryId: 'host',
      });

      const result = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(result).toBeTruthy();
      expect(result!.name).toBe('Web Server Apache');
      expect(result!.exposure).toBe('internet_facing');
      expect(result!.categoryId).toBe('host');
      expect(result!.criticality).toBe('unknown');
    });

    it('should create with explicit criticality', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id,
        name: 'Critical DB',
        description: null,
        ownerId: null,
        exposure: 'internal',
        categoryId: 'container_workload',
        criticality: 'high',
      });

      const result = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(result).toBeTruthy();
      expect(result!.criticality).toBe('high');
    });

    it('should create with null name', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id,
        name: null,
        description: null,
        ownerId: null,
        exposure: 'unknown',
        categoryId: 'cloud_resource',
      });

      const result = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(result).toBeTruthy();
      expect(result!.name).toBeNull();
    });

    it('should update a supporting asset', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'Original', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, {
        name: 'Updated',
        exposure: 'internet_facing',
      });

      const updated = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(updated).toBeTruthy();
      expect(updated!.name).toBe('Updated');
      expect(updated!.exposure).toBe('internet_facing');
    });

    it('should delete supporting assets', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'To Delete', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });

      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([id]);

      const result = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(result).toBeNull();
    });
  });

  describe('family provenance', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;

    const resync = async (categoryId: AssetCategory, overrides: Partial<ConnectorAssetInput> = {}) =>
      services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'dev-1', categoryId, connectorId, source: 'microsoft_graph', name: 'Device 1', description: 'Reported by the connector', ...overrides },
      ]);

    beforeEach(async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId,
        name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
      connectorOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
      const resolved = await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('microsoft_graph');
      connectorId = resolved!;
    });

    it('resolves the category a connector reports, with no manual value recorded', async () => {
      const idMap = await resync('host');
      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('dev-1')!);

      expect(asset!.categoryId).toBe('host');
      expect(asset!.manualValues).toHaveLength(0);
    });

    it('a hand-created asset has no observation, but carries the scalars it was given as pinned manual values, an unknown one excepted', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'Hand-made', description: null, ownerId: null, exposure: 'internal', criticality: 'unknown', categoryId: 'identity',
      });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.sources).toHaveLength(0);
      expect(asset!.manualValues).toHaveLength(3);
      expect(asset!.manualValues.find((v) => v.attribute === 'name')?.value).toBe('Hand-made');
      expect(asset!.manualValues.find((v) => v.attribute === 'exposure')?.value).toBe('internal');
      expect(asset!.manualValues.find((v) => v.attribute === 'category')?.value).toBe('identity');
      expect(asset!.manualValues.some((v) => v.attribute === 'criticality')).toBe(false);
    });

    it('leaves a hand-created asset\'s manual values untouched by a resync it has nothing to resync from', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'Hand-made', description: null, ownerId: null, exposure: 'unknown', categoryId: 'identity',
      });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { categoryId: 'host' });

      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(id);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(asset!.categoryId).toBe('host');
      expect(asset!.manualValues.some((v) => v.attribute === 'category')).toBe(true);
    });

    it('keeps a hand-corrected family across a resync', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { categoryId: 'identity' });
      await resync('network_device');

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.categoryId).toBe('identity');
      expect(asset!.manualValues.some((v) => v.attribute === 'category')).toBe(true);
    });

    it('lets a resync update a family the connector still owns', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { criticality: 'high' });
      await resync('network_device');

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.categoryId).toBe('network_device');
      expect(asset!.manualValues.some((v) => v.attribute === 'category')).toBe(false);
    });

    it('resyncing with connectors clears a hand-corrected family and lets the next sync update it', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { categoryId: 'identity' });
      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(assetId);
      await resync('network_device');

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.categoryId).toBe('network_device');
      expect(asset!.manualValues).toHaveLength(0);
    });

    it('keeps a hand-set name across a resync', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { name: 'Custom Name' });
      await resync('host');

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.name).toBe('Custom Name');
      expect(asset!.manualValues.some((v) => v.attribute === 'name')).toBe(true);
    });

    it('resyncing with connectors reverts a hand-set name and lets the next sync update it', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { name: 'Custom Name' });
      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(assetId);

      const resynced = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(resynced!.name).toBe('Device 1');
      expect(resynced!.manualValues).toHaveLength(0);
    });

    it('clearing a hand-set name deletes its pin, so a later resync restores what the connector reports', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { name: 'Custom Name' });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { name: null });
      await resync('host');

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.name).toBe('Device 1');
      expect(asset!.manualValues.some((v) => v.attribute === 'name')).toBe(false);
    });

    it('keeps a hand-set description across a resync', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { description: 'Typed by hand' });
      await resync('host');

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.description).toBe('Typed by hand');
      expect(asset!.manualValues.some((v) => v.attribute === 'description')).toBe(true);
    });

    it('resyncing with connectors reverts a hand-set description and lets the next sync update it', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { description: 'Typed by hand' });
      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(assetId);

      const resynced = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(resynced!.description).toBe('Reported by the connector');
      expect(resynced!.manualValues).toHaveLength(0);
    });

    it('clearing a hand-set description deletes its pin, so a later resync restores what the connector reports', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { description: 'Typed by hand' });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { description: null });
      await resync('host');

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.description).toBe('Reported by the connector');
      expect(asset!.manualValues.some((v) => v.attribute === 'description')).toBe(false);
    });

    it('keeps a hand-set subcategory across a resync', async () => {
      const idMap = await resync('host', { subcategoryId: 'server' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { subcategoryId: 'workstation' });
      await resync('host', { subcategoryId: 'server' });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.subcategoryId).toBe('workstation');
      expect(asset!.manualValues.some((v) => v.attribute === 'subcategory')).toBe(true);
    });

    it('resyncing with connectors reverts a hand-set subcategory and lets the next sync update it', async () => {
      const idMap = await resync('host', { subcategoryId: 'server' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { subcategoryId: 'workstation' });
      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(assetId);

      const resynced = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(resynced!.subcategoryId).toBe('server');
      expect(resynced!.manualValues).toHaveLength(0);
    });

    it('clearing a hand-set subcategory deletes its pin, so a later resync restores what the connector reports', async () => {
      const idMap = await resync('host', { subcategoryId: 'server' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { subcategoryId: 'workstation' });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { subcategoryId: null });
      await resync('host', { subcategoryId: 'server' });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.subcategoryId).toBe('server');
      expect(asset!.manualValues.some((v) => v.attribute === 'subcategory')).toBe(false);
    });

    it('drops a hand-set subcategory once it no longer belongs to the category a connector reports', async () => {
      const idMap = await resync('host', { subcategoryId: 'server' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { subcategoryId: 'workstation' });
      // 'router' belongs to 'network_device', not 'host': the pinned 'workstation' subcategory no
      // longer describes the category the connector now reports, and is dropped rather than kept
      // alongside a category it does not belong to.
      await resync('network_device', { subcategoryId: 'router' });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.categoryId).toBe('network_device');
      expect(asset!.subcategoryId).toBeNull();
      expect(asset!.manualValues.some((v) => v.attribute === 'subcategory')).toBe(true);
    });

    it('keeps a hand-set url across a resync', async () => {
      const idMap = await resync('web_application', { url: 'https://reported.example.com' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { url: 'https://hand-typed.example.com' });
      await resync('web_application', { url: 'https://reported.example.com' });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.url).toBe('https://hand-typed.example.com');
      expect(asset!.manualValues.some((v) => v.attribute === 'url')).toBe(true);
    });

    it('resyncing with connectors reverts a hand-set url and lets the next sync update it', async () => {
      const idMap = await resync('web_application', { url: 'https://reported.example.com' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { url: 'https://hand-typed.example.com' });
      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(assetId);

      const resynced = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(resynced!.url).toBe('https://reported.example.com');
      expect(resynced!.manualValues).toHaveLength(0);
    });

    it('clearing a hand-set url deletes its pin, so a later resync restores what the connector reports', async () => {
      const idMap = await resync('web_application', { url: 'https://reported.example.com' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { url: 'https://hand-typed.example.com' });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { url: null });
      await resync('web_application', { url: 'https://reported.example.com' });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.url).toBe('https://reported.example.com');
      expect(asset!.manualValues.some((v) => v.attribute === 'url')).toBe(false);
    });

    it('keeps a hand-set linked person across a resync', async () => {
      const idMap = await resync('identity', { linkedPerson: 'Jane Doe' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { linkedPerson: 'John Smith' });
      await resync('identity', { linkedPerson: 'Jane Doe' });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.linkedPerson).toBe('John Smith');
      expect(asset!.manualValues.some((v) => v.attribute === 'linkedPerson')).toBe(true);
    });

    it('resyncing with connectors reverts a hand-set linked person and lets the next sync update it', async () => {
      const idMap = await resync('identity', { linkedPerson: 'Jane Doe' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { linkedPerson: 'John Smith' });
      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(assetId);

      const resynced = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(resynced!.linkedPerson).toBe('Jane Doe');
      expect(resynced!.manualValues).toHaveLength(0);
    });

    it('clearing a hand-set linked person deletes its pin, so a later resync restores what the connector reports', async () => {
      const idMap = await resync('identity', { linkedPerson: 'Jane Doe' });
      const assetId = idMap.get('dev-1')!;

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { linkedPerson: 'John Smith' });
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { linkedPerson: null });
      await resync('identity', { linkedPerson: 'Jane Doe' });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.linkedPerson).toBe('Jane Doe');
      expect(asset!.manualValues.some((v) => v.attribute === 'linkedPerson')).toBe(false);
    });

    it('takes an asset\'s sources, manual values and its findings\' sources down with it', async () => {
      const idMap = await resync('host');
      const assetId = idMap.get('dev-1')!;
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { categoryId: 'identity' });
      const cveUuid = await insertCve(adminTenantId, 'CVE-2024-777');
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(),
        evaluatedAt: new Date(),
        supportingAssetId: assetId,
        cveId: cveUuid,
        mitreTechniqueId: null,
        expectationType: null,
        isExposed: true,
        connectorId,
        sourceFindingId: 'dev-1:CVE-2024-777',
      }]);
      expect(await db.select().from(supportingAssetSources)).toHaveLength(1);
      expect(await db.select().from(supportingAssetManualValues)).toHaveLength(1);
      expect(await db.select().from(assetEvidenceSources)).toHaveLength(1);

      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([assetId]);

      expect(await db.select().from(supportingAssetSources)).toHaveLength(0);
      expect(await db.select().from(supportingAssetManualValues)).toHaveLength(0);
      expect(await db.select().from(assetEvidence)).toHaveLength(0);
      expect(await db.select().from(assetEvidenceSources)).toHaveLength(0);
    });

    it('lets a connector overwrite a family with generic_asset', async () => {
      const idMap = await resync('host');
      await resync('generic_asset');

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('dev-1')!);
      expect(asset!.categoryId).toBe('generic_asset');
    });
  });

  describe('cross-connector merge', () => {
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

    it('resolves two connectors sharing a hardware uuid onto one canonical asset and reprojects the wider window', async () => {
      const graphMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'mde-1', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'srv-01',
        properties: { family: 'machine', hostname: 'srv-01', hardwareUuid: 'HW-UUID-1' },
        firstSeenAt: new Date('2026-01-01T00:00:00Z'), lastSeenAt: new Date('2026-01-10T00:00:00Z'),
      }]);
      const openaevMap = await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-1', connectorId: openaevConnectorId, source: 'openaev', categoryId: 'host', name: 'srv-01 (OpenAEV)',
        properties: { family: 'machine', hardwareUuid: 'HW-UUID-1' },
        // OpenAEV never reports a first-seen date, and its last contact is later than Defender's.
        firstSeenAt: null, lastSeenAt: new Date('2026-01-20T00:00:00Z'),
      }]);

      const assetId = graphMap.get('mde-1')!;
      expect(openaevMap.get('ep-1')).toBe(assetId);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset!.sources).toHaveLength(2);
      expect(asset!.firstSeenAt).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(asset!.lastSeenAt).toEqual(new Date('2026-01-20T00:00:00Z'));
    });

    it('does not fabricate first/last seen dates for a brand new asset an agentless connector reports with none', async () => {
      const idMap = await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-2', connectorId: openaevConnectorId, source: 'openaev', categoryId: 'host', name: 'agentless-ep',
        firstSeenAt: null, lastSeenAt: null,
      }]);

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('ep-2')!);
      expect(asset!.firstSeenAt).toBeNull();
      expect(asset!.lastSeenAt).toBeNull();
    });

    it('keeps both connectors\' provenance when they report the same CVE on the asset they were merged onto', async () => {
      const graphMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'mde-2', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'srv-02',
        properties: { family: 'machine', hardwareUuid: 'HW-UUID-2' },
      }]);
      const openaevMap = await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-3', connectorId: openaevConnectorId, source: 'openaev', categoryId: 'host', name: 'srv-02 (OpenAEV)',
        properties: { family: 'machine', hardwareUuid: 'HW-UUID-2' },
      }]);
      const assetId = graphMap.get('mde-2')!;
      expect(openaevMap.get('ep-3')).toBe(assetId);
      const cveUuid = await insertCve(adminTenantId, 'CVE-2026-8888');

      await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(), supportingAssetId: assetId, cveId: cveUuid, mitreTechniqueId: null, expectationType: null,
        isExposed: true, connectorId: graphConnectorId, sourceFindingId: `${assetId}:CVE-2026-8888`, evaluatedAt: new Date(),
      }]);
      await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(), supportingAssetId: assetId, cveId: cveUuid, mitreTechniqueId: null, expectationType: null,
        isExposed: true, connectorId: openaevConnectorId, sourceFindingId: `${assetId}:CVE-2026-8888`, evaluatedAt: new Date(),
      }]);

      const evidences = await findingsOf(adminOrigin, assetId);
      expect(evidences).toHaveLength(1);
      const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidences[0].evidenceId);
      expect(detail!.sources).toHaveLength(2);
    });

    it('merges a later Graph observation onto an asset OpenAEV already registered via that same MDE machine id', async () => {
      const openaevMap = await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'ep-4', connectorId: openaevConnectorId, source: 'openaev', categoryId: 'host', name: 'srv-04 (OpenAEV)',
        properties: { family: 'machine', agentExternalReference: 'mde-device-99', agentExecutorType: 'mde_executor' },
      }]);
      const openaevAssetId = openaevMap.get('ep-4')!;

      const graphMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'mde-device-99', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'srv-04',
      }]);

      expect(graphMap.get('mde-device-99')).toBe(openaevAssetId);
      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(openaevAssetId);
      expect(asset!.sources).toHaveLength(2);
    });

    it('preserves a Defender self-merge alias even when the survivor\'s own row is deduped after it in the same batch', async () => {
      const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([
        {
          sourceAssetId: 'device-old', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host',
          name: 'old-name', mergedIntoSourceAssetId: 'device-new',
        },
        { sourceAssetId: 'device-new', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host', name: 'new-name' },
      ]);

      expect(idMap.get('device-old')).toBeDefined();
      expect(idMap.get('device-old')).toBe(idMap.get('device-new'));
    });

    describe('a Defender self-merge never overwrites what the survivor reports', () => {
      const survivor = () => ({
        sourceAssetId: 'device-new', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host' as const,
        name: 'new-name', lastSeenAt: new Date('2026-09-20T00:00:00Z'),
        properties: { family: 'machine' as const, hostname: 'new-name', ipAddresses: ['10.0.0.2'] },
      });
      const merged = () => ({
        sourceAssetId: 'device-old', connectorId: graphConnectorId, source: 'microsoft_graph', categoryId: 'host' as const,
        name: 'old-name', lastSeenAt: new Date('2026-06-01T00:00:00Z'), mergedIntoSourceAssetId: 'device-new',
        properties: { family: 'machine' as const, hostname: 'old-name', ipAddresses: ['10.0.0.1'] },
      });
      const expectSurvivorDetails = async (assetId: string) => {
        const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
        expect(asset!.name).toBe('new-name');
        expect(asset!.lastSeenAt).toEqual(new Date('2026-09-20T00:00:00Z'));
        expect(asset!.properties).toMatchObject({ ipAddresses: ['10.0.0.2'] });
      };

      it('should keep the survivor\'s details when the merged device comes after it in the same batch', async () => {
        const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([survivor(), merged()]);

        expect(idMap.get('device-old')).toBe(idMap.get('device-new'));
        await expectSurvivorDetails(idMap.get('device-new')!);
      });

      it('should keep the survivor\'s details when the merged device comes in a later batch', async () => {
        const survivorMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([survivor()]);
        const mergedMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([merged()]);

        expect(mergedMap.get('device-old')).toBe(survivorMap.get('device-new'));
        await expectSurvivorDetails(survivorMap.get('device-new')!);
      });

      it('should describe the survivor from the merged device until the survivor\'s own row arrives', async () => {
        const mergedMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([merged()]);
        const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(mergedMap.get('device-old')!);
        expect(asset!.name).toBe('old-name');

        const survivorMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([survivor()]);

        expect(survivorMap.get('device-new')).toBe(mergedMap.get('device-old'));
        await expectSurvivorDetails(survivorMap.get('device-new')!);
      });

      it('should keep updating a device whose merge target is itself', async () => {
        const selfMerged = { ...survivor(), mergedIntoSourceAssetId: 'device-new' };
        await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([{
          ...selfMerged, name: 'old-name', lastSeenAt: new Date('2026-06-01T00:00:00Z'),
          properties: { family: 'machine' as const, hostname: 'old-name', ipAddresses: ['10.0.0.1'] },
        }]);
        const idMap = await services.withOrigin(graphOrigin).supportingAssets.bulkUpsertAssets([selfMerged]);

        await expectSurvivorDetails(idMap.get('device-new')!);
      });
    });
  });
});
