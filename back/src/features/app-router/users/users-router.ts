import { dashboardIdSchema, originUserId, supportedLocaleSchema, users } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { PlatformProcedure, PlatformSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const UsersSchema = createSelectSchema(users).omit({
  passwordHash: true,
  xtmSubject: true,
  lastSignedInAt: true,
});

const NamedRefSchema = z.object({ id: z.string(), name: z.string() });

const PlatformUserListRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  title: z.string().nullable(),
  isSuperAdmin: z.boolean(),
  platformGroups: z.array(NamedRefSchema),
  platformRoles: z.array(NamedRefSchema),
  tenants: z.array(NamedRefSchema),
});

// One's own row is read off the tenant, whose rule shows its members only: the super administrator
// belongs to none, and widening that rule would list him in every tenant.
const ownRowReader = (userId: string) => ({ type: 'platform' as const, userId });

export const usersRouter = (authProcedure: PlatformProcedure, securityProcedure: PlatformSecurityProcedure) => router({
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the invited users, every tenant for a user manager
  getUsers: authProcedure
    // XTM One's user tool prints the title.
    .output(z.array(UsersSchema.pick({ id: true, email: true, name: true, title: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .users.getUsers()),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the invited users of every tenant
  listPlatformUsers: securityProcedure
    .output(z.array(PlatformUserListRowSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .users.listPlatformUsers()),
  getUser: authProcedure
    .input(z.object({ id: z.uuid() }))
    .output(UsersSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const userId = originUserId(origin);
      const reader = userId === input.id ? ownRowReader(userId) : origin;
      return await services.withOrigin(reader).users.getUser(input.id) ?? null;
    }),
  getUserTheme: authProcedure
    .output(z.enum(['light', 'dark', 'system']).nullable())
    .query(async ({ ctx: { services, origin } }) => {
      const userId = originUserId(origin);
      if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return await services.withOrigin(ownRowReader(userId)).users.getUserTheme(userId) ?? null;
    }),
  getUserLocale: authProcedure
    .output(z.string().nullable())
    .query(async ({ ctx: { services, origin } }) => {
      const userId = originUserId(origin);
      if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return await services.withOrigin(ownRowReader(userId)).users.getUserLocale(userId) ?? null;
    }),
  getUserHomeDashboard: authProcedure
    .output(z.string().nullable())
    .query(async ({ ctx: { services, origin } }) => {
      const userId = originUserId(origin);
      if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return await services.withOrigin(ownRowReader(userId)).users.getUserHomeDashboard(userId) ?? null;
    }),
  // Full name, title and email come from XTM One at each sign-in: only the preferences are written here.
  updateUser: authProcedure
    .input(z.object({ locale: supportedLocaleSchema.nullable().optional(), theme: z.enum(['light', 'dark', 'system']).optional(), homeDashboardId: dashboardIdSchema.nullable().optional() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const userId = originUserId(origin);
      if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return services.withOrigin(origin)
        .users.updateUser(userId, { locale: input.locale, theme: input.theme, homeDashboardId: input.homeDashboardId });
    }),
});
