import type { AffectedAssetsFlaw, AffectedAssetSortKey, ConnectorAssetInput, EventOrigin } from '@app/module';
import { cve, supportingAssets, supportingAssetSources, TECHNIQUE_T1003 } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const insertCve = async (tenantId: string, cveTextId: string): Promise<string> => {
  const id = uuidv7();
  await db.insert(cve).values([{ id, tenantId, cveId: cveTextId }]);
  return id;
};

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

  describe('reported overview fields', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;
    let otherConnectorOrigin: EventOrigin;
    let otherConnectorId: string;

    beforeEach(async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      connectorOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
      connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('openaev'))!;

      const otherAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: otherAccountId, name: 'Graph Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', otherAccountId);
      otherConnectorOrigin = { type: 'connector', serviceAccountId: otherAccountId, tenantId: adminTenantId };
      otherConnectorId = (await services.withOrigin(otherConnectorOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
    });

    interface OverviewFields { description: string | null, url: string | null, linkedPerson: string | null }
    const fields = (over: Partial<OverviewFields> = {}): OverviewFields => ({ description: null, url: null, linkedPerson: null, ...over });

    const genericAsset = (over: Partial<ConnectorAssetInput> = {}): ConnectorAssetInput => ({
      sourceAssetId: 'app-1', connectorId, source: 'openaev', categoryId: 'saas_application', name: 'Payroll', description: null,
      firstSeenAt: new Date('2026-01-01T00:00:00Z'), lastSeenAt: new Date('2026-01-05T00:00:00Z'),
      ...over,
    });
    const upsert = (assets: Array<ConnectorAssetInput>) => services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets(assets);
    const update = (
      entries: Array<{ sourceAssetId: string } & OverviewFields>,
      forConnectorId = connectorId,
      origin = connectorOrigin,
    ) => services.withOrigin(origin).supportingAssets.updateReportedOverviewFields({ connectorId: forConnectorId, entries });
    const sourceOf = async (sourceAssetId: string, forConnectorId = connectorId) =>
      (await db.select().from(supportingAssetSources)).find((row) => row.sourceAssetId === sourceAssetId && row.connectorId === forConnectorId);
    const assetOf = async (assetId: string) => (await db.select().from(supportingAssets).where(eq(supportingAssets.id, assetId)))[0];
    const snapshot = async () => ({
      assets: await rowVersions('supporting_assets'),
      sources: await rowVersions('supporting_asset_sources'),
    });

    describe('getReportedOverviewFields', () => {
      const read = (sourceAssetIds: Array<string>, forConnectorId = connectorId, origin = connectorOrigin) =>
        services.withOrigin(origin).supportingAssets.getReportedOverviewFields(forConnectorId, sourceAssetIds);

      it('maps each source asset id to the description, url and linked person its source reports', async () => {
        await upsert([
          genericAsset({ sourceAssetId: 'app-1', description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' }),
          genericAsset({ sourceAssetId: 'app-2', name: 'Wiki' }),
        ]);

        expect(await read(['app-1', 'app-2'])).toEqual(new Map([
          ['app-1', fields({ description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' })],
          ['app-2', fields()],
        ]));
      });

      it('leaves out a source asset the connector never wrote', async () => {
        await upsert([genericAsset({ description: 'Payroll application' })]);

        expect(await read(['app-1', 'app-unknown'])).toEqual(new Map([['app-1', fields({ description: 'Payroll application' })]]));
      });

      it('reads the sources of the requested connector only', async () => {
        await upsert([genericAsset({ description: 'From OpenAEV' })]);
        await services.withOrigin(otherConnectorOrigin).supportingAssets.bulkUpsertAssets([
          genericAsset({ connectorId: otherConnectorId, source: 'microsoft_graph', description: 'From Graph' }),
        ]);

        expect(await read(['app-1'])).toEqual(new Map([['app-1', fields({ description: 'From OpenAEV' })]]));
        expect(await read(['app-1'], otherConnectorId)).toEqual(new Map([['app-1', fields({ description: 'From Graph' })]]));
      });

      it('reads more source assets than one statement carries', async () => {
        const inputs = Array.from({ length: 1100 }, (_, i) => genericAsset({ sourceAssetId: `app-${i}`, name: `App ${i}`, description: `Description ${i}` }));
        await upsert(inputs);

        const found = await read(inputs.map((input) => input.sourceAssetId));

        expect(found.size).toBe(1100);
        expect(found.get('app-1099')).toEqual(fields({ description: 'Description 1099' }));
      });

      it('answers an empty map for an empty list', async () => {
        expect(await read([])).toEqual(new Map());
      });

      it('does not read the sources of another tenant', async () => {
        await upsert([genericAsset({ description: 'Payroll application' })]);
        const tenantBId = await createTenant(services, adminUserId);

        const found = await read(['app-1'], connectorId, { type: 'client', userId: adminUserId, tenantId: tenantBId });

        expect(found).toEqual(new Map());
      });
    });

    describe('updateReportedOverviewFields', () => {
      it('writes the description, url and linked person on the source and reprojects them onto the asset', async () => {
        const idMap = await upsert([genericAsset()]);

        await update([{ sourceAssetId: 'app-1', ...fields({ description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' }) }]);

        expect(await sourceOf('app-1')).toMatchObject({ reportedDescription: 'Payroll application', reportedUrl: 'https://payroll.test', reportedLinkedPerson: 'Ada Lovelace' });
        expect(await assetOf(idMap.get('app-1')!)).toMatchObject({ description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' });
      });

      it('writes a field alone when only that one changed, leaving the others as they were', async () => {
        const idMap = await upsert([genericAsset({ description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' })]);

        await update([{ sourceAssetId: 'app-1', ...fields({ description: 'Payroll application', url: 'https://payroll.test/v2', linkedPerson: 'Ada Lovelace' }) }]);

        expect(await sourceOf('app-1')).toMatchObject({ reportedDescription: 'Payroll application', reportedUrl: 'https://payroll.test/v2', reportedLinkedPerson: 'Ada Lovelace' });
        expect((await assetOf(idMap.get('app-1')!)).url).toBe('https://payroll.test/v2');
      });

      it('stores the url and the linked person the way an upsert does, trimmed and never blank', async () => {
        await upsert([genericAsset()]);

        await update([{ sourceAssetId: 'app-1', ...fields({ url: '  https://payroll.test  ', linkedPerson: '   ' }) }]);

        expect(await sourceOf('app-1')).toMatchObject({ reportedUrl: 'https://payroll.test', reportedLinkedPerson: null });
      });

      it('touches neither the source nor the asset when nothing changed', async () => {
        await upsert([genericAsset({ description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' })]);
        const before = await snapshot();
        const sourceBefore = await sourceOf('app-1');

        await update([{ sourceAssetId: 'app-1', ...fields({ description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' }) }]);

        const after = await snapshot();
        expect(movedRowIds(before.sources, after.sources)).toEqual([]);
        expect(movedRowIds(before.assets, after.assets)).toEqual([]);
        expect((await sourceOf('app-1'))?.updatedAt).toEqual(sourceBefore?.updatedAt);
      });

      it('writes only the entries that changed', async () => {
        const idMap = await upsert([
          genericAsset({ sourceAssetId: 'app-1', description: 'Same' }),
          genericAsset({ sourceAssetId: 'app-2', name: 'Wiki', description: 'Before' }),
        ]);
        const before = await snapshot();

        await update([
          { sourceAssetId: 'app-1', ...fields({ description: 'Same' }) },
          { sourceAssetId: 'app-2', ...fields({ description: 'After' }) },
        ]);

        const after = await snapshot();
        expect(movedRowIds(before.sources, after.sources)).toEqual([(await sourceOf('app-2'))!.id]);
        expect(movedRowIds(before.assets, after.assets)).toEqual([idMap.get('app-2')]);
      });

      it('moves the updated_at of the source it changes, so the freshest report keeps winning', async () => {
        await upsert([genericAsset({ description: 'Before' })]);
        const sourceBefore = await sourceOf('app-1');

        await update([{ sourceAssetId: 'app-1', ...fields({ description: 'After' }) }]);

        expect((await sourceOf('app-1'))!.updatedAt.getTime()).toBeGreaterThan(sourceBefore!.updatedAt.getTime());
      });

      it('clears every field everywhere when it is emptied in the source system', async () => {
        const idMap = await upsert([genericAsset({ description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' })]);

        await update([{ sourceAssetId: 'app-1', ...fields() }]);

        expect(await sourceOf('app-1')).toMatchObject({ reportedDescription: null, reportedUrl: null, reportedLinkedPerson: null });
        expect(await assetOf(idMap.get('app-1')!)).toMatchObject({ description: null, url: null, linkedPerson: null });
      });

      it('lets a hand-set description keep winning the asset\'s own value', async () => {
        const idMap = await upsert([genericAsset({ description: 'Before' })]);
        const assetId = idMap.get('app-1')!;
        await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { description: 'Typed by hand' });

        await update([{ sourceAssetId: 'app-1', ...fields({ description: 'After' }) }]);

        expect((await sourceOf('app-1'))?.reportedDescription).toBe('After');
        expect((await assetOf(assetId)).description).toBe('Typed by hand');
      });

      it('reprojects an asset consolidated from two sources onto the freshest report', async () => {
        const machine = (sourceAssetId: string, forConnectorId: string, source: string, description: string | null): ConnectorAssetInput => ({
          sourceAssetId, connectorId: forConnectorId, source, categoryId: 'host', name: 'srv-shared', description,
          properties: { family: 'machine', hostname: 'srv-shared', hardwareUuid: 'HW-SHARED' },
        });
        const idMap = await upsert([machine('ep-1', connectorId, 'openaev', null)]);
        await services.withOrigin(otherConnectorOrigin).supportingAssets.bulkUpsertAssets([machine('dev-1', otherConnectorId, 'microsoft_graph', 'From Graph')]);
        const assetId = idMap.get('ep-1')!;

        await update([{ sourceAssetId: 'ep-1', ...fields({ description: 'From OpenAEV' }) }]);

        expect((await assetOf(assetId)).description).toBe('From OpenAEV');
      });

      it('ignores a source asset the connector has no source for', async () => {
        const idMap = await upsert([genericAsset()]);
        const before = await snapshot();

        await update([{ sourceAssetId: 'app-unknown', ...fields({ description: 'Nobody home' }) }]);

        expect(await snapshot()).toEqual(before);
        expect((await assetOf(idMap.get('app-1')!)).description).toBeNull();
      });

      it('keeps the last entry of a source asset listed twice', async () => {
        await upsert([genericAsset()]);

        await update([
          { sourceAssetId: 'app-1', ...fields({ description: 'First' }) },
          { sourceAssetId: 'app-1', ...fields({ description: 'Second' }) },
        ]);

        expect((await sourceOf('app-1'))?.reportedDescription).toBe('Second');
      });

      it('writes more entries than one statement carries', async () => {
        const inputs = Array.from({ length: 1100 }, (_, i) => genericAsset({ sourceAssetId: `app-${i}`, name: `App ${i}` }));
        await upsert(inputs);

        await update(inputs.map((input, i) => ({ sourceAssetId: input.sourceAssetId, ...fields({ description: `Description ${i}` }) })));

        const described = (await db.select().from(supportingAssetSources)).filter((row) => row.reportedDescription !== null);
        expect(described).toHaveLength(1100);
        expect((await sourceOf('app-1099'))?.reportedDescription).toBe('Description 1099');
      });

      it('does nothing for an empty list', async () => {
        await upsert([genericAsset()]);
        const before = await snapshot();

        await update([]);

        expect(await snapshot()).toEqual(before);
      });

      it('leaves the same source asset id of another connector alone', async () => {
        await upsert([genericAsset({ description: 'From OpenAEV' })]);
        await services.withOrigin(otherConnectorOrigin).supportingAssets.bulkUpsertAssets([
          genericAsset({ connectorId: otherConnectorId, source: 'microsoft_graph', description: 'From Graph' }),
        ]);

        await update([{ sourceAssetId: 'app-1', ...fields({ description: 'Updated' }) }]);

        expect((await sourceOf('app-1', connectorId))?.reportedDescription).toBe('Updated');
        expect((await sourceOf('app-1', otherConnectorId))?.reportedDescription).toBe('From Graph');
      });

      it('writes nothing on the sources of another tenant connector', async () => {
        await upsert([genericAsset({ description: 'Before' })]);
        const tenantBId = await createTenant(services, adminUserId);

        await update([{ sourceAssetId: 'app-1', ...fields({ description: 'Hijacked' }) }], connectorId, { type: 'client', userId: adminUserId, tenantId: tenantBId });

        expect((await sourceOf('app-1'))?.reportedDescription).toBe('Before');
      });
    });

    describe('a later inventory upsert', () => {
      it('leaves the stored fields in place when it carries them back', async () => {
        const idMap = await upsert([genericAsset()]);
        await update([{ sourceAssetId: 'app-1', ...fields({ description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' }) }]);
        const before = await snapshot();
        const stored = (await services.withOrigin(connectorOrigin).supportingAssets.getReportedOverviewFields(connectorId, ['app-1'])).get('app-1')!;

        await upsert([genericAsset({ description: stored.description, url: stored.url, linkedPerson: stored.linkedPerson })]);

        const after = await snapshot();
        expect(movedRowIds(before.sources, after.sources)).toEqual([]);
        expect(movedRowIds(before.assets, after.assets)).toEqual([]);
        expect(await assetOf(idMap.get('app-1')!)).toMatchObject({ description: 'Payroll application', url: 'https://payroll.test', linkedPerson: 'Ada Lovelace' });
      });
    });
  });

  describe('Finding tenant-level queries', () => {
    let assetAId: string;
    let assetBId: string;
    let connectorId: string;

    beforeEach(async () => {
      assetAId = uuidv7();
      assetBId = uuidv7();
      const userId = adminUserId;
      const tenantId = adminTenantId;
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: assetAId, name: 'Server A', description: null, ownerId: null, exposure: 'internet_facing', categoryId: 'host',
      });
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: assetBId, name: 'Server B', description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
      });
      // Both assets are affected by CVE-2024-001
      const cveUuid001 = await insertCve(tenantId, 'CVE-2024-001');
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: uuidv7(), supportingAssetId: assetAId,
        cveId: cveUuid001, userId,
      });
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: uuidv7(), supportingAssetId: assetBId,
        cveId: cveUuid001, userId,
      });
      // Asset A also has a separate CVE, dismissed
      const cveUuid002 = await insertCve(tenantId, 'CVE-2024-002');
      const evidenceId2 = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId2, supportingAssetId: assetAId,
        cveId: cveUuid002, userId,
      });
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: evidenceId2,
        dismissalType: 'false_positive',
        reasonCode: 'not_applicable',
        reason: 'Not affected',
        changedByUserId: userId,
      });

      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test OpenAEV Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;

      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([
        {
          id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetAId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'detection', isExposed: true, securityPlatformType: 'SIEM',
          connectorId, sourceFindingId: 'finding-1',
        },
        {
          id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetBId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'prevention', isExposed: false, securityPlatformType: 'EDR',
          connectorId, sourceFindingId: 'finding-2',
        },
      ]);
    });

    it('should count a technique\'s exposed results, and no CVE finding', async () => {
      expect(await services.withOrigin(adminOrigin).dashboard.getTechniqueFindingCounts()).toEqual([{
        mitreTechniqueId: TECHNIQUE_T1003, externalId: 'T1003', name: expect.any(String), applicableFindings: 1,
      }]);
    });

    const affectedAssets = (
      flaw: AffectedAssetsFlaw,
      overrides: Partial<{ page: number, limit: number, sortBy: AffectedAssetSortKey, sortDesc: boolean }> = {},
      origin: EventOrigin = adminOrigin,
    ) => services.withOrigin(origin).supportingAssets.listAffectedAssets({
      flaw, page: 1, limit: 50, sortBy: 'assetName', sortDesc: false, ...overrides,
    });

    it('should return assets for a given CVE', async () => {
      const { items, total } = await affectedAssets({ cveId: 'CVE-2024-001' });
      expect(total).toBe(2);
      expect(items.map((a) => a.supportingAssetId)).toEqual([assetAId, assetBId]);
      for (const asset of items) {
        expect(asset.currentState).toBe('applicable');
      }
    });

    it('should sort the assets by name with case and accents folded together, in both directions', async () => {
      const flaw = await insertCve(adminTenantId, 'CVE-2024-003');
      for (const name of ['Zèbre', 'école', 'eden', 'Ecole', 'abc']) {
        const assetId = uuidv7();
        await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
          id: assetId, name, description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
        });
        await services.withOrigin(adminOrigin).supportingAssets.createEvidence({ id: uuidv7(), supportingAssetId: assetId, cveId: flaw, userId: adminUserId });
      }
      const assetNames = async (sortDesc: boolean) => (await affectedAssets({ cveId: 'CVE-2024-003' }, { sortDesc })).items.map((a) => a.assetName);

      expect(await assetNames(false)).toEqual(['abc', 'Ecole', 'école', 'eden', 'Zèbre']);
      expect(await assetNames(true)).toEqual(['Zèbre', 'eden', 'école', 'Ecole', 'abc']);
    });

    it('should return assets for a given MITRE technique', async () => {
      const { items, total } = await affectedAssets({ mitreTechniqueId: TECHNIQUE_T1003 });
      expect(total).toBe(2);
      expect(items.map((a) => [a.supportingAssetId, a.securityPlatformType, a.currentState])).toEqual([
        [assetAId, 'SIEM', 'applicable'],
        [assetBId, 'EDR', 'dismissed'],
      ]);
    });

    it('should cut the pages in the asked order, with the total of every page', async () => {
      const first = await affectedAssets({ mitreTechniqueId: TECHNIQUE_T1003 }, { limit: 1, sortBy: 'currentState', sortDesc: true });
      const second = await affectedAssets({ mitreTechniqueId: TECHNIQUE_T1003 }, { page: 2, limit: 1, sortBy: 'currentState', sortDesc: true });
      expect([first.total, second.total]).toEqual([2, 2]);
      expect(first.items.map((a) => a.currentState)).toEqual(['dismissed']);
      expect(second.items.map((a) => a.currentState)).toEqual(['applicable']);
      expect((await affectedAssets({ mitreTechniqueId: TECHNIQUE_T1003 }, { page: 3, limit: 1 })).items).toEqual([]);
    });

    it('should not show a tenant the findings another tenant holds on the same CVE or technique', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherAssetId = uuidv7();
      await services.withOrigin(otherOrigin).supportingAssets.createSupportingAsset({
        id: otherAssetId, name: 'Other tenant server', description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
      });
      await services.withOrigin(otherOrigin).supportingAssets.createEvidence({
        id: uuidv7(), supportingAssetId: otherAssetId, cveId: await insertCve(otherTenantId, 'CVE-2024-001'), userId: adminUserId,
      });

      const own = await affectedAssets({ cveId: 'CVE-2024-001' }, {}, otherOrigin);
      expect(own.total).toBe(1);
      expect(own.items.map((a) => a.supportingAssetId)).toEqual([otherAssetId]);
      expect(await affectedAssets({ mitreTechniqueId: TECHNIQUE_T1003 }, {}, otherOrigin)).toMatchObject({ total: 0, items: [] });
      expect((await affectedAssets({ cveId: 'CVE-2024-001' })).total).toBe(2);
    });

    it('should list each technique with an applicable result on an asset once, a dismissed one left out', async () => {
      const read = services.withOrigin(adminOrigin).supportingAssets;
      expect(await read.getApplicableTechniquesForAsset(assetAId)).toEqual([expect.objectContaining({ id: TECHNIQUE_T1003, externalId: 'T1003' })]);
      expect(await read.getApplicableTechniquesForAsset(assetBId)).toEqual([]);

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      expect(await services.withOrigin(otherOrigin).supportingAssets.getApplicableTechniquesForAsset(assetAId)).toEqual([]);
    });
  });

  describe('listSupportingAssets filtering', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;

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

    it('filters on `user` to the assets with no observation at all', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'dev-1', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'Connector-backed' },
      ]);
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: uuidv7(), name: 'Hand-made', description: null, ownerId: null, exposure: 'unknown', categoryId: 'identity',
      });

      const result = await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: null, source: 'user', mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Hand-made');
      expect(result.total).toBe(1);
    });

    it('filters on a connector source to the assets it reports', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'dev-1', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'Connector-backed' },
      ]);
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: uuidv7(), name: 'Hand-made', description: null, ownerId: null, exposure: 'unknown', categoryId: 'identity',
      });

      const result = await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: null, source: 'microsoft_graph', mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Connector-backed');
    });

    it('counts every observation behind the matching assets, tenant-wide rather than by page', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'dev-1', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'Device 1' },
        { sourceAssetId: 'dev-2', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'Device 2' },
      ]);

      const result = await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 1, search: null, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      });

      // A single-observation asset each: the page holds one asset, but the tenant holds two observations.
      expect(result.items).toHaveLength(1);
      expect(result.totalObservations).toBe(2);
    });

    it('counts assets per source, appending `user` last and only when a hand-made asset exists', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'dev-1', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'Device 1' },
      ]);
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: uuidv7(), name: 'Hand-made', description: null, ownerId: null, exposure: 'unknown', categoryId: 'identity',
      });

      const counts = await services.withOrigin(adminOrigin).supportingAssets.getAssetCountsBySource();

      expect(counts).toContainEqual({ source: 'microsoft_graph', assetCount: 1 });
      expect(counts).toContainEqual({ source: 'user', assetCount: 1 });
    });

    it('never counts `user` when every asset has an observation', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'dev-1', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'Device 1' },
      ]);

      const counts = await services.withOrigin(adminOrigin).supportingAssets.getAssetCountsBySource();

      expect(counts.some((c) => c.source === 'user')).toBe(false);
    });
  });

  describe('listSupportingAssets ordering', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;

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

    const ordered = (sortBy: 'name' | 'criticality' | 'exposure', sortDesc: boolean) =>
      services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: null, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy, sortDesc,
      });

    // Both vocabularies are ordinal and stored as text, so ordering on the column sorted them
    // alphabetically: `unknown` landed between `medium` and `very_high`, and `internal` ahead of
    // `internet_facing`. Only a real database shows it — the ordering never reaches TypeScript.
    it('orders criticality along the ladder, not alphabetically', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'a-1', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'A', criticality: 'unknown' },
        { sourceAssetId: 'a-2', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'B', criticality: 'low' },
        { sourceAssetId: 'a-3', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'C', criticality: 'medium' },
        { sourceAssetId: 'a-4', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'D', criticality: 'high' },
        { sourceAssetId: 'a-5', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'E', criticality: 'very_high' },
      ]);

      expect((await ordered('criticality', true)).items.map((a) => a.criticality))
        .toEqual(['very_high', 'high', 'medium', 'low', 'unknown']);
      expect((await ordered('criticality', false)).items.map((a) => a.criticality))
        .toEqual(['unknown', 'low', 'medium', 'high', 'very_high']);
    });

    it('orders exposure from the most exposed down', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'e-1', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'A', exposure: 'unknown' },
        { sourceAssetId: 'e-2', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'B', exposure: 'internal' },
        { sourceAssetId: 'e-3', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'C', exposure: 'internet_facing' },
      ]);

      expect((await ordered('exposure', true)).items.map((a) => a.exposure))
        .toEqual(['internet_facing', 'internal', 'unknown']);
    });

    describe('by name', () => {
      beforeEach(async () => {
        await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
          { sourceAssetId: 'n-1', categoryId: 'host', connectorId, source: 'microsoft_graph', name: '05-first' },
          { sourceAssetId: 'n-2', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'Alpha' },
          {
            sourceAssetId: 'n-3', categoryId: 'host', connectorId, source: 'microsoft_graph',
            properties: { family: 'machine', ipAddresses: ['10.0.0.1'] },
          },
          { sourceAssetId: 'n-4', categoryId: 'host', connectorId, source: 'microsoft_graph' },
        ]);
      });

      const displayed = async (sortDesc: boolean) =>
        (await ordered('name', sortDesc)).items.map((a) => a.name ?? a.derivedName);

      it('places an asset named by its derivation among the real names', async () => {
        expect(await displayed(false)).toEqual(['05-first', '10.0.0.1', 'Alpha', null]);
      });

      it('keeps an asset with neither a name nor a derivation last, whichever the direction', async () => {
        expect(await displayed(true)).toEqual(['Alpha', '10.0.0.1', '05-first', null]);
      });
    });

    describe('by name with accents', () => {
      beforeEach(async () => {
        await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets(
          ['Zèbre', 'école', 'eden', 'Ecole', 'abc'].map((name, index) => ({
            sourceAssetId: `acc-${index}`, categoryId: 'host' as const, connectorId, source: 'microsoft_graph' as const, name,
          })),
        );
      });

      const names = async (sortDesc: boolean) => (await ordered('name', sortDesc)).items.map((a) => a.name);

      it('puts the variants of a name together, the unaccented spelling first', async () => {
        expect(await names(false)).toEqual(['abc', 'Ecole', 'école', 'eden', 'Zèbre']);
      });

      it('reverses that order, variants included, when sorting down', async () => {
        expect(await names(true)).toEqual(['Zèbre', 'eden', 'école', 'Ecole', 'abc']);
      });
    });
  });

  describe('listSupportingAssets search', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;

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

      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 's-1', categoryId: 'identity', connectorId, source: 'microsoft_graph', name: 'acme-ws-114\\localadmin' },
        { sourceAssetId: 's-2', categoryId: 'identity', connectorId, source: 'microsoft_graph', name: 'acme-ws-114localadmin' },
        { sourceAssetId: 's-3', categoryId: 'identity', connectorId, source: 'microsoft_graph', name: 'acme\\svc_backup' },
        { sourceAssetId: 's-4', categoryId: 'identity', connectorId, source: 'microsoft_graph', name: 'acme\\svcxbackup' },
        { sourceAssetId: 's-5', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'disk 100% full' },
        { sourceAssetId: 's-6', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'disk 100 full' },
      ]);
    });

    const searched = async (search: string) =>
      (await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      })).items.map((a) => a.name);

    // Postgres reads `\` as the LIKE escape character and `%`/`_` as wildcards: unescaped, a domain
    // account name matched nothing, or matched its look-alike, and an underscore matched any character.
    it('matches a backslash literally, as a domain account name carries one', async () => {
      expect(await searched('acme-ws-114\\localadmin')).toEqual(['acme-ws-114\\localadmin']);
    });

    it('matches an underscore and a percent sign literally, not as wildcards', async () => {
      expect(await searched('svc_backup')).toEqual(['acme\\svc_backup']);
      expect(await searched('100%')).toEqual(['disk 100% full']);
    });

    it('finds an asset with no name through its derived name', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 's-7', categoryId: 'host', connectorId, source: 'microsoft_graph',
        properties: { family: 'machine', ipAddresses: ['10.20.30.40'] },
      }]);

      const found = (await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: '20.30', source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      })).items;

      expect(found.map((a) => [a.name, a.derivedName])).toEqual([[null, '10.20.30.40']]);
    });
  });

  describe('tenant isolation', () => {
    let tenantBOrigin: EventOrigin;

    beforeEach(async () => {
      const tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should not list supporting assets from another tenant', async () => {
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: uuidv7(), name: 'Tenant A Asset', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });

      const listFor = (origin: EventOrigin) => services.withOrigin(origin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: null, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      });
      const tenantAAssets = await listFor(adminOrigin);
      const tenantBAssets = await listFor(tenantBOrigin);

      expect(tenantAAssets.items).toHaveLength(1);
      expect(tenantBAssets.items).toHaveLength(0);
      expect(tenantBAssets.total).toBe(0);
    });

    it('should not retrieve a supporting asset from another tenant', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'Tenant A Asset', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });

      const result = await services.withOrigin(tenantBOrigin).supportingAssets.getSupportingAsset(id);
      expect(result).toBeNull();
    });

    it('should not delete supporting assets from another tenant', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: 'Tenant A Asset', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });

      await services.withOrigin(tenantBOrigin).supportingAssets.deleteSupportingAssets([id]);

      const result = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(result).toBeTruthy();
    });

    it('should not read another tenant\'s asset sources or manual values', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
      const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
      const connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'dev-1', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'Device 1' },
      ]);
      const assetId = idMap.get('dev-1')!;
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { categoryId: 'identity' });

      const own = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(own!.sources).toHaveLength(1);
      expect(own!.manualValues).toHaveLength(1);

      expect(await services.withOrigin(tenantBOrigin).supportingAssets.getSupportingAsset(assetId)).toBeNull();
      const listedForB = await services.withOrigin(tenantBOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: null, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      });
      expect(listedForB.items).toHaveLength(0);
      expect(listedForB.totalObservations).toBe(0);
      expect(await services.withOrigin(tenantBOrigin).supportingAssets.getAssetCountsBySource()).toHaveLength(0);
    });

    it('should not read another tenant\'s finding sources', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
      const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
      const connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
      const assetId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: assetId, name: 'Asset', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      const cveUuid = await insertCve(adminTenantId, 'CVE-2024-888');
      const evidenceId = uuidv7();
      await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertEvidence([{
        id: evidenceId,
        evaluatedAt: new Date(),
        supportingAssetId: assetId,
        cveId: cveUuid,
        mitreTechniqueId: null,
        expectationType: null,
        isExposed: true,
        connectorId,
        sourceFindingId: 'dev-1:CVE-2024-888',
      }]);

      const own = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidenceId);
      expect(own!.sources).toHaveLength(1);

      expect(await services.withOrigin(tenantBOrigin).supportingAssets.getEvidenceDetail(evidenceId)).toBeNull();
    });

    it('should not count technique findings from another tenant', async () => {
      const assetId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: assetId, name: 'Asset', description: null, ownerId: null, exposure: 'unknown', categoryId: 'cloud_resource',
      });
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: uuidv7(), supportingAssetId: assetId,
        mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'detection', userId: adminUserId,
      });

      expect(await services.withOrigin(adminOrigin).dashboard.getTechniqueFindingCounts()).toHaveLength(1);
      expect(await services.withOrigin(tenantBOrigin).dashboard.getTechniqueFindingCounts()).toEqual([]);
    });
  });
});
