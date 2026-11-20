import { uuidv7 } from 'uuidv7';
import { originUserId } from '../../security';
import { defineService } from '../../registry';
import { notificationsRepository } from './repository';

interface CreateNotificationInput {
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: unknown,
}

const DEFAULT_PAGE_SIZE = 20;

export const notificationsService = defineService(
  'notifications',
  notificationsRepository,
).implement({
  getNotifications: async ({ repo }, offset = 0, limit = DEFAULT_PAGE_SIZE, unreadOnly = false) => {
    const [items, total] = await Promise.all([
      repo.findAll(offset, limit + 1, unreadOnly),
      repo.countAll(unreadOnly),
    ]);
    const hasMore = items.length > limit;
    return {
      items: hasMore ? items.slice(0, limit) : items,
      total,
      hasMore,
    };
  },

  getUnreadCount: async ({ repo }) =>
    repo.countUnread(),

  createNotification: async ({ repo }, input: CreateNotificationInput) => {
    const id = uuidv7();
    await repo.create({ id, ...input });
    return id;
  },

  markAsRead: async ({ repo }, notificationId: string) => {
    await repo.markAsRead(notificationId);
  },

  markAllAsRead: async ({ repo, eventOrigin }) => {
    const userId = originUserId(eventOrigin);
    if (!userId) {
      return;
    }
    await repo.markAllAsRead(userId);
  },

  markManyAsRead: async ({ repo, eventOrigin }, ids: Array<string>) => {
    const userId = originUserId(eventOrigin);
    if (!userId) {
      return;
    }
    await repo.markManyAsRead(userId, ids);
  },

  markManyAsUnread: async ({ repo, eventOrigin }, ids: Array<string>) => {
    const userId = originUserId(eventOrigin);
    if (!userId) {
      return;
    }
    await repo.markManyAsUnread(userId, ids);
  },

  deleteMany: async ({ repo, eventOrigin }, ids: Array<string>) => {
    const userId = originUserId(eventOrigin);
    if (!userId) {
      return;
    }
    await repo.deleteMany(userId, ids);
  },
});
