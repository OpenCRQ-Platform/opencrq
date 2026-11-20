import type { EventOrigin } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Notifications Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
  });

  const createNotif = (userId: string, overrides: Partial<{ type: string, title: string, message: string }> = {}) =>
    services.withOrigin({ type: 'auth' }).notifications.createNotification({
      userId,
      type: overrides.type ?? 'test',
      title: overrides.title ?? 'Test Notification',
      message: overrides.message ?? 'Test message',
    });

  describe('createNotification', () => {
    it('should create a notification and return its id', async () => {
      const id = await createNotif(adminUserId);
      expect(id).toBeTruthy();
    });

    it('should create a notification with a JSON data payload', async () => {
      const tenantId = 'some-tenant-id';
      const id = await services.withOrigin({ type: 'auth' }).notifications.createNotification({
        userId: adminUserId,
        type: 'member-added',
        title: 'Claire added you to Acme',
        message: 'You can now open Acme.',
        data: { tenantId },
      });

      const { items } = await services.withOrigin(adminOrigin).notifications.getNotifications();
      const notif = items.find((n) => n.id === id);
      expect(notif).toBeDefined();
      expect(notif!.data).toMatchObject({ tenantId });
    });
  });

  describe('getNotifications', () => {
    it('should return all notifications for the calling user', async () => {
      await createNotif(adminUserId);
      await createNotif(adminUserId);

      const result = await services.withOrigin(adminOrigin).notifications.getNotifications();
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should not return notifications belonging to another user', async () => {
      const otherUser = await createUser(db);
      await createNotif(otherUser.userId);

      const result = await services.withOrigin(adminOrigin).notifications.getNotifications();
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should filter by unreadOnly', async () => {
      const readId = await createNotif(adminUserId);
      await createNotif(adminUserId);

      await services.withOrigin(adminOrigin).notifications.markAsRead(readId);

      const result = await services.withOrigin(adminOrigin).notifications.getNotifications(0, 20, true);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0].read).toBe(false);
    });

    it('should paginate results and report hasMore', async () => {
      for (let i = 0; i < 5; i++) {
        await createNotif(adminUserId, { title: `Notif ${i}` });
      }

      const page1 = await services.withOrigin(adminOrigin).notifications.getNotifications(0, 3);
      expect(page1.items).toHaveLength(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.total).toBe(5);

      const page2 = await services.withOrigin(adminOrigin).notifications.getNotifications(3, 3);
      expect(page2.items).toHaveLength(2);
      expect(page2.hasMore).toBe(false);
    });
  });

  describe('getUnreadCount', () => {
    it('should return the count of unread notifications', async () => {
      await createNotif(adminUserId);
      await createNotif(adminUserId);

      const count = await services.withOrigin(adminOrigin).notifications.getUnreadCount();
      expect(count).toBe(2);
    });

    it('should not count read notifications', async () => {
      const id = await createNotif(adminUserId);
      await createNotif(adminUserId);
      await services.withOrigin(adminOrigin).notifications.markAsRead(id);

      const count = await services.withOrigin(adminOrigin).notifications.getUnreadCount();
      expect(count).toBe(1);
    });

    it('should not count notifications from another user', async () => {
      const otherUser = await createUser(db);
      await createNotif(otherUser.userId);

      const count = await services.withOrigin(adminOrigin).notifications.getUnreadCount();
      expect(count).toBe(0);
    });
  });

  describe('markAsRead', () => {
    it('should mark a single notification as read', async () => {
      const id = await createNotif(adminUserId);
      await createNotif(adminUserId);

      await services.withOrigin(adminOrigin).notifications.markAsRead(id);

      const count = await services.withOrigin(adminOrigin).notifications.getUnreadCount();
      expect(count).toBe(1);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all notifications of the calling user as read', async () => {
      await createNotif(adminUserId);
      await createNotif(adminUserId);

      await services.withOrigin(adminOrigin).notifications.markAllAsRead();

      const count = await services.withOrigin(adminOrigin).notifications.getUnreadCount();
      expect(count).toBe(0);
    });

    it('should not affect notifications of another user', async () => {
      const otherUser = await createUser(db);
      await createNotif(otherUser.userId);

      await services.withOrigin(adminOrigin).notifications.markAllAsRead();

      const otherOrigin: EventOrigin = { type: 'platform', userId: otherUser.userId };
      const count = await services.withOrigin(otherOrigin).notifications.getUnreadCount();
      expect(count).toBe(1);
    });
  });

  describe('markManyAsRead', () => {
    it('should mark only the specified notifications as read', async () => {
      const id1 = await createNotif(adminUserId);
      const id2 = await createNotif(adminUserId);
      await createNotif(adminUserId);

      await services.withOrigin(adminOrigin).notifications.markManyAsRead([id1, id2]);

      const count = await services.withOrigin(adminOrigin).notifications.getUnreadCount();
      expect(count).toBe(1);
    });

    it('should not mark notifications belonging to another user', async () => {
      const otherUser = await createUser(db);
      const otherId = await createNotif(otherUser.userId);

      await services.withOrigin(adminOrigin).notifications.markManyAsRead([otherId]);

      const otherOrigin: EventOrigin = { type: 'platform', userId: otherUser.userId };
      const count = await services.withOrigin(otherOrigin).notifications.getUnreadCount();
      expect(count).toBe(1);
    });
  });

  describe('markManyAsUnread', () => {
    it('should mark specified read notifications as unread', async () => {
      const id1 = await createNotif(adminUserId);
      await createNotif(adminUserId);

      await services.withOrigin(adminOrigin).notifications.markAllAsRead();
      await services.withOrigin(adminOrigin).notifications.markManyAsUnread([id1]);

      const count = await services.withOrigin(adminOrigin).notifications.getUnreadCount();
      expect(count).toBe(1);

      const { items } = await services.withOrigin(adminOrigin).notifications.getNotifications(0, 20, true);
      expect(items[0].id).toBe(id1);
    });

    it('should not affect notifications belonging to another user', async () => {
      const otherUser = await createUser(db);
      const otherId = await createNotif(otherUser.userId);

      // Mark other user's notification as read (as the owning user)
      const otherOrigin: EventOrigin = { type: 'platform', userId: otherUser.userId };
      await services.withOrigin(otherOrigin).notifications.markAsRead(otherId);

      // Admin tries to mark it unread
      await services.withOrigin(adminOrigin).notifications.markManyAsUnread([otherId]);

      // Other user's notification should remain read
      const count = await services.withOrigin(otherOrigin).notifications.getUnreadCount();
      expect(count).toBe(0);
    });
  });

  describe('deleteMany', () => {
    it('should delete only the specified notifications', async () => {
      const id1 = await createNotif(adminUserId);
      const id2 = await createNotif(adminUserId);
      await createNotif(adminUserId);

      await services.withOrigin(adminOrigin).notifications.deleteMany([id1, id2]);

      const result = await services.withOrigin(adminOrigin).notifications.getNotifications();
      expect(result.total).toBe(1);
    });

    it('should not delete notifications belonging to another user', async () => {
      const otherUser = await createUser(db);
      const otherId = await createNotif(otherUser.userId);

      await services.withOrigin(adminOrigin).notifications.deleteMany([otherId]);

      const otherOrigin: EventOrigin = { type: 'platform', userId: otherUser.userId };
      const result = await services.withOrigin(otherOrigin).notifications.getNotifications();
      expect(result.total).toBe(1);
    });
  });
});
