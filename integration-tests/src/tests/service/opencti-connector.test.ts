import type { EventOrigin } from '@app/module';
import { openctiConnectorRepository, openctiConnectorSettings, openctiStreamObjects, openctiStreamReportRefs } from '@app/module';
import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('OpenCTI Connector Service', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;
  let serviceAccountId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;

    serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: 'Test OpenCTI Bot',
    });
  });

  const getSettingsRow = (tid: string) =>
    db.select().from(openctiConnectorSettings).where(eq(openctiConnectorSettings.tenantId, tid));

  const getStreamObjectRows = (tid: string) =>
    db.select().from(openctiStreamObjects).where(eq(openctiStreamObjects.tenantId, tid));

  const liveMirrorRows = async (tid: string) =>
    (await getStreamObjectRows(tid)).filter((row) => row.deletedAt === null);

  const mirrorRow = async (stixId: string) =>
    (await db.select().from(openctiStreamObjects)
      .where(and(eq(openctiStreamObjects.tenantId, tenantId), eq(openctiStreamObjects.stixId, stixId))))[0];

  // The mirror's reads are repository methods with no service of their own since the rebuild batch
  // issues them inside its own transaction, and each one owes a proof that it ignores tombstones.
  describe('configure', () => {
    it('should create a row when no row exists yet, enabled by default', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(
        tenantId, serviceAccountId, 'live-stream-1',
      );

      const rows = await getSettingsRow(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ streamId: 'live-stream-1', serviceAccountId, enabled: true, cursor: null });
    });

    it('should update the existing row without creating a duplicate', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-2');

      const rows = await getSettingsRow(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0].streamId).toBe('live-stream-2');
    });

    it('should reset a previously persisted cursor when reconfigured', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1620249512318-0', new Date(), null, 0, 0);

      let rows = await getSettingsRow(tenantId);
      expect(rows[0].cursor).toBe('1620249512318-0');

      // Reconfiguring (e.g. picking a different stream) must null out the stale cursor: a
      // previous stream's event id is meaningless for a different stream.
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-2');

      rows = await getSettingsRow(tenantId);
      expect(rows[0].cursor).toBeNull();
      expect(rows[0].lastEventAt).toBeNull();
      expect(rows[0].historyStartAt).toBeNull();
      expect(rows[0].reachedLiveTailAt).toBeNull();
    });

    it('should reset a previously set authFailedAt when reconfigured', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      await services.withOrigin(adminOrigin).openctiConnector.markAuthFailed(tenantId);

      let rows = await getSettingsRow(tenantId);
      expect(rows[0].authFailedAt).not.toBeNull();

      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-2');

      rows = await getSettingsRow(tenantId);
      expect(rows[0].authFailedAt).toBeNull();
      expect(rows[0].enabled).toBe(true);
    });

    it('should set historyStartAt once, on the first cursor update, and never move it afterwards', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      const firstEventAt = new Date('2025-01-30T00:00:00.000Z');
      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', firstEventAt, null, 0, 0);

      let rows = await getSettingsRow(tenantId);
      expect(rows[0].historyStartAt).toEqual(firstEventAt);

      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '2', new Date('2025-06-01T00:00:00.000Z'), null, 0, 0);

      rows = await getSettingsRow(tenantId);
      expect(rows[0].historyStartAt).toEqual(firstEventAt);
    });

    it('should set backfillTargetAt once, to the time of the first cursor update, and never move it afterwards', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', new Date('2025-01-30T00:00:00.000Z'), null, 0, 0);

      let rows = await getSettingsRow(tenantId);
      const firstBackfillTargetAt = rows[0].backfillTargetAt;
      expect(firstBackfillTargetAt).not.toBeNull();

      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '2', new Date('2025-06-01T00:00:00.000Z'), null, 0, 0);

      rows = await getSettingsRow(tenantId);
      expect(rows[0].backfillTargetAt).toEqual(firstBackfillTargetAt);
    });

    it('should never let lastEventAt regress, even when a later update carries an earlier date', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      const laterDate = new Date('2025-08-20T08:46:43.531Z');
      const earlierDate = new Date('2025-01-30T05:29:29.143Z');
      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', laterDate, null, 0, 0);
      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '2', earlierDate, null, 0, 0);

      const rows = await getSettingsRow(tenantId);
      // Cursor (id) still advances, but the timeline date stays at the max ever seen.
      expect(rows[0].cursor).toBe('2');
      expect(rows[0].lastEventAt).toEqual(laterDate);
    });

    it('should latch reachedLiveTailAt permanently once set, ignoring later null candidates', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      const reachedAt = new Date('2026-07-30T10:00:00.000Z');
      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', new Date(), reachedAt, 0, 0);

      let rows = await getSettingsRow(tenantId);
      expect(rows[0].reachedLiveTailAt).toEqual(reachedAt);

      // A later flush with no candidate (e.g. a quiet period) must not clear the latch.
      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '2', new Date(), null, 0, 0);

      rows = await getSettingsRow(tenantId);
      expect(rows[0].reachedLiveTailAt).toEqual(reachedAt);
    });

    it('should return the latch and the read total the row holds after the write', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      const reachedAt = new Date('2026-07-30T10:00:00.000Z');
      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', new Date(), null, 40, 0);

      const persisted = await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '2', new Date(), reachedAt, 2, 0);

      expect(persisted).toEqual({ reachedLiveTailAt: reachedAt, objectsRead: 42 });
    });

    it('should return null when the generation guard refuses the position', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      await services.withOrigin(adminOrigin).openctiConnector.resetStreamState(tenantId);

      const persisted = await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1', new Date(), new Date(), 1, 0);

      expect(persisted).toBeNull();
      expect((await getSettingsRow(tenantId))[0].cursor).toBeNull();
    });

    it('should not write to another tenant', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBRows = await getSettingsRow(tenantBId);
      expect(tenantBRows).toHaveLength(0);
    });
  });

  // The service takes an explicit `tenantId` argument (the background connector manager needs to
  // act on any tenant under a `system`/`connector` origin), so isolation cannot rely on the
  // argument being trustworthy: it is the row-level policy attached to the origin that must reject
  // a client origin reaching for another tenant's id.
  describe('tenant isolation against a forged tenantId argument', () => {
    let tenantBOrigin: EventOrigin;

    beforeEach(async () => {
      const tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      await services.withOrigin(adminOrigin).openctiConnector.upsertStreamObject(
        tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a' },
      );
    });

    it('should hide another tenant settings and mirrored objects from reads', async () => {
      await expect(services.withOrigin(tenantBOrigin).openctiConnector.getSettings(tenantId)).resolves.toBeNull();
      await expect(services.withOrigin(tenantBOrigin).openctiConnector.countStreamObjects(tenantId)).resolves.toBe(0);
    });

    it('should leave another tenant settings untouched on write attempts', async () => {
      await expect(
        services.withOrigin(tenantBOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'hijacked-stream'),
      ).rejects.toThrow();
      await services.withOrigin(tenantBOrigin).openctiConnector.setEnabled(tenantId, true).catch(() => undefined);
      await services.withOrigin(tenantBOrigin).openctiConnector.updateCursor(tenantId, 'hijacked-cursor', new Date(), null, 0, 0).catch(() => undefined);

      const rows = await getSettingsRow(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ streamId: 'live-stream-1', enabled: true, cursor: null });
    });

    it('should leave another tenant mirrored objects untouched on write attempts', async () => {
      await services.withOrigin(tenantBOrigin).openctiConnector.deleteStreamObject(tenantId, 'intrusion-set--a').catch(() => undefined);

      const rows = await liveMirrorRows(tenantId);
      expect(rows).toHaveLength(1);
    });
  });

  describe('setEnabled', () => {
    it('should toggle enabled without touching a previously persisted cursor', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      await services.withOrigin(adminOrigin).openctiConnector.updateCursor(tenantId, '1620249512318-0', new Date(), null, 0, 0);

      await services.withOrigin(adminOrigin).openctiConnector.setEnabled(tenantId, false);

      const rows = await getSettingsRow(tenantId);
      expect(rows[0].enabled).toBe(false);
      expect(rows[0].cursor).toBe('1620249512318-0');
    });

    it('should clear a previously set authFailedAt, whichever direction it is called', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');
      await services.withOrigin(adminOrigin).openctiConnector.markAuthFailed(tenantId);

      await services.withOrigin(adminOrigin).openctiConnector.setEnabled(tenantId, true);

      const rows = await getSettingsRow(tenantId);
      expect(rows[0].authFailedAt).toBeNull();
      expect(rows[0].enabled).toBe(true);
    });
  });

  describe('markAuthFailed', () => {
    it('should force enabled back to false and stamp authFailedAt', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');

      await services.withOrigin(adminOrigin).openctiConnector.markAuthFailed(tenantId);

      const rows = await getSettingsRow(tenantId);
      expect(rows[0].enabled).toBe(false);
      expect(rows[0].authFailedAt).not.toBeNull();
    });

    it('should not write to another tenant', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');

      const tenantBId = await createTenant(services, adminUserId);
      await services.withOrigin(adminOrigin).openctiConnector.markAuthFailed(tenantBId).catch(() => undefined);

      const tenantBRows = await getSettingsRow(tenantBId);
      expect(tenantBRows).toHaveLength(0);
    });
  });

  describe('getSettings', () => {
    it('should return null when no settings row exists', async () => {
      const settings = await services.withOrigin(adminOrigin).openctiConnector.getSettings(tenantId);
      expect(settings).toBeNull();
    });
  });

  describe('findAllEnabled (system origin)', () => {
    it('should list only enabled tenants across the whole platform', async () => {
      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-1');

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      await services.withOrigin(tenantBOrigin).openctiConnector.configure(tenantBId, serviceAccountId, 'live-stream-2');
      // tenantB is explicitly disabled after configuring, should not appear in the list.
      await services.withOrigin(tenantBOrigin).openctiConnector.setEnabled(tenantBId, false);

      const enabled = await services.withOrigin({ type: 'system' }).openctiConnector.findAllEnabled();
      expect(enabled.map((row) => row.tenantId)).toEqual([tenantId]);
    });

    it('should reject a non-system origin', async () => {
      await expect(services.withOrigin(adminOrigin).openctiConnector.findAllEnabled()).rejects.toThrow();
    });
  });

  describe('stream object mirror', () => {
    const mirror = () => services.withOrigin(adminOrigin).openctiConnector;

    const clearMarks = () => db.update(openctiStreamObjects).set({ pending: false })
      .where(eq(openctiStreamObjects.tenantId, tenantId));

    it('should upsert mirrored STIX objects, marked pending, scoped per tenant', async () => {
      await mirror().upsertStreamObject(
        tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a', type: 'intrusion-set', name: 'Group A' },
      );

      const rows = await getStreamObjectRows(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0].stixType).toBe('intrusion-set');
      expect(rows[0].pending).toBe(true);

      const tenantBId = await createTenant(services, adminUserId);
      expect(await getStreamObjectRows(tenantBId)).toHaveLength(0);
    });

    it('should upsert (not duplicate) the same stixId', async () => {
      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a', name: 'v1' });
      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a', name: 'v2' });

      const rows = await getStreamObjectRows(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0].data).toMatchObject({ name: 'v2' });
    });

    it('should mirror an object carrying a null byte, stripped, with its denormalised columns set', async () => {
      const sanitised = await mirror().upsertStreamObject(
        tenantId,
        'relationship--a',
        'relationship',
        {
          id: 'relationship--a',
          type: 'relationship',
          source_ref: 'intrusion-set--a',
          target_ref: 'attack-pattern--b',
          relationship_type: 'uses',
          created_by_ref: 'identity--c',
          external_references: [{ source_name: `MITRE${'\u0000'}`, description: `Ligne 1\nLigne 2\t"quoted" é 漢字${'\u0000'}` }],
        },
      );

      expect(sanitised).toEqual({ changedStrings: 2, droppedKeys: 0 });
      const rows = await getStreamObjectRows(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sourceRef: 'intrusion-set--a',
        targetRef: 'attack-pattern--b',
        relationshipType: 'uses',
        createdByRef: 'identity--c',
      });
      expect(rows[0].data).toMatchObject({
        external_references: [{ source_name: 'MITRE', description: 'Ligne 1\nLigne 2\t"quoted" é 漢字' }],
      });
    });

    it('should mirror an object whose stix id carries a null byte, under the stripped id', async () => {
      // `stix_id` is a text column, which Postgres refuses the byte in just as it does in `jsonb`:
      // the caller strips it before the write, so the id it passes is already the stored one.
      await mirror().upsertStreamObject(
        tenantId, 'intrusion-set--a', 'intrusion-set', { id: `intrusion-set--a${'\u0000'}`, type: 'intrusion-set', name: 'Group A' },
      );

      const rows = await getStreamObjectRows(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0].stixId).toBe('intrusion-set--a');
      expect(rows[0].data).toMatchObject({ id: 'intrusion-set--a', name: 'Group A' });
      const found = await openctiConnectorRepository.findStreamObjectsByIds(repositoryContextOf(db, adminOrigin), tenantId, ['intrusion-set--a']);
      expect(found).toHaveLength(1);
    });

    /**
     * The stream re-serves identical objects in quantity and the mark is what the rebuild selects
     * on, so an unchanged payload must move neither it nor the timestamp it is cleared against.
     */
    it('should leave the mark and the timestamp alone when the payload is byte-identical', async () => {
      const body = { id: 'intrusion-set--a', type: 'intrusion-set', name: 'Group A' };
      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', body);
      await clearMarks();
      const settled = await mirrorRow('intrusion-set--a');

      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { ...body });
      const unchanged = await mirrorRow('intrusion-set--a');
      expect(unchanged.pending).toBe(false);
      expect(unchanged.updatedAt).toEqual(settled.updatedAt);

      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { ...body, name: 'Group A prime' });
      const changed = await mirrorRow('intrusion-set--a');
      expect(changed.pending).toBe(true);
      expect(changed.updatedAt.getTime()).toBeGreaterThan(settled.updatedAt.getTime());
    });

    it('should leave a tombstone rather than removing the row on a delete', async () => {
      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a' });
      await clearMarks();

      await mirror().deleteStreamObject(tenantId, 'intrusion-set--a');

      const tombstone = await mirrorRow('intrusion-set--a');
      expect(tombstone.deletedAt).not.toBeNull();
      expect(tombstone.pending).toBe(true);
    });

    /**
     * The stream filter matches entities, so a deletion fans out to nothing and the relationships
     * holding the id are never named by an event of their own.
     */
    it('should tombstone the relationships holding a deleted id at either end, and leave its producer alone', async () => {
      await mirror().upsertStreamObject(tenantId, 'identity--p', 'identity', { id: 'identity--p', type: 'identity' });
      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', {
        id: 'intrusion-set--a', type: 'intrusion-set', created_by_ref: 'identity--p',
      });
      await mirror().upsertStreamObject(tenantId, 'attack-pattern--t1', 'attack-pattern', { id: 'attack-pattern--t1', type: 'attack-pattern' });
      await mirror().upsertStreamObject(tenantId, 'relationship--uses', 'relationship', {
        id: 'relationship--uses', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--a', target_ref: 'attack-pattern--t1',
      });
      await mirror().upsertStreamObject(tenantId, 'relationship--targeted', 'relationship', {
        id: 'relationship--targeted', type: 'relationship', relationship_type: 'targets', source_ref: 'intrusion-set--b', target_ref: 'intrusion-set--a',
      });
      await mirror().upsertStreamObject(tenantId, 'relationship--elsewhere', 'relationship', {
        id: 'relationship--elsewhere', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--b', target_ref: 'attack-pattern--t1',
      });
      await clearMarks();

      await mirror().deleteStreamObject(tenantId, 'intrusion-set--a');

      const tombstoned = (await getStreamObjectRows(tenantId)).filter((row) => row.deletedAt !== null);
      expect(tombstoned.map((row) => row.stixId).sort()).toEqual(['intrusion-set--a', 'relationship--targeted', 'relationship--uses']);
      expect(tombstoned.every((row) => row.pending)).toBe(true);
      expect((await liveMirrorRows(tenantId)).map((row) => row.stixId).sort())
        .toEqual(['attack-pattern--t1', 'identity--p', 'relationship--elsewhere']);
    });

    it('should tombstone nothing twice when the same delete is served again', async () => {
      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a', type: 'intrusion-set' });
      await mirror().upsertStreamObject(tenantId, 'relationship--uses', 'relationship', {
        id: 'relationship--uses', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--a', target_ref: 'attack-pattern--t1',
      });
      await mirror().deleteStreamObject(tenantId, 'intrusion-set--a');
      const first = await mirrorRow('relationship--uses');

      await mirror().deleteStreamObject(tenantId, 'intrusion-set--a');

      expect((await mirrorRow('relationship--uses')).deletedAt).toEqual(first.deletedAt);
    });

    it('should revive a tombstone on the next upsert, even one carrying the very same payload', async () => {
      const body = { id: 'intrusion-set--a', type: 'intrusion-set', name: 'Group A' };
      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', body);
      await mirror().deleteStreamObject(tenantId, 'intrusion-set--a');
      await clearMarks();

      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { ...body });

      const revived = await mirrorRow('intrusion-set--a');
      expect(revived.deletedAt).toBeNull();
      expect(revived.pending).toBe(true);
      expect(await mirror().countStreamObjects(tenantId)).toBe(1);
    });

    /**
     * One assertion per reader: a single read forgetting the filter brings a deleted relationship
     * back into a record, which is the bug the tombstone creates the room for.
     */
    it('should hide a tombstone from every read of the mirror', async () => {
      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a', type: 'intrusion-set' });
      await mirror().upsertStreamObject(tenantId, 'attack-pattern--t1', 'attack-pattern', { id: 'attack-pattern--t1', type: 'attack-pattern' });
      await mirror().upsertStreamObject(tenantId, 'relationship--uses', 'relationship', {
        id: 'relationship--uses',
        type: 'relationship',
        relationship_type: 'uses',
        source_ref: 'intrusion-set--a',
        target_ref: 'attack-pattern--t1',
        created_by_ref: 'identity--p',
      });

      await mirror().deleteStreamObject(tenantId, 'relationship--uses');
      await mirror().deleteStreamObject(tenantId, 'intrusion-set--a');

      const ctx = repositoryContextOf(db, adminOrigin);
      const repo = openctiConnectorRepository;
      const survivors = await repo.findStreamObjectsByIds(ctx, tenantId, ['intrusion-set--a', 'relationship--uses', 'attack-pattern--t1']);
      expect(survivors.map((row) => row.stixId)).toEqual(['attack-pattern--t1']);
      expect(await repo.findRelationshipsBySourceRefs(ctx, tenantId, ['intrusion-set--a'], ['uses'])).toEqual([]);
      expect(await repo.countStreamObjects(ctx, tenantId)).toBe(1);
      expect(await mirror().countStreamObjects(tenantId)).toBe(1);
    });

    it('should read only the eight most recent reports citing a threat, in the counter\'s order, each report once', async () => {
      const day = (n: number) => `2025-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;
      const cite = (stixId: string, threats: Array<string>, published?: string) => mirror().upsertStreamObject(
        tenantId, stixId, 'report', { id: stixId, type: 'report', object_refs: threats, ...(published === undefined ? {} : { published }) },
      );
      for (let n = 4; n <= 9; n++) {
        await cite(`report--d${n}`, ['intrusion-set--t'], day(n));
      }
      await cite('report--newest-and-u', ['intrusion-set--t', 'intrusion-set--u'], day(10));
      // Two reports sharing the eighth date: the lower id keeps the last slot.
      await cite('report--tie-b', ['intrusion-set--t'], day(3));
      await cite('report--tie-a', ['intrusion-set--t'], day(3));
      await cite('report--older', ['intrusion-set--t'], day(2));
      await cite('report--undated', ['intrusion-set--t']);
      await cite('report--u-undated', ['intrusion-set--u']);

      const reports = await openctiConnectorRepository.findReportsCitingThreats(
        repositoryContextOf(db, adminOrigin), tenantId, ['intrusion-set--t', 'intrusion-set--u'],
      );

      // `t` keeps eight of its eleven, `u` keeps its two, and the report they share comes back once.
      expect(reports.map((row) => row.stixId).sort()).toEqual([
        'report--d4', 'report--d5', 'report--d6', 'report--d7', 'report--d8', 'report--d9', 'report--newest-and-u', 'report--tie-a', 'report--u-undated',
      ]);
    });

    it('should count mirrored objects for the calling tenant only', async () => {
      await mirror().upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a' });
      await mirror().upsertStreamObject(tenantId, 'location--b', 'location', { id: 'location--b' });

      expect(await mirror().countStreamObjects(tenantId)).toBe(2);
    });
  });

  describe('repointStreamObjectRefs', () => {
    beforeEach(async () => {
      const mirror = services.withOrigin(adminOrigin).openctiConnector;
      await mirror.upsertStreamObject(tenantId, 'relationship--uses', 'relationship', {
        id: 'relationship--uses', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--absorbed', target_ref: 'attack-pattern--1',
      });
      await mirror.upsertStreamObject(tenantId, 'relationship--targets', 'relationship', {
        id: 'relationship--targets', type: 'relationship', relationship_type: 'targets', source_ref: 'intrusion-set--other', target_ref: 'intrusion-set--absorbed',
      });
      await mirror.upsertStreamObject(tenantId, 'intrusion-set--authored', 'intrusion-set', {
        id: 'intrusion-set--authored', type: 'intrusion-set', created_by_ref: 'intrusion-set--absorbed',
      });
      await mirror.upsertStreamObject(tenantId, 'relationship--untouched', 'relationship', {
        id: 'relationship--untouched', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--other', target_ref: 'attack-pattern--1',
      });
    });

    it('should move every reference to the absorbed id onto the survivor, in the indexed columns and in the STIX body', async () => {
      const mirror = services.withOrigin(adminOrigin).openctiConnector;
      const ctx = repositoryContextOf(db, adminOrigin);
      const repo = openctiConnectorRepository;
      await mirror.repointStreamObjectRefs(tenantId, 'intrusion-set--absorbed', 'intrusion-set--survivor');

      const uses = await repo.findRelationshipsBySourceRefs(ctx, tenantId, ['intrusion-set--survivor'], ['uses']);
      expect(uses.map((row) => row.stixId)).toEqual(['relationship--uses']);
      expect(uses[0]?.data['source_ref']).toBe('intrusion-set--survivor');
      expect(uses[0]?.pending).toBe(true);

      const [targets] = await repo.findStreamObjectsByIds(ctx, tenantId, ['relationship--targets']);
      expect(targets?.targetRef).toBe('intrusion-set--survivor');
      expect(targets?.data['target_ref']).toBe('intrusion-set--survivor');

      const [authored] = await repo.findStreamObjectsByIds(ctx, tenantId, ['intrusion-set--authored']);
      expect(authored?.createdByRef).toBe('intrusion-set--survivor');
      expect(authored?.data['created_by_ref']).toBe('intrusion-set--survivor');

      await expect(repo.findRelationshipsBySourceRefs(ctx, tenantId, ['intrusion-set--absorbed'], ['uses'])).resolves.toEqual([]);
      const [untouched] = await repo.findStreamObjectsByIds(ctx, tenantId, ['relationship--untouched']);
      expect(untouched?.sourceRef).toBe('intrusion-set--other');
      expect(untouched?.data['source_ref']).toBe('intrusion-set--other');
    });

    it('should drop an absorbed relationship the survivor already carries undated, and keep it when the survivor\'s is dated', async () => {
      const mirror = services.withOrigin(adminOrigin).openctiConnector;
      await mirror.upsertStreamObject(tenantId, 'relationship--survivor-uses', 'relationship', {
        id: 'relationship--survivor-uses', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--survivor', target_ref: 'attack-pattern--1',
      });
      await mirror.upsertStreamObject(tenantId, 'relationship--absorbed-targets-fr', 'relationship', {
        id: 'relationship--absorbed-targets-fr', type: 'relationship', relationship_type: 'targets', source_ref: 'intrusion-set--absorbed', target_ref: 'location--fr',
      });
      await mirror.upsertStreamObject(tenantId, 'relationship--survivor-targets-fr', 'relationship', {
        id: 'relationship--survivor-targets-fr', type: 'relationship', relationship_type: 'targets', source_ref: 'intrusion-set--survivor', target_ref: 'location--fr', start_time: '2024-01-01T00:00:00.000Z',
      });
      await mirror.upsertStreamObject(tenantId, 'relationship--x-targets-absorbed', 'relationship', {
        id: 'relationship--x-targets-absorbed', type: 'relationship', relationship_type: 'targets', source_ref: 'intrusion-set--x', target_ref: 'intrusion-set--absorbed',
      });
      await mirror.upsertStreamObject(tenantId, 'relationship--x-targets-survivor', 'relationship', {
        id: 'relationship--x-targets-survivor', type: 'relationship', relationship_type: 'targets', source_ref: 'intrusion-set--x', target_ref: 'intrusion-set--survivor',
      });

      await mirror.repointStreamObjectRefs(tenantId, 'intrusion-set--absorbed', 'intrusion-set--survivor');

      const ctx = repositoryContextOf(db, adminOrigin);
      const repo = openctiConnectorRepository;
      const uses = await repo.findRelationshipsBySourceRefs(ctx, tenantId, ['intrusion-set--survivor'], ['uses']);
      expect(uses.map((row) => row.stixId)).toEqual(['relationship--survivor-uses']);
      const targetsFr = await repo.findRelationshipsBySourceRefs(ctx, tenantId, ['intrusion-set--survivor'], ['targets']);
      expect(targetsFr.map((row) => row.stixId).sort()).toEqual(['relationship--absorbed-targets-fr', 'relationship--survivor-targets-fr']);
      const targetedBy = await db.select({ stixId: openctiStreamObjects.stixId }).from(openctiStreamObjects).where(and(
        eq(openctiStreamObjects.tenantId, tenantId),
        eq(openctiStreamObjects.targetRef, 'intrusion-set--survivor'),
        eq(openctiStreamObjects.relationshipType, 'targets'),
        isNull(openctiStreamObjects.deletedAt),
      ));
      expect(targetedBy.map((row) => row.stixId).sort()).toEqual(['relationship--targets', 'relationship--x-targets-survivor']);
      // Dropped as duplicates of an edge the survivor already carries undated: tombstoned, not gone.
      await expect(repo.findStreamObjectsByIds(ctx, tenantId, ['relationship--uses', 'relationship--x-targets-absorbed'])).resolves.toEqual([]);
    });

    it('should move the reports citing the absorbed threat onto the survivor, once for a report citing both, and mark the survivor', async () => {
      const mirror = services.withOrigin(adminOrigin).openctiConnector;
      const ctx = repositoryContextOf(db, adminOrigin);
      await mirror.upsertStreamObject(tenantId, 'intrusion-set--survivor', 'intrusion-set', { id: 'intrusion-set--survivor', type: 'intrusion-set' });
      await mirror.upsertStreamObject(tenantId, 'report--absorbed-only', 'report', {
        id: 'report--absorbed-only', type: 'report', object_refs: ['intrusion-set--absorbed'],
      });
      await mirror.upsertStreamObject(tenantId, 'report--both', 'report', {
        id: 'report--both', type: 'report', object_refs: ['intrusion-set--absorbed', 'intrusion-set--survivor'],
      });
      await mirror.upsertStreamObject(tenantId, 'report--survivor-only', 'report', {
        id: 'report--survivor-only', type: 'report', object_refs: ['intrusion-set--survivor'],
      });
      await db.update(openctiStreamObjects).set({ pending: false }).where(eq(openctiStreamObjects.tenantId, tenantId));

      await mirror.repointStreamObjectRefs(tenantId, 'intrusion-set--absorbed', 'intrusion-set--survivor');

      const citing = await openctiConnectorRepository.findReportsCitingThreats(ctx, tenantId, ['intrusion-set--survivor']);
      expect(citing.map((row) => row.stixId).sort()).toEqual(['report--absorbed-only', 'report--both', 'report--survivor-only']);
      expect(await openctiConnectorRepository.findReportsCitingThreats(ctx, tenantId, ['intrusion-set--absorbed'])).toEqual([]);
      const refs = await db.select().from(openctiStreamReportRefs).where(eq(openctiStreamReportRefs.tenantId, tenantId));
      expect(refs.filter((row) => row.threatStixId === 'intrusion-set--absorbed')).toEqual([]);
      expect(refs.filter((row) => row.reportStixId === 'report--both').map((row) => row.threatStixId)).toEqual(['intrusion-set--survivor']);
      const objectRefsOf = (stixId: string) => citing.find((row) => row.stixId === stixId)?.data['object_refs'];
      expect(objectRefsOf('report--absorbed-only')).toEqual(['intrusion-set--survivor']);
      expect(objectRefsOf('report--both')).toEqual(['intrusion-set--survivor']);
      expect((await mirrorRow('intrusion-set--survivor')).pending).toBe(true);
    });

    it('should leave another tenant mirrored objects untouched on a forged write', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      await services.withOrigin(tenantBOrigin).openctiConnector
        .repointStreamObjectRefs(tenantId, 'intrusion-set--absorbed', 'intrusion-set--survivor')
        .catch(() => undefined);

      const rows = await getStreamObjectRows(tenantId);
      expect(rows.filter((row) => row.sourceRef === 'intrusion-set--absorbed').map((row) => row.stixId)).toEqual(['relationship--uses']);
      expect(rows.filter((row) => row.targetRef === 'intrusion-set--absorbed').map((row) => row.stixId)).toEqual(['relationship--targets']);
    });
  });

  // Note: a literal "delete the tenant row itself and assert children are gone" test isn't
  // exercised anywhere else in this suite either: several other tenant-scoped tables (e.g.
  // `groups`) reference `tenants` without a cascading FK, so a real full tenant deletion isn't
  // actually a supported operation in this codebase today. The `ON DELETE CASCADE` on
  // `opencti_connector_settings.tenant_id`/`opencti_stream_objects.tenant_id` is declared in
  // `module/src/modules/opencti-connector/schema.ts`.
});
