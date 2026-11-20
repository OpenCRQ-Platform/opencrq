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

  beforeEach(async () => {
    await truncateAllTables(db);
    const admin = await createAdminUser(services);
    a = await createFixture(services, admin.userId);
  });

  const streams = (fixture: TenantFixture) => services.withOrigin(fixture.connectorOrigin).openaevConnector;

  describe('attack observation mirror', () => {
    const SEEN = new Date('2026-10-05T08:00:00.000Z');
    const T1 = new Date('2026-09-01T00:00:00.000Z');
    const T2 = new Date('2026-09-08T00:00:00.000Z');
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
    const currentIds = async (fixture: TenantFixture, pairs = [PAIR]) =>
      (await streams(fixture).findCurrentObservations({ connectorId: fixture.connectorId, pairs })).map((row) => row.observationId).sort();
    const mirror = (fixture: TenantFixture) =>
      db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, fixture.connectorId));

    describe('upsertAttackObservations', () => {
      it('should store the mirror fields under the caller tenant', async () => {
        await upsert(a, [obs('o1', { simulationStartDate: null, simulationStatus: 'RUNNING' })]);

        expect(await mirror(a)).toEqual([{
          tenantId: a.tenantId,
          connectorId: a.connectorId,
          openaevTenantId: OAEV_TENANT,
          observationId: 'o1',
          ...PAIR,
          attackPatternExternalId: 'T1059',
          expectationType: 'DETECTION',
          simulationStartDate: null,
          simulationStatus: 'RUNNING',
          lastReportedAt: SEEN,
          evidenceWrittenAt: null,
          evidencePlatformTypes: null,
        }]);
      });

      it('should overwrite a document already mirrored instead of adding a row', async () => {
        const later = new Date('2026-10-06T08:00:00.000Z');
        await upsert(a, [obs('o1', { simulationStatus: 'RUNNING' })]);

        await upsert(a, [obs('o1', { simulationStatus: 'FINISHED', expectationType: 'PREVENTION' })], later);

        expect(await mirror(a)).toEqual([expect.objectContaining({
          observationId: 'o1', simulationStatus: 'FINISHED', expectationType: 'PREVENTION', lastReportedAt: later,
        })]);
      });

      it('should keep evidence_written_at and evidence_platform_types when a document is upserted again', async () => {
        const writtenAt = new Date('2026-10-05T09:00:00.000Z');
        await upsert(a, [obs('o1')]);
        await streams(a).markEvidenceWritten({ connectorId: a.connectorId, entries: [{ observationId: 'o1', platformTypes: ['EDR', 'SIEM'] }], writtenAt });

        await upsert(a, [obs('o1', { simulationStatus: 'RUNNING' })], new Date('2026-10-06T08:00:00.000Z'));

        expect((await mirror(a))[0]).toMatchObject({ evidenceWrittenAt: writtenAt, evidencePlatformTypes: ['EDR', 'SIEM'] });
      });

      it('should keep the last occurrence of a document listed twice in one batch', async () => {
        await upsert(a, [obs('o1', { simulationStatus: 'RUNNING' }), obs('o1', { simulationStatus: 'FINISHED' })]);

        expect(await mirror(a)).toEqual([expect.objectContaining({ observationId: 'o1', simulationStatus: 'FINISHED' })]);
      });

      it('should store more documents than one statement carries', async () => {
        const many = Array.from({ length: 2500 }, (_, i) => obs(`o${i}`, { sourceAssetId: `asset-${i}` }));

        await upsert(a, many);

        expect(await mirror(a)).toHaveLength(2500);
      });

      it('should do nothing for an empty batch', async () => {
        await upsert(a, []);

        expect(await mirror(a)).toEqual([]);
      });
    });

    describe('markEvidenceWritten', () => {
      it('should stamp only the listed documents, each with its own platform types', async () => {
        const writtenAt = new Date('2026-10-05T09:00:00.000Z');
        await upsert(a, [obs('o1'), obs('o2'), obs('o3')]);

        await streams(a).markEvidenceWritten({
          connectorId: a.connectorId,
          entries: [
            { observationId: 'o1', platformTypes: ['SIEM', 'EDR'] },
            { observationId: 'o3', platformTypes: ['unknown'] },
            { observationId: 'unknown', platformTypes: ['EDR'] },
          ],
          writtenAt,
        });

        const rows = new Map((await mirror(a)).map((row) => [row.observationId, row]));
        expect(rows.get('o1')).toMatchObject({ evidenceWrittenAt: writtenAt, evidencePlatformTypes: ['EDR', 'SIEM'] });
        expect(rows.get('o2')).toMatchObject({ evidenceWrittenAt: null, evidencePlatformTypes: null });
        expect(rows.get('o3')).toMatchObject({ evidenceWrittenAt: writtenAt, evidencePlatformTypes: ['unknown'] });
      });

      it('should replace the platform types of the previous write instead of adding to them', async () => {
        await upsert(a, [obs('o1')]);
        await streams(a).markEvidenceWritten({
          connectorId: a.connectorId, entries: [{ observationId: 'o1', platformTypes: ['EDR', 'SIEM'] }], writtenAt: new Date('2026-10-05T09:00:00.000Z'),
        });
        const later = new Date('2026-10-06T09:00:00.000Z');

        await streams(a).markEvidenceWritten({ connectorId: a.connectorId, entries: [{ observationId: 'o1', platformTypes: ['EDR'] }], writtenAt: later });

        expect((await mirror(a))[0]).toMatchObject({ evidenceWrittenAt: later, evidencePlatformTypes: ['EDR'] });
      });

      it('should stamp more documents than one statement carries', async () => {
        const writtenAt = new Date('2026-10-05T09:00:00.000Z');
        const many = Array.from({ length: 2500 }, (_, i) => obs(`o${i}`, { sourceAssetId: `asset-${i}` }));
        await upsert(a, many);

        await streams(a).markEvidenceWritten({
          connectorId: a.connectorId,
          entries: many.map((o) => ({ observationId: o.observationId, platformTypes: ['EDR'] })),
          writtenAt,
        });

        expect((await mirror(a)).every((row) => row.evidenceWrittenAt?.getTime() === writtenAt.getTime() && row.evidencePlatformTypes?.[0] === 'EDR')).toBe(true);
      });

      it('should do nothing for an empty list', async () => {
        await upsert(a, [obs('o1')]);

        await streams(a).markEvidenceWritten({ connectorId: a.connectorId, entries: [], writtenAt: new Date() });

        expect((await mirror(a))[0].evidenceWrittenAt).toBeNull();
      });
    });

    describe('findCurrentObservations', () => {
      it('should supersede the documents a later FINISHED replay no longer plays', async () => {
        await upsert(a, [
          obs('t1-a', { attackPatternExternalId: 'T1001', simulationStartDate: T1 }),
          obs('t1-b', { attackPatternExternalId: 'T1002', simulationStartDate: T1 }),
          obs('t2-a', { attackPatternExternalId: 'T1001', simulationStartDate: T2 }),
        ]);

        expect(await currentIds(a)).toEqual(['t2-a']);
      });

      it('should supersede the documents of earlier replays even when only the first one still has documents', async () => {
        await upsert(a, [
          obs('t1-a', { attackPatternExternalId: 'T1001', simulationStartDate: T1 }),
          obs('t2-b', { attackPatternExternalId: 'T1002', simulationStartDate: T2 }),
        ]);

        expect(await currentIds(a)).toEqual(['t2-b']);
      });

      it('should supersede nothing when the more recent replay is still running', async () => {
        await upsert(a, [
          obs('t1', { simulationStartDate: T1, simulationStatus: 'FINISHED' }),
          obs('t2', { simulationStartDate: T2, simulationStatus: 'RUNNING' }),
        ]);

        expect(await currentIds(a)).toEqual(['t1', 't2']);
      });

      it('should keep every document when one was updated alone and no later replay exists', async () => {
        await upsert(a, [
          obs('t1-a', { attackPatternExternalId: 'T1001' }),
          obs('t1-b', { attackPatternExternalId: 'T1002' }),
        ]);
        await upsert(a, [obs('t1-b', { attackPatternExternalId: 'T1002', expectationType: 'PREVENTION' })], new Date('2026-10-06T08:00:00.000Z'));

        expect(await currentIds(a)).toEqual(['t1-a', 't1-b']);
      });

      it('should supersede nothing when two documents share the same start date', async () => {
        await upsert(a, [
          obs('x', { attackPatternExternalId: 'T1001', simulationStartDate: T1 }),
          obs('y', { attackPatternExternalId: 'T1002', simulationStartDate: T1 }),
        ]);

        expect(await currentIds(a)).toEqual(['x', 'y']);
      });

      it('should supersede a document without a start date by a dated FINISHED one', async () => {
        await upsert(a, [
          obs('undated', { simulationStartDate: null }),
          obs('dated', { simulationStartDate: T1 }),
        ]);

        expect(await currentIds(a)).toEqual(['dated']);
      });

      it('should never let a document without a start date supersede another', async () => {
        await upsert(a, [
          obs('undated', { simulationStartDate: null, simulationStatus: 'FINISHED' }),
          obs('dated', { simulationStartDate: T1, simulationStatus: 'RUNNING' }),
        ]);

        expect(await currentIds(a)).toEqual(['dated', 'undated']);
      });

      it('should keep a document without a start date when nothing dated supersedes it', async () => {
        await upsert(a, [obs('undated', { simulationStartDate: null }), obs('other-undated', { simulationStartDate: null })]);

        expect(await currentIds(a)).toEqual(['other-undated', 'undated']);
      });

      it('should supersede a non-FINISHED document by a later FINISHED one', async () => {
        await upsert(a, [
          obs('old-running', { simulationStartDate: T1, simulationStatus: 'RUNNING' }),
          obs('new-finished', { simulationStartDate: T2, simulationStatus: 'FINISHED' }),
        ]);

        expect(await currentIds(a)).toEqual(['new-finished']);
      });

      it('should judge each pair on its own documents', async () => {
        const other = { sourceAssetId: 'asset-2', scenarioId: 'scenario-1' };
        const otherScenario = { sourceAssetId: 'asset-1', scenarioId: 'scenario-2' };
        await upsert(a, [
          obs('p1-old', { simulationStartDate: T1 }),
          obs('p1-new', { simulationStartDate: T2 }),
          obs('p2-old', { ...other, simulationStartDate: T1 }),
          obs('p3-old', { ...otherScenario, simulationStartDate: T1 }),
        ]);

        expect(await currentIds(a, [PAIR, other, otherScenario])).toEqual(['p1-new', 'p2-old', 'p3-old']);
      });

      it('should return only the documents of the requested pairs', async () => {
        const other = { sourceAssetId: 'asset-2', scenarioId: 'scenario-1' };
        await upsert(a, [obs('p1'), obs('p2', other)]);

        expect(await currentIds(a, [other])).toEqual(['p2']);
        expect(await currentIds(a, [])).toEqual([]);
        expect(await currentIds(a, [{ sourceAssetId: 'nope', scenarioId: 'scenario-1' }])).toEqual([]);
      });

      it('should return the full mirror row, the evidence write and its platform types included', async () => {
        const writtenAt = new Date('2026-10-05T09:00:00.000Z');
        await upsert(a, [obs('o1')]);
        await streams(a).markEvidenceWritten({ connectorId: a.connectorId, entries: [{ observationId: 'o1', platformTypes: ['EDR'] }], writtenAt });

        const [row] = await streams(a).findCurrentObservations({ connectorId: a.connectorId, pairs: [PAIR] });

        expect(row).toEqual({
          tenantId: a.tenantId,
          connectorId: a.connectorId,
          openaevTenantId: OAEV_TENANT,
          observationId: 'o1',
          ...PAIR,
          attackPatternExternalId: 'T1059',
          expectationType: 'DETECTION',
          simulationStartDate: T1,
          simulationStatus: 'FINISHED',
          lastReportedAt: SEEN,
          evidenceWrittenAt: writtenAt,
          evidencePlatformTypes: ['EDR'],
        });
      });

      it('should return no platform types for a document whose evidence was never written', async () => {
        await upsert(a, [obs('o1')]);

        const [row] = await streams(a).findCurrentObservations({ connectorId: a.connectorId, pairs: [PAIR] });

        expect(row).toMatchObject({ observationId: 'o1', evidenceWrittenAt: null, evidencePlatformTypes: null });
      });

      it('should answer for more pairs than one statement carries', async () => {
        const many = Array.from({ length: 2500 }, (_, i) => ({ sourceAssetId: `asset-${i}`, scenarioId: 'scenario-1' }));
        await upsert(a, many.map((pair, i) => obs(`o${i}`, pair)));

        expect(await currentIds(a, many)).toHaveLength(2500);
      });
    });
  });
});
