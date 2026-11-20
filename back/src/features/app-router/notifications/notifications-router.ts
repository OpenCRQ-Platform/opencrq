import { z } from 'zod';
import type { PlatformProcedure } from '../app-router-router';
import { router } from '../../../trpc';

export const notificationsRouter = (authProcedure: PlatformProcedure) => router({
  getNotifications: authProcedure
    .input(z.object({
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
      unreadOnly: z.boolean().default(false),
    }).default({ offset: 0, limit: 20, unreadOnly: false }))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .notifications.getNotifications(input.offset, input.limit, input.unreadOnly)),
  getUnreadCount: authProcedure
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .notifications.getUnreadCount()),
  markAllAsRead: authProcedure
    .mutation(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .notifications.markAllAsRead()),
  markManyAsRead: authProcedure
    .input(z.object({ ids: z.array(z.uuid()) }))
    .mutation(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .notifications.markManyAsRead(input.ids)),
  markManyAsUnread: authProcedure
    .input(z.object({ ids: z.array(z.uuid()) }))
    .mutation(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .notifications.markManyAsUnread(input.ids)),
  deleteMany: authProcedure
    .input(z.object({ ids: z.array(z.uuid()) }))
    .mutation(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .notifications.deleteMany(input.ids)),
});
