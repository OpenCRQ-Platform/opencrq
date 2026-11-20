import { openaevAssets, openaevAttackObservations, openaevSyncStreams } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantFixture } from '../../helpers/openaev-connector-fixtures';
import { createAdminUser } from '../../helpers/factories';
import { createFixture, OAEV_TENANT } from '../../helpers/openaev-connector-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const insertMirrorRows = async (fixture: TenantFixture): Promise<void> => {
  await db.insert(openaevAttackObservations).values([{
    tenantId: fixture.tenantId,
    connectorId: fixture.connectorId,
    openaevTenantId: OAEV_TENANT,
    observationId: 'obs-1',
    sourceAssetId: 'asset-1',
    scenarioId: 'scenario-1',
    attackPatternExternalId: 'T1059',
    expectationType: 'DETECTION',
    simulationStartDate: new Date('2026-09-01T00:00:00.000Z'),
    simulationStatus: 'FINISHED',
    lastReportedAt: new Date('2026-10-01T00:00:00.000Z'),
  }]);
  await db.insert(openaevAssets).values([{
    tenantId: fixture.tenantId,
    connectorId: fixture.connectorId,
    sourceAssetId: 'asset-1',
    openaevTenantId: OAEV_TENANT,
    needsDescriptionFetch: true,
  }]);
};

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
  const key = (fixture: TenantFixture, stream: 'attack' | 'vulnerability' = 'attack', openaevTenantId = OAEV_TENANT) =>
    ({ connectorId: fixture.connectorId, openaevTenantId, stream });

  describe('stream cursor', () => {
    it('should have no state for a stream never read', async () => {
      expect(await streams(a).getStreamStates(a.connectorId)).toEqual([]);
    });

    it('should create the stream state on the first cursor save', async () => {
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });

      const [state] = await streams(a).getStreamStates(a.connectorId);
      expect(state).toMatchObject({
        tenantId: a.tenantId,
        connectorId: a.connectorId,
        openaevTenantId: OAEV_TENANT,
        stream: 'attack',
        cursor: 'c1',
        fullWalkStartedAt: null,
        lastFullWalkCompletedAt: null,
        lastFullWalkAttemptedAt: null,
        unreconciledSince: null,
      });
    });

    it('should move the cursor of the same stream instead of adding a row', async () => {
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c2' });

      const states = await streams(a).getStreamStates(a.connectorId);
      expect(states).toHaveLength(1);
      expect(states[0].cursor).toBe('c2');
    });

    it('should keep one cursor per stream and per OpenAEV tenant', async () => {
      await streams(a).saveStreamCursor({ ...key(a, 'attack'), cursor: 'attack-1' });
      await streams(a).saveStreamCursor({ ...key(a, 'vulnerability'), cursor: 'vuln-1' });
      await streams(a).saveStreamCursor({ ...key(a, 'attack', 'oaev-tenant-2'), cursor: 'other-tenant' });

      const states = await streams(a).getStreamStates(a.connectorId);
      expect(states.map((s) => [s.openaevTenantId, s.stream, s.cursor]).sort()).toEqual([
        [OAEV_TENANT, 'attack', 'attack-1'],
        [OAEV_TENANT, 'vulnerability', 'vuln-1'],
        ['oaev-tenant-2', 'attack', 'other-tenant'],
      ]);
    });

    it('should leave the full walk untouched when a cursor is saved during a walk', async () => {
      const startedAt = new Date('2026-10-05T10:00:00.000Z');
      await streams(a).startFullWalk({ ...key(a), startedAt });
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'page-3' });

      const [state] = await streams(a).getStreamStates(a.connectorId);
      expect(state).toMatchObject({ cursor: 'page-3', fullWalkStartedAt: startedAt });
    });
  });

  describe('full walk', () => {
    it('should clear the cursor and mark the walk in progress on start', async () => {
      const startedAt = new Date('2026-10-05T10:00:00.000Z');
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });

      await streams(a).startFullWalk({ ...key(a), startedAt });

      const [state] = await streams(a).getStreamStates(a.connectorId);
      expect(state).toMatchObject({ cursor: null, fullWalkStartedAt: startedAt });
    });

    it('should create the stream state when a walk starts on a stream never read', async () => {
      await streams(a).startFullWalk({ ...key(a), startedAt: new Date('2026-10-05T10:00:00.000Z') });

      expect(await streams(a).getStreamStates(a.connectorId)).toHaveLength(1);
    });

    it('should record a completion and an attempt when the walk ends ready', async () => {
      const completedAt = new Date('2026-10-05T11:00:00.000Z');
      await streams(a).startFullWalk({ ...key(a), startedAt: new Date('2026-10-05T10:00:00.000Z') });

      await streams(a).completeFullWalk({ ...key(a), completedAt, ready: true });

      const [state] = await streams(a).getStreamStates(a.connectorId);
      expect(state).toMatchObject({
        fullWalkStartedAt: null,
        lastFullWalkCompletedAt: completedAt,
        lastFullWalkAttemptedAt: completedAt,
      });
    });

    it('should record only an attempt when the walk ends not ready', async () => {
      const completedAt = new Date('2026-10-05T11:00:00.000Z');
      await streams(a).startFullWalk({ ...key(a), startedAt: new Date('2026-10-05T10:00:00.000Z') });

      await streams(a).completeFullWalk({ ...key(a), completedAt, ready: false });

      const [state] = await streams(a).getStreamStates(a.connectorId);
      expect(state).toMatchObject({
        fullWalkStartedAt: null,
        lastFullWalkCompletedAt: null,
        lastFullWalkAttemptedAt: completedAt,
      });
    });

    it('should keep the previous completion when a later walk ends not ready', async () => {
      const first = new Date('2026-09-20T11:00:00.000Z');
      const second = new Date('2026-10-05T11:00:00.000Z');
      await streams(a).startFullWalk({ ...key(a), startedAt: new Date('2026-09-20T10:00:00.000Z') });
      await streams(a).completeFullWalk({ ...key(a), completedAt: first, ready: true });
      await streams(a).startFullWalk({ ...key(a), startedAt: new Date('2026-10-05T10:00:00.000Z') });

      await streams(a).completeFullWalk({ ...key(a), completedAt: second, ready: false });

      const [state] = await streams(a).getStreamStates(a.connectorId);
      expect(state).toMatchObject({ lastFullWalkCompletedAt: first, lastFullWalkAttemptedAt: second });
    });

    it('should do nothing when a walk is completed on a stream with no state', async () => {
      await streams(a).completeFullWalk({ ...key(a), completedAt: new Date(), ready: true });

      expect(await streams(a).getStreamStates(a.connectorId)).toEqual([]);
    });
  });

  describe('unreconciled reads', () => {
    const SINCE = new Date('2026-10-05T10:00:00.000Z');

    it('should create the stream state, with no cursor, when a stream never read is noted unreconciled', async () => {
      await streams(a).markStreamUnreconciled({ ...key(a), since: SINCE });

      const [state] = await streams(a).getStreamStates(a.connectorId);
      expect(state).toMatchObject({ tenantId: a.tenantId, stream: 'attack', cursor: null, unreconciledSince: SINCE });
    });

    it('should keep the oldest instant when a stream already noted is noted again', async () => {
      const later = new Date('2026-10-06T10:00:00.000Z');
      await streams(a).markStreamUnreconciled({ ...key(a), since: SINCE });
      await streams(a).markStreamUnreconciled({ ...key(a), since: later });

      const states = await streams(a).getStreamStates(a.connectorId);
      expect(states).toHaveLength(1);
      expect(states[0].unreconciledSince).toEqual(SINCE);
    });

    it('should note an unreconciled stream with a cursor without losing the cursor', async () => {
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });

      await streams(a).markStreamUnreconciled({ ...key(a), since: SINCE });

      expect((await streams(a).getStreamStates(a.connectorId))[0]).toMatchObject({ cursor: 'c1', unreconciledSince: SINCE });
    });

    it('should clear the note on reconciliation, and note the next read from its own instant', async () => {
      const later = new Date('2026-10-06T10:00:00.000Z');
      await streams(a).markStreamUnreconciled({ ...key(a), since: SINCE });

      await streams(a).markStreamReconciled(key(a));
      expect((await streams(a).getStreamStates(a.connectorId))[0].unreconciledSince).toBeNull();

      await streams(a).markStreamUnreconciled({ ...key(a), since: later });
      expect((await streams(a).getStreamStates(a.connectorId))[0].unreconciledSince).toEqual(later);
    });

    it('should leave the cursor and the full walk alone when a stream is noted or reconciled, and the note alone when a cursor or a walk moves', async () => {
      const startedAt = new Date('2026-10-04T10:00:00.000Z');
      await streams(a).startFullWalk({ ...key(a), startedAt });
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'page-2' });
      await streams(a).markStreamUnreconciled({ ...key(a), since: SINCE });
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'page-3' });
      await streams(a).completeFullWalk({ ...key(a), completedAt: new Date(), ready: true });

      const [noted] = await streams(a).getStreamStates(a.connectorId);
      expect(noted).toMatchObject({ cursor: 'page-3', fullWalkStartedAt: null, unreconciledSince: SINCE });

      await streams(a).startFullWalk({ ...key(a), startedAt });
      await streams(a).markStreamReconciled(key(a));
      expect((await streams(a).getStreamStates(a.connectorId))[0]).toMatchObject({ cursor: null, fullWalkStartedAt: startedAt, unreconciledSince: null });
    });

    it('should keep each stream and each OpenAEV tenant apart', async () => {
      await streams(a).markStreamUnreconciled({ ...key(a, 'attack'), since: SINCE });
      await streams(a).markStreamUnreconciled({ ...key(a, 'vulnerability'), since: SINCE });
      await streams(a).markStreamUnreconciled({ ...key(a, 'attack', 'oaev-tenant-2'), since: SINCE });

      await streams(a).markStreamReconciled(key(a, 'attack'));

      const states = await streams(a).getStreamStates(a.connectorId);
      expect(states.map((state) => [state.openaevTenantId, state.stream, state.unreconciledSince]).sort()).toEqual([
        [OAEV_TENANT, 'attack', null],
        [OAEV_TENANT, 'vulnerability', SINCE],
        ['oaev-tenant-2', 'attack', SINCE],
      ]);
    });

    it('should do nothing when a stream with no state is reconciled', async () => {
      await streams(a).markStreamReconciled(key(a));

      expect(await streams(a).getStreamStates(a.connectorId)).toEqual([]);
    });

    it('should refuse to note a read on another tenant connector', async () => {
      await expect(streams(a).markStreamUnreconciled({ ...key(b), since: SINCE })).rejects.toThrow('Access Denied');

      expect(await db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, b.connectorId))).toEqual([]);
    });

    it('should not clear the note of another tenant connector', async () => {
      await streams(b).markStreamUnreconciled({ ...key(b), since: SINCE });

      await streams(a).markStreamReconciled(key(b));

      expect((await streams(b).getStreamStates(b.connectorId))[0].unreconciledSince).toEqual(SINCE);
    });
  });

  describe('resetState', () => {
    it('should empty the three tables of the connector', async () => {
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });
      await insertMirrorRows(a);

      await streams(a).resetState(a.connectorId);

      expect(await db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, a.connectorId))).toEqual([]);
      expect(await db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, a.connectorId))).toEqual([]);
      expect(await db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, a.connectorId))).toEqual([]);
    });

    it('should leave the state of another tenant connector alone', async () => {
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });
      await streams(b).saveStreamCursor({ ...key(b), cursor: 'c1' });
      await insertMirrorRows(a);
      await insertMirrorRows(b);

      await streams(a).resetState(a.connectorId);

      expect(await db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, b.connectorId))).toHaveLength(1);
      expect(await db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, b.connectorId))).toHaveLength(1);
      expect(await db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, b.connectorId))).toHaveLength(1);
    });

    it('should leave the state of another tenant connector alone when asked about it from this tenant', async () => {
      await streams(b).saveStreamCursor({ ...key(b), cursor: 'c1' });
      await insertMirrorRows(b);

      await streams(a).resetState(b.connectorId);

      expect(await db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, b.connectorId))).toHaveLength(1);
      expect(await db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, b.connectorId))).toHaveLength(1);
      expect(await db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, b.connectorId))).toHaveLength(1);
    });
  });

  describe('forgetSnapshotState', () => {
    it('should empty the stream states and the mirror of the connector and keep its asset registry', async () => {
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });
      await streams(a).saveStreamCursor({ ...key(a, 'vulnerability'), cursor: 'c2' });
      await insertMirrorRows(a);

      await streams(a).forgetSnapshotState(a.connectorId);

      expect(await db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, a.connectorId))).toEqual([]);
      expect(await db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, a.connectorId))).toEqual([]);
      expect(await db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, a.connectorId))).toHaveLength(1);
    });

    it('should leave the state of another tenant connector alone', async () => {
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });
      await streams(b).saveStreamCursor({ ...key(b), cursor: 'c1' });
      await insertMirrorRows(a);
      await insertMirrorRows(b);

      await streams(a).forgetSnapshotState(a.connectorId);

      expect(await db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, b.connectorId))).toHaveLength(1);
      expect(await db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, b.connectorId))).toHaveLength(1);
    });

    it('should leave the state of another tenant connector alone when asked about it from this tenant', async () => {
      await streams(b).saveStreamCursor({ ...key(b), cursor: 'c1' });
      await insertMirrorRows(b);

      await streams(a).forgetSnapshotState(b.connectorId);

      expect(await db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, b.connectorId))).toHaveLength(1);
      expect(await db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, b.connectorId))).toHaveLength(1);
    });

    it('should do nothing for a connector that holds no state', async () => {
      await expect(streams(a).forgetSnapshotState(a.connectorId)).resolves.toBeUndefined();
    });
  });

  describe('tenant isolation', () => {
    it('should not return the stream states of another tenant connector', async () => {
      await streams(b).saveStreamCursor({ ...key(b), cursor: 'secret' });

      expect(await streams(a).getStreamStates(b.connectorId)).toEqual([]);
    });

    it('should refuse to save a cursor on another tenant connector', async () => {
      await expect(streams(a).saveStreamCursor({ ...key(b), cursor: 'x' })).rejects.toThrow('Access Denied');

      expect(await db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, b.connectorId))).toEqual([]);
    });

    it('should refuse to start a full walk on another tenant connector', async () => {
      await expect(streams(a).startFullWalk({ ...key(b), startedAt: new Date() })).rejects.toThrow('Access Denied');
    });

    it('should not alter the stream state of another tenant connector on completion', async () => {
      await streams(b).startFullWalk({ ...key(b), startedAt: new Date('2026-10-05T10:00:00.000Z') });

      await streams(a).completeFullWalk({ ...key(b), completedAt: new Date(), ready: true });

      const [state] = await streams(b).getStreamStates(b.connectorId);
      expect(state).toMatchObject({ lastFullWalkCompletedAt: null, lastFullWalkAttemptedAt: null });
      expect(state.fullWalkStartedAt).not.toBeNull();
    });

    it('should serve the same tenant to a member client origin', async () => {
      await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });

      const states = await services.withOrigin(a.adminOrigin).openaevConnector.getStreamStates(a.connectorId);
      expect(states).toHaveLength(1);
    });
  });

  it('should delete the state with the connector', async () => {
    await streams(a).saveStreamCursor({ ...key(a), cursor: 'c1' });
    await insertMirrorRows(a);

    await db.execute(sql`delete from integration_settings where id = ${a.connectorId}`);

    expect(await db.select().from(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, a.connectorId))).toEqual([]);
    expect(await db.select().from(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, a.connectorId))).toEqual([]);
    expect(await db.select().from(openaevAssets).where(eq(openaevAssets.connectorId, a.connectorId))).toEqual([]);
  });
});
