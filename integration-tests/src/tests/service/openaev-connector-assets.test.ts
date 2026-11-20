import type { OpenaevAssetInput } from '@app/module';
import { openaevAssets } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantFixture } from '../../helpers/openaev-connector-fixtures';
import { createAdminUser } from '../../helpers/factories';
import { createFixture, OAEV_TENANT } from '../../helpers/openaev-connector-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('openaevConnector service', () => {
  let a: TenantFixture;
  let b: TenantFixture;

  beforeEach(async () => {
    await truncateAllTables(db);
    const admin = await createAdminUser(services);
    a = await createFixture(services, admin.userId);
    b = await createFixture(services, admin.userId);
  });

  const streams = (fixture: TenantFixture) => services.withOrigin(fixture.connectorOrigin).openaevConnector;

  describe('asset registry', () => {
    const registered = (fixture: TenantFixture) =>
      db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, fixture.connectorId));
    const rowVersion = async (fixture: TenantFixture, sourceAssetId: string): Promise<string> => {
      const { rows } = await db.execute<{ version: string }>(sql`
        select xmin::text as version from openaev_assets
        where connector_id = ${fixture.connectorId} and source_asset_id = ${sourceAssetId}`);
      return rows[0].version;
    };
    const asset = (sourceAssetId: string, overrides: Partial<OpenaevAssetInput> = {}): OpenaevAssetInput => ({
      sourceAssetId, openaevTenantId: OAEV_TENANT, needsDescriptionFetch: false, ...overrides,
    });
    const upsert = (fixture: TenantFixture, assets: Array<OpenaevAssetInput>) =>
      streams(fixture).upsertAssets({ connectorId: fixture.connectorId, assets });

    describe('upsertAssets', () => {
      it('should register the assets under the caller tenant with no description fetched', async () => {
        await upsert(a, [asset('asset-1', { needsDescriptionFetch: true }), asset('asset-2')]);

        expect((await registered(a)).sort((x, y) => x.sourceAssetId.localeCompare(y.sourceAssetId))).toEqual([
          {
            tenantId: a.tenantId, connectorId: a.connectorId, sourceAssetId: 'asset-1',
            openaevTenantId: OAEV_TENANT, needsDescriptionFetch: true, descriptionFetchedAt: null,
          },
          {
            tenantId: a.tenantId, connectorId: a.connectorId, sourceAssetId: 'asset-2',
            openaevTenantId: OAEV_TENANT, needsDescriptionFetch: false, descriptionFetchedAt: null,
          },
        ]);
      });

      it('should leave a row untouched when the same asset is upserted again unchanged', async () => {
        const fetchedAt = new Date('2026-10-05T09:00:00.000Z');
        await upsert(a, [asset('asset-1', { needsDescriptionFetch: true })]);
        await db.update(openaevAssets).set({ descriptionFetchedAt: fetchedAt }).where(eq(openaevAssets.connectorId, a.connectorId));
        const before = await rowVersion(a, 'asset-1');

        await upsert(a, [asset('asset-1', { needsDescriptionFetch: true })]);

        expect(await rowVersion(a, 'asset-1')).toBe(before);
        expect((await registered(a))[0].descriptionFetchedAt).toEqual(fetchedAt);
      });

      it('should apply a change of OpenAEV tenant and keep description_fetched_at', async () => {
        const fetchedAt = new Date('2026-10-05T09:00:00.000Z');
        await upsert(a, [asset('asset-1', { needsDescriptionFetch: true })]);
        await db.update(openaevAssets).set({ descriptionFetchedAt: fetchedAt }).where(eq(openaevAssets.connectorId, a.connectorId));
        const before = await rowVersion(a, 'asset-1');

        await upsert(a, [asset('asset-1', { openaevTenantId: 'oaev-tenant-2', needsDescriptionFetch: true })]);

        expect(await rowVersion(a, 'asset-1')).not.toBe(before);
        expect(await registered(a)).toEqual([expect.objectContaining({ openaevTenantId: 'oaev-tenant-2', descriptionFetchedAt: fetchedAt })]);
      });

      it('should apply a change of description route and keep description_fetched_at', async () => {
        const fetchedAt = new Date('2026-10-05T09:00:00.000Z');
        await upsert(a, [asset('asset-1', { needsDescriptionFetch: true })]);
        await db.update(openaevAssets).set({ descriptionFetchedAt: fetchedAt }).where(eq(openaevAssets.connectorId, a.connectorId));

        await upsert(a, [asset('asset-1', { needsDescriptionFetch: false })]);

        expect(await registered(a)).toEqual([expect.objectContaining({ needsDescriptionFetch: false, descriptionFetchedAt: fetchedAt })]);
      });

      it('should add the new assets of an inventory without touching the registered ones', async () => {
        await upsert(a, [asset('asset-1')]);
        const before = await rowVersion(a, 'asset-1');

        await upsert(a, [asset('asset-1'), asset('asset-2')]);

        expect(await rowVersion(a, 'asset-1')).toBe(before);
        expect(await registered(a)).toHaveLength(2);
      });

      it('should keep the last occurrence of an asset listed twice in one batch', async () => {
        await upsert(a, [asset('asset-1', { needsDescriptionFetch: false }), asset('asset-1', { needsDescriptionFetch: true })]);

        expect(await registered(a)).toEqual([expect.objectContaining({ sourceAssetId: 'asset-1', needsDescriptionFetch: true })]);
      });

      it('should register more assets than one statement carries', async () => {
        await upsert(a, Array.from({ length: 2500 }, (_, i) => asset(`asset-${i}`)));

        expect(await registered(a)).toHaveLength(2500);
      });

      it('should do nothing for an empty batch', async () => {
        await upsert(a, []);

        expect(await registered(a)).toEqual([]);
      });
    });

    describe('listSourceAssetIds', () => {
      it('should list the assets of the requested OpenAEV tenant only', async () => {
        await upsert(a, [
          asset('asset-1'),
          asset('asset-2'),
          asset('asset-3', { openaevTenantId: 'oaev-tenant-2' }),
        ]);

        expect((await streams(a).listSourceAssetIds({ connectorId: a.connectorId, openaevTenantId: OAEV_TENANT })).sort())
          .toEqual(['asset-1', 'asset-2']);
        expect(await streams(a).listSourceAssetIds({ connectorId: a.connectorId, openaevTenantId: 'oaev-tenant-2' }))
          .toEqual(['asset-3']);
        expect(await streams(a).listSourceAssetIds({ connectorId: a.connectorId, openaevTenantId: 'nope' })).toEqual([]);
      });
    });

    describe('getAssetTenantMap', () => {
      it('should map every registered asset of the connector to its OpenAEV tenant', async () => {
        await upsert(a, [asset('asset-1'), asset('asset-2', { openaevTenantId: 'oaev-tenant-2' })]);

        expect(await streams(a).getAssetTenantMap(a.connectorId)).toEqual(new Map([['asset-1', OAEV_TENANT], ['asset-2', 'oaev-tenant-2']]));
      });

      it('should be empty for a connector with no registered asset, and for another tenant connector', async () => {
        await upsert(b, [asset('asset-1')]);

        expect(await streams(a).getAssetTenantMap(a.connectorId)).toEqual(new Map());
        expect(await streams(a).getAssetTenantMap(b.connectorId)).toEqual(new Map());
      });
    });

    describe('listUnreportedAssets and pruneAssets', () => {
      const unreported = (fixture: TenantFixture, reportedSourceAssetIds: Array<string>, openaevTenantId = OAEV_TENANT) =>
        streams(fixture).listUnreportedAssets({ connectorId: fixture.connectorId, openaevTenantId, reportedSourceAssetIds }).then((ids) => ids.sort());
      const prune = (fixture: TenantFixture, sourceAssetIds: Array<string>, openaevTenantId = OAEV_TENANT, connectorId = fixture.connectorId) =>
        streams(fixture).pruneAssets({ connectorId, openaevTenantId, sourceAssetIds });
      const registeredIds = async (fixture: TenantFixture) => (await registered(fixture)).map((row) => row.sourceAssetId).sort();

      it('should list the registered assets of the tenant the inventory did not report', async () => {
        await upsert(a, [asset('asset-1'), asset('asset-2'), asset('asset-3')]);

        expect(await unreported(a, ['asset-1', 'asset-unknown'])).toEqual(['asset-2', 'asset-3']);
      });

      it('should list nothing when the inventory reported every registered asset', async () => {
        await upsert(a, [asset('asset-1'), asset('asset-2')]);

        expect(await unreported(a, ['asset-1', 'asset-2'])).toEqual([]);
      });

      it('should list nothing of another OpenAEV tenant of the connector, nor of another tenant connector', async () => {
        await upsert(a, [asset('asset-1'), asset('asset-2', { openaevTenantId: 'oaev-tenant-2' })]);
        await upsert(b, [asset('asset-3')]);

        expect(await unreported(a, [])).toEqual(['asset-1']);
        expect(await streams(a).listUnreportedAssets({ connectorId: b.connectorId, openaevTenantId: OAEV_TENANT, reportedSourceAssetIds: [] })).toEqual([]);
      });

      it('should not unregister anything by listing', async () => {
        await upsert(a, [asset('asset-1')]);

        await unreported(a, []);

        expect(await registeredIds(a)).toEqual(['asset-1']);
      });

      it('should unregister the given assets and only those', async () => {
        await upsert(a, [asset('asset-1'), asset('asset-2'), asset('asset-3')]);

        await prune(a, ['asset-2', 'asset-3']);

        expect(await registeredIds(a)).toEqual(['asset-1']);
      });

      it('should leave an asset registered under another OpenAEV tenant alone, even when it is named', async () => {
        await upsert(a, [asset('asset-1', { openaevTenantId: 'oaev-tenant-2' })]);

        await prune(a, ['asset-1']);

        expect(await registeredIds(a)).toEqual(['asset-1']);
      });

      it('should leave the assets of another tenant connector alone', async () => {
        await upsert(a, [asset('asset-1')]);
        await upsert(b, [asset('asset-1')]);

        await prune(a, ['asset-1'], OAEV_TENANT, b.connectorId);

        expect(await registeredIds(a)).toEqual(['asset-1']);
        expect(await registeredIds(b)).toEqual(['asset-1']);
      });

      it('should unregister more assets than one statement carries', async () => {
        const ids = Array.from({ length: 2500 }, (_, i) => `asset-${i}`);
        await upsert(a, ids.map((id) => asset(id)));

        await prune(a, ids.slice(1));

        expect(await registeredIds(a)).toEqual(['asset-0']);
      });
    });

    describe('tenant isolation', () => {
      it('should refuse to register assets on another tenant connector', async () => {
        await expect(streams(a).upsertAssets({ connectorId: b.connectorId, assets: [asset('asset-1')] }))
          .rejects.toThrow('Access Denied');

        expect(await registered(b)).toEqual([]);
      });

      it('should keep the same source asset id apart per connector', async () => {
        await upsert(a, [asset('asset-1', { needsDescriptionFetch: true })]);
        await upsert(b, [asset('asset-1', { needsDescriptionFetch: false })]);

        expect(await registered(a)).toEqual([expect.objectContaining({ tenantId: a.tenantId, needsDescriptionFetch: true })]);
        expect(await registered(b)).toEqual([expect.objectContaining({ tenantId: b.tenantId, needsDescriptionFetch: false })]);
      });

      it('should not list the assets of another tenant connector', async () => {
        await upsert(b, [asset('asset-1')]);

        expect(await streams(a).listSourceAssetIds({ connectorId: b.connectorId, openaevTenantId: OAEV_TENANT })).toEqual([]);
      });
    });
  });
});
