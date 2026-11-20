import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { notifications } from './schema';

export const notificationsRepository = defineRepository({
  findAll: ({ db, views }, offset: number, limit: number, unreadOnly: boolean) => {
    const query = db.select().from(views.notifications);
    const filtered = unreadOnly
      ? query.where(eq(views.notifications.read, false))
      : query;
    return filtered
      .orderBy(desc(views.notifications.createdAt))
      .offset(offset)
      .limit(limit);
  },

  countAll: async ({ db, views }, unreadOnly: boolean) => {
    const query = db.select({ count: count() }).from(views.notifications);
    const filtered = unreadOnly
      ? query.where(eq(views.notifications.read, false))
      : query;
    const result = await filtered;
    return result[0]?.count ?? 0;
  },

  countUnread: async ({ db, views }) => {
    const result = await db.select({ count: count() })
      .from(views.notifications)
      .where(eq(views.notifications.read, false));
    return result[0]?.count ?? 0;
  },

  create: ({ db }, notification: typeof notifications.$inferInsert) =>
    db.insert(notifications).values([notification]),

  markAsRead: ({ db }, id: string) =>
    db.update(notifications).set({ read: true }).where(eq(notifications.id, id)),

  markAllAsRead: ({ db }, userId: string) =>
    db.update(notifications).set({ read: true }).where(and(eq(notifications.userId, userId), eq(notifications.read, false))),

  markManyAsRead: ({ db }, userId: string, ids: Array<string>) =>
    db.update(notifications).set({ read: true }).where(and(eq(notifications.userId, userId), inArray(notifications.id, ids))),

  markManyAsUnread: ({ db }, userId: string, ids: Array<string>) =>
    db.update(notifications).set({ read: false }).where(and(eq(notifications.userId, userId), inArray(notifications.id, ids))),

  deleteMany: ({ db }, userId: string, ids: Array<string>) =>
    db.delete(notifications).where(and(eq(notifications.userId, userId), inArray(notifications.id, ids))),
});
