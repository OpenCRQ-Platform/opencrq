import type { AttackObservationMirror } from '@app/module';
import { openaevAttackObservations } from '@app/module';
import { eq } from 'drizzle-orm';
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

  describe('attack observation mirror', () => {
    const SEEN = new Date('2026-10-05T08:00:00.000Z');
    const T1 = new Date('2026-09-01T00:00:00.000Z');
    const PAIR = { sourceAssetId: 'asset-1', scenarioId: 'scenario-1' };

    const obs = (observationId: string, overrides: Partial<AttackObservationMirror> = {}): AttackObservationMirror => ({
      observationId,
      ...PAIR,
      attackPatternExternalId: 'T1059',
      expectationType: 'DETECTION',
      simulationStartDate: T1,
      simulationStatus: 'FINISHED',
      ...overrides,
    });
    const upsert = (fixture: TenantFixture, observations: Array<AttackObservationMirror>, reportedAt = SEEN, openaevTenantId = OAEV_TENANT) =>
      streams(fixture).upsertAttackObservations({ connectorId: fixture.connectorId, openaevTenantId, observations, reportedAt });
    const mirror = (fixture: TenantFixture) =>
      db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, fixture.connectorId));

    describe('listObservationPairs', () => {
      it('should list each (asset, scenario) pair once', async () => {
        await upsert(a, [
          obs('o1'),
          obs('o2', { attackPatternExternalId: 'T1002' }),
          obs('o3', { sourceAssetId: 'asset-2' }),
          obs('o4', { scenarioId: 'scenario-2' }),
        ]);

        const pairs = await streams(a).listObservationPairs(a.connectorId);

        expect(pairs.map((p) => `${p.sourceAssetId}/${p.scenarioId}`).sort())
          .toEqual(['asset-1/scenario-1', 'asset-1/scenario-2', 'asset-2/scenario-1']);
      });
    });

    describe('listObservationPairsReportedSince', () => {
      const THRESHOLD = new Date('2026-10-05T00:00:00.000Z');
      const pairsReportedSince = async (fixture: TenantFixture, openaevTenantId = OAEV_TENANT) =>
        (await streams(fixture).listObservationPairsReportedSince({ connectorId: fixture.connectorId, openaevTenantId, since: THRESHOLD }))
          .map((p) => `${p.sourceAssetId}/${p.scenarioId}`).sort();

      it('should list each pair that has a document seen at or after the threshold once', async () => {
        await upsert(a, [obs('o1', { sourceAssetId: 'asset-old' })], new Date('2026-10-04T23:59:59.999Z'));
        await upsert(a, [
          obs('o2'),
          obs('o3', { attackPatternExternalId: 'T1002' }),
          obs('o4', { sourceAssetId: 'asset-2', scenarioId: 'scenario-2' }),
        ], THRESHOLD);
        await upsert(a, [obs('o5', { sourceAssetId: 'asset-3' })], new Date('2026-10-06T00:00:00.000Z'));

        expect(await pairsReportedSince(a)).toEqual(['asset-1/scenario-1', 'asset-2/scenario-2', 'asset-3/scenario-1']);
      });

      it('should list a pair when only one of its documents was seen since', async () => {
        await upsert(a, [obs('o1')], new Date('2026-10-01T00:00:00.000Z'));
        await upsert(a, [obs('o2', { attackPatternExternalId: 'T1002' })], new Date('2026-10-06T00:00:00.000Z'));

        expect(await pairsReportedSince(a)).toEqual(['asset-1/scenario-1']);
      });

      it('should leave out the documents of another OpenAEV tenant of the same connector', async () => {
        await upsert(a, [obs('o1')], new Date('2026-10-06T00:00:00.000Z'), 'oaev-tenant-2');

        expect(await pairsReportedSince(a)).toEqual([]);
        expect(await pairsReportedSince(a, 'oaev-tenant-2')).toEqual(['asset-1/scenario-1']);
      });

      it('should list nothing for a connector with no mirror row', async () => {
        expect(await pairsReportedSince(a)).toEqual([]);
      });
    });

    describe('deleteObservationsNotReportedSince', () => {
      const BEFORE = new Date('2026-10-01T00:00:00.000Z');
      const SINCE = new Date('2026-10-05T00:00:00.000Z');

      it('should delete the documents seen before the threshold and return their distinct pairs', async () => {
        await upsert(a, [
          obs('stale-1'),
          obs('stale-2', { attackPatternExternalId: 'T1002' }),
          obs('stale-3', { scenarioId: 'scenario-2' }),
        ], BEFORE);
        await upsert(a, [obs('fresh', { sourceAssetId: 'asset-9' })], SINCE);

        const pairs = await streams(a).deleteObservationsNotReportedSince({ connectorId: a.connectorId, openaevTenantId: OAEV_TENANT, since: SINCE });

        expect(pairs.map((p) => `${p.sourceAssetId}/${p.scenarioId}`).sort()).toEqual(['asset-1/scenario-1', 'asset-1/scenario-2']);
        expect((await mirror(a)).map((row) => row.observationId)).toEqual(['fresh']);
      });

      it('should keep a document seen exactly at the threshold', async () => {
        await upsert(a, [obs('edge')], SINCE);

        const pairs = await streams(a).deleteObservationsNotReportedSince({ connectorId: a.connectorId, openaevTenantId: OAEV_TENANT, since: SINCE });

        expect(pairs).toEqual([]);
        expect(await mirror(a)).toHaveLength(1);
      });

      it('should leave another OpenAEV tenant of the same connector alone', async () => {
        await upsert(a, [obs('mine')], BEFORE);
        await upsert(a, [obs('theirs', { sourceAssetId: 'asset-2' })], BEFORE, 'oaev-tenant-2');

        const pairs = await streams(a).deleteObservationsNotReportedSince({ connectorId: a.connectorId, openaevTenantId: OAEV_TENANT, since: SINCE });

        expect(pairs).toEqual([{ sourceAssetId: 'asset-1', scenarioId: 'scenario-1' }]);
        expect((await mirror(a)).map((row) => row.observationId)).toEqual(['theirs']);
      });

      it('should leave another connector alone', async () => {
        await upsert(a, [obs('a-stale')], BEFORE);
        await upsert(b, [obs('b-stale')], BEFORE);

        await streams(a).deleteObservationsNotReportedSince({ connectorId: a.connectorId, openaevTenantId: OAEV_TENANT, since: SINCE });

        expect(await mirror(a)).toEqual([]);
        expect(await mirror(b)).toHaveLength(1);
      });
    });

    describe('tenant isolation', () => {
      it('should refuse to mirror observations on another tenant connector', async () => {
        await expect(streams(a).upsertAttackObservations({
          connectorId: b.connectorId, openaevTenantId: OAEV_TENANT, observations: [obs('o1')], reportedAt: SEEN,
        })).rejects.toThrow('Access Denied');

        expect(await mirror(b)).toEqual([]);
      });

      it('should not stamp the documents of another tenant connector', async () => {
        await upsert(b, [obs('o1')]);

        await streams(a).markEvidenceWritten({ connectorId: b.connectorId, entries: [{ observationId: 'o1', platformTypes: ['EDR'] }], writtenAt: new Date() });

        expect((await mirror(b))[0]).toMatchObject({ evidenceWrittenAt: null, evidencePlatformTypes: null });
      });

      it('should not return the documents or pairs of another tenant connector', async () => {
        await upsert(b, [obs('o1')]);

        expect(await streams(a).findCurrentObservations({ connectorId: b.connectorId, pairs: [PAIR] })).toEqual([]);
        expect(await streams(a).listObservationPairs(b.connectorId)).toEqual([]);
        expect(await streams(a).listObservationPairsReportedSince({ connectorId: b.connectorId, openaevTenantId: OAEV_TENANT, since: new Date(0) })).toEqual([]);
      });

      it('should not delete the documents of another tenant connector', async () => {
        await upsert(b, [obs('o1')], new Date('2026-10-01T00:00:00.000Z'));

        const pairs = await streams(a).deleteObservationsNotReportedSince({
          connectorId: b.connectorId, openaevTenantId: OAEV_TENANT, since: new Date('2026-10-05T00:00:00.000Z'),
        });

        expect(pairs).toEqual([]);
        expect(await mirror(b)).toHaveLength(1);
      });
    });
  });
});
