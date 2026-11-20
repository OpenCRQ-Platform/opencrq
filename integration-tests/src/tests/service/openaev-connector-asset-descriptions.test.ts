import type { OpenaevAssetInput } from '@app/module';
import { openaevAssets } from '@app/module';
import { and, eq } from 'drizzle-orm';
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
    const asset = (sourceAssetId: string, overrides: Partial<OpenaevAssetInput> = {}): OpenaevAssetInput => ({
      sourceAssetId, openaevTenantId: OAEV_TENANT, needsDescriptionFetch: false, ...overrides,
    });
    const upsert = (fixture: TenantFixture, assets: Array<OpenaevAssetInput>) =>
      streams(fixture).upsertAssets({ connectorId: fixture.connectorId, assets });

    describe('description candidates', () => {
      const FIRST = new Date('2026-10-01T00:00:00.000Z');
      const SECOND = new Date('2026-10-02T00:00:00.000Z');
      const THIRD = new Date('2026-10-03T00:00:00.000Z');
      const candidates = (fixture: TenantFixture, limit = 100, openaevTenantId = OAEV_TENANT) =>
        streams(fixture).listDescriptionCandidates({ connectorId: fixture.connectorId, openaevTenantId, limit });
      const fetchedAtOf = async (fixture: TenantFixture, sourceAssetId: string): Promise<Date | null | undefined> =>
        (await registered(fixture)).find((row) => row.sourceAssetId === sourceAssetId)?.descriptionFetchedAt;
      const registerWithFetchedAt = async (fixture: TenantFixture, fetchedAt: Record<string, Date | null>) => {
        await upsert(fixture, Object.keys(fetchedAt).map((id) => asset(id, { needsDescriptionFetch: true })));
        for (const [sourceAssetId, at] of Object.entries(fetchedAt)) {
          await db.update(openaevAssets).set({ descriptionFetchedAt: at })
            .where(and(eq(openaevAssets.connectorId, fixture.connectorId), eq(openaevAssets.sourceAssetId, sourceAssetId)));
        }
      };

      it('should list the never fetched assets first, then the one fetched longest ago', async () => {
        await registerWithFetchedAt(a, { 'asset-c': THIRD, 'asset-a': FIRST, 'asset-never': null, 'asset-b': SECOND });

        expect(await candidates(a)).toEqual(['asset-never', 'asset-a', 'asset-b', 'asset-c']);
      });

      it('should break a tie on the source asset id, never-fetched assets included', async () => {
        await registerWithFetchedAt(a, { 'asset-2': null, 'asset-1': null, 'asset-4': FIRST, 'asset-3': FIRST });

        expect(await candidates(a)).toEqual(['asset-1', 'asset-2', 'asset-3', 'asset-4']);
      });

      it('should leave out an asset fetched less than a day ago and list one fetched longer ago', async () => {
        const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
        await registerWithFetchedAt(a, { 'asset-recent': hoursAgo(1), 'asset-old': hoursAgo(25), 'asset-never': null });

        expect(await candidates(a)).toEqual(['asset-never', 'asset-old']);
      });

      it('should return at most the requested number, from the head of the order', async () => {
        await registerWithFetchedAt(a, { 'asset-a': FIRST, 'asset-never': null, 'asset-b': SECOND });

        expect(await candidates(a, 2)).toEqual(['asset-never', 'asset-a']);
        expect(await candidates(a, 0)).toEqual([]);
      });

      it('should leave out the assets whose description a batch route carries', async () => {
        await upsert(a, [asset('asset-overview', { needsDescriptionFetch: true }), asset('asset-endpoint', { needsDescriptionFetch: false })]);

        expect(await candidates(a)).toEqual(['asset-overview']);
      });

      it('should list the assets of the requested OpenAEV tenant only', async () => {
        await upsert(a, [
          asset('asset-1', { needsDescriptionFetch: true }),
          asset('asset-2', { needsDescriptionFetch: true, openaevTenantId: 'oaev-tenant-2' }),
        ]);

        expect(await candidates(a)).toEqual(['asset-1']);
        expect(await candidates(a, 100, 'oaev-tenant-2')).toEqual(['asset-2']);
        expect(await candidates(a, 100, 'nope')).toEqual([]);
      });

      it('should not list the assets of another tenant connector', async () => {
        await upsert(b, [asset('asset-1', { needsDescriptionFetch: true })]);

        expect(await candidates(a)).toEqual([]);
        expect(await streams(a).listDescriptionCandidates({ connectorId: b.connectorId, openaevTenantId: OAEV_TENANT, limit: 100 })).toEqual([]);
      });

      describe('markDescriptionsFetched', () => {
        it('should stamp the given assets and send them to the back of the order', async () => {
          await registerWithFetchedAt(a, { 'asset-a': null, 'asset-b': null, 'asset-c': FIRST });

          await streams(a).markDescriptionsFetched({ connectorId: a.connectorId, sourceAssetIds: ['asset-a'], fetchedAt: THIRD });

          expect(await fetchedAtOf(a, 'asset-a')).toEqual(THIRD);
          expect(await fetchedAtOf(a, 'asset-b')).toBeNull();
          expect(await fetchedAtOf(a, 'asset-c')).toEqual(FIRST);
          expect(await candidates(a)).toEqual(['asset-b', 'asset-c', 'asset-a']);
        });

        it('should ignore an id the connector has not registered', async () => {
          await registerWithFetchedAt(a, { 'asset-a': null });

          await streams(a).markDescriptionsFetched({ connectorId: a.connectorId, sourceAssetIds: ['asset-unknown'], fetchedAt: THIRD });

          expect(await registered(a)).toHaveLength(1);
          expect(await fetchedAtOf(a, 'asset-a')).toBeNull();
        });

        it('should stamp more assets than one statement carries', async () => {
          const ids = Array.from({ length: 2500 }, (_, i) => `asset-${i}`);
          await upsert(a, ids.map((id) => asset(id, { needsDescriptionFetch: true })));

          await streams(a).markDescriptionsFetched({ connectorId: a.connectorId, sourceAssetIds: ids, fetchedAt: THIRD });

          expect((await registered(a)).every((row) => row.descriptionFetchedAt?.getTime() === THIRD.getTime())).toBe(true);
        });

        it('should do nothing for an empty list', async () => {
          await registerWithFetchedAt(a, { 'asset-a': null });

          await streams(a).markDescriptionsFetched({ connectorId: a.connectorId, sourceAssetIds: [], fetchedAt: THIRD });

          expect(await fetchedAtOf(a, 'asset-a')).toBeNull();
        });

        it('should not stamp the assets of another tenant connector', async () => {
          await registerWithFetchedAt(b, { 'asset-a': null });

          await streams(a).markDescriptionsFetched({ connectorId: b.connectorId, sourceAssetIds: ['asset-a'], fetchedAt: THIRD });

          expect(await fetchedAtOf(b, 'asset-a')).toBeNull();
        });

        it('should keep the same source asset id apart per connector', async () => {
          await registerWithFetchedAt(a, { 'asset-a': null });
          await registerWithFetchedAt(b, { 'asset-a': null });

          await streams(a).markDescriptionsFetched({ connectorId: a.connectorId, sourceAssetIds: ['asset-a'], fetchedAt: THIRD });

          expect(await fetchedAtOf(a, 'asset-a')).toEqual(THIRD);
          expect(await fetchedAtOf(b, 'asset-a')).toBeNull();
        });
      });
    });
  });
});
