import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('opencti stream controls', () => {
  let tenantId: string;
  let adminId: string;
  let adminOrigin: EventOrigin;

  const configure = async (origin: EventOrigin, tenant: string, streamId: string) => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(origin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: `Bot ${streamId}`,
    });
    await services.withOrigin(origin).openctiConnector.configure(tenant, serviceAccountId, streamId);
    return serviceAccountId;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    adminId = setup.userId;
    adminOrigin = setup.origin;
  });

  const connector = () => services.withOrigin(adminOrigin).openctiConnector;
  const settings = () => connector().getSettings(tenantId);
  const generation = async () => (await settings())?.streamGeneration ?? 0;

  describe('reconnect', () => {
    it('drops the position and the anchors, and latches the live tail', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().updateCursor(tenantId, '1620249512318-0', new Date('2026-06-01T00:00:00Z'), null, 40, 0);
      expect((await settings())?.cursor).not.toBeNull();

      await connector().reconnectAtLiveTail(tenantId);

      const after = await settings();
      expect(after?.cursor).toBeNull();
      expect(after?.historyStartAt).toBeNull();
      expect(after?.backfillTargetAt).toBeNull();
      expect(after?.reachedLiveTailAt).not.toBeNull();
    });

    it('leaves the stream, the service account and the switch alone', async () => {
      const serviceAccountId = await configure(adminOrigin, tenantId, 'live-stream-1');

      await connector().reconnectAtLiveTail(tenantId);

      const after = await settings();
      expect(after?.streamId).toBe('live-stream-1');
      expect(after?.serviceAccountId).toBe(serviceAccountId);
      expect(after?.enabled).toBe(true);
    });

    it('keeps the moment the live tail was first reached, the latch being one-way', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      const firstReach = new Date('2026-06-01T00:00:00Z');
      await connector().updateCursor(tenantId, '1', new Date(), firstReach, 0, 0);
      const latched = (await settings())?.reachedLiveTailAt;

      await connector().reconnectAtLiveTail(tenantId);

      expect((await settings())?.reachedLiveTailAt).toEqual(latched);
    });
  });

  describe('the backfill anchors', () => {
    it('are not rebuilt by the flush that follows a reconnect, the stream being already at the edge', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().updateCursor(tenantId, '1', new Date('2026-06-01T00:00:00Z'), null, 40, 0);
      await connector().reconnectAtLiveTail(tenantId);

      await connector().updateCursor(tenantId, '2', new Date('2026-06-02T00:00:00Z'), null, 1, await generation());

      const after = await settings();
      expect(after?.historyStartAt).toBeNull();
      expect(after?.backfillTargetAt).toBeNull();
    });

    it('survive the flushes that follow a backfill it actually ran', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().updateCursor(tenantId, '1', new Date('2026-06-01T00:00:00Z'), null, 1, 0);
      const anchored = await settings();
      expect(anchored?.historyStartAt).not.toBeNull();
      await connector().updateCursor(tenantId, '2', new Date('2026-06-02T00:00:00Z'), new Date(), 1, 0);

      await connector().updateCursor(tenantId, '3', new Date('2026-06-03T00:00:00Z'), null, 1, 0);

      const after = await settings();
      expect(after?.historyStartAt).toEqual(anchored?.historyStartAt);
      expect(after?.backfillTargetAt).toEqual(anchored?.backfillTargetAt);
    });
  });

  describe('objects read', () => {
    it('adds each flush to the running total and stamps when it moved', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');

      await connector().updateCursor(tenantId, '1', new Date(), null, 500, 0);
      await connector().updateCursor(tenantId, '2', new Date(), null, 320, 0);

      const after = await settings();
      expect(after?.objectsRead).toBe(820);
      expect(after?.objectsReadAt).not.toBeNull();
    });

    it('leaves the instant alone on a flush that carried no object, so an idle stream does not read as progress', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().updateCursor(tenantId, '1', new Date(), null, 500, 0);
      const stampedAt = (await settings())?.objectsReadAt;

      await connector().updateCursor(tenantId, '2', new Date(), null, 0, 0);

      const after = await settings();
      expect(after?.objectsRead).toBe(500);
      expect(after?.objectsReadAt).toEqual(stampedAt);
    });

    it('is zeroed by a reset, which starts the stream again from its origin', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().updateCursor(tenantId, '1', new Date(), null, 500, 0);

      await connector().resetStreamState(tenantId);

      const after = await settings();
      expect(after?.objectsRead).toBe(0);
      expect(after?.objectsReadAt).toBeNull();
    });

    it('is zeroed by a reconfigure, the totals belonging to the stream that produced them', async () => {
      const serviceAccountId = await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().updateCursor(tenantId, '1', new Date(), null, 500, await generation());

      await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, serviceAccountId, 'live-stream-2');

      const after = await settings();
      expect(after?.objectsRead).toBe(0);
      expect(after?.objectsReadAt).toBeNull();
    });

    it('survives a reconnect, which carries on reading the same stream', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().updateCursor(tenantId, '1', new Date(), null, 500, 0);

      await connector().reconnectAtLiveTail(tenantId);

      const after = await settings();
      expect(after?.objectsRead).toBe(500);
      expect(after?.objectsReadAt).not.toBeNull();
    });
  });

  describe('reset', () => {
    it('clears everything the consumer resumes from', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().updateCursor(tenantId, '1', new Date(), new Date(), 12, 0);

      await connector().resetStreamState(tenantId);

      const after = await settings();
      expect(after?.cursor).toBeNull();
      expect(after?.lastEventAt).toBeNull();
      expect(after?.historyStartAt).toBeNull();
      expect(after?.backfillTargetAt).toBeNull();
      expect(after?.reachedLiveTailAt).toBeNull();
    });

    it('removes nothing it already imported', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().upsertStreamObject(tenantId, 'intrusion-set--1', 'intrusion-set', { id: 'intrusion-set--1' });

      await connector().resetStreamState(tenantId);

      expect(await connector().countStreamObjects(tenantId)).toBe(1);
    });

    it('is harmless on a stream that has never received an event', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');

      await connector().resetStreamState(tenantId);

      expect((await settings())?.streamId).toBe('live-stream-1');
    });
  });

  describe('the generation guard', () => {
    it('refuses a position written under a generation a reconnect has moved past', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      const stale = await generation();
      await connector().updateCursor(tenantId, 'before', new Date('2026-06-01T00:00:00Z'), null, 40, stale);

      await connector().reconnectAtLiveTail(tenantId);
      // What the retired consumer's final flush would write on its way out.
      await connector().updateCursor(tenantId, 'after', new Date('2026-06-01T00:00:00Z'), null, 7, stale);

      const after = await settings();
      expect(after?.cursor).toBeNull();
      expect(after?.historyStartAt).toBeNull();
      expect(after?.objectsRead).toBe(40);
    });

    it('refuses a position written under a generation a reset has moved past', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      const stale = await generation();
      await connector().updateCursor(tenantId, 'before', new Date(), null, 40, stale);

      await connector().resetStreamState(tenantId);
      await connector().updateCursor(tenantId, 'after', new Date(), null, 7, stale);

      const after = await settings();
      expect(after?.cursor).toBeNull();
      expect(after?.lastEventAt).toBeNull();
      expect(after?.objectsRead).toBe(0);
    });

    it('takes a position written under the generation the consumer actually started on', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      await connector().reconnectAtLiveTail(tenantId);

      await connector().updateCursor(tenantId, 'fresh', new Date(), null, 12, await generation());

      expect((await settings())?.cursor).toBe('fresh');
    });
  });

  describe('the bound service account', () => {
    it('reads as active for a member who cannot read service accounts at all', async () => {
      const serviceAccountId = await configure(adminOrigin, tenantId, 'live-stream-1');
      const member = await createUser(db);
      await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, member.userId);
      const memberOrigin: EventOrigin = { type: 'client', userId: member.userId, tenantId };

      // The secured view answers nothing without MANAGE_SECURITY, and reading that silence as a
      // deactivated account would show every member a stopped stream.
      expect(await services.withOrigin(memberOrigin).serviceAccounts.getServiceAccount(serviceAccountId)).toBeUndefined();
      expect(await services.withOrigin(memberOrigin).openctiConnector.isBoundServiceAccountActive(tenantId)).toBe(true);
    });

    it('reads as inactive once the account is deactivated', async () => {
      const serviceAccountId = await configure(adminOrigin, tenantId, 'live-stream-1');

      await services.withOrigin(adminOrigin).serviceAccounts.updateServiceAccount(serviceAccountId, { active: false });

      expect(await connector().isBoundServiceAccountActive(tenantId)).toBe(false);
    });

    it('reads as inactive for a tenant whose stream is not bound', async () => {
      expect(await connector().isBoundServiceAccountActive(tenantId)).toBe(false);
    });

    it('answers for the tenant asked about, never for another', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      const otherTenantId = await createTenant(services, adminId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminId, tenantId: otherTenantId };
      const otherServiceAccountId = await configure(otherOrigin, otherTenantId, 'live-stream-2');
      await services.withOrigin(otherOrigin).serviceAccounts.updateServiceAccount(otherServiceAccountId, { active: false });

      expect(await connector().isBoundServiceAccountActive(tenantId)).toBe(true);
      expect(await connector().isBoundServiceAccountActive(otherTenantId)).toBe(false);
    });
  });

  describe('tenant isolation', () => {
    // The initial admin account is a singleton per truncated database, so a second tenant is added
    // under the same administrator rather than through another `createTenantWithAdmin`.
    const otherTenant = async () => {
      const otherTenantId = await createTenant(services, adminId);
      const origin: EventOrigin = { type: 'client', userId: adminId, tenantId: otherTenantId };
      await configure(origin, otherTenantId, 'live-stream-2');
      return { otherTenantId, origin };
    };

    it('is denied outright on another tenant\'s row', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      const { otherTenantId, origin } = await otherTenant();
      await services.withOrigin(origin).openctiConnector.updateCursor(otherTenantId, '9', new Date(), new Date(), 3, 0);

      await connector().reconnectAtLiveTail(otherTenantId);
      await connector().resetStreamState(otherTenantId);

      const theirs = await services.withOrigin(origin).openctiConnector.getSettings(otherTenantId);
      expect(theirs?.cursor).toBe('9');
      expect(theirs?.reachedLiveTailAt).not.toBeNull();
      expect(theirs?.objectsRead).toBe(3);
    });

    it('leaves another tenant\'s stream untouched', async () => {
      await configure(adminOrigin, tenantId, 'live-stream-1');
      const { otherTenantId, origin } = await otherTenant();
      await services.withOrigin(origin).openctiConnector.updateCursor(otherTenantId, '9', new Date(), new Date(), 0, 0);

      await connector().reconnectAtLiveTail(tenantId);
      await connector().resetStreamState(tenantId);

      const theirs = await services.withOrigin(origin).openctiConnector.getSettings(otherTenantId);
      expect(theirs?.cursor).toBe('9');
      expect(theirs?.reachedLiveTailAt).not.toBeNull();
    });

    it('reads nothing when asking for another tenant\'s row', async () => {
      const { otherTenantId } = await otherTenant();

      expect(await connector().getSettings(otherTenantId)).toBeNull();
    });
  });
});
