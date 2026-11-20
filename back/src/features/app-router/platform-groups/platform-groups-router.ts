import { LastPlatformAdminError, platformGroups } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { PlatformSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { withConflictOn } from '../structured-error-conflict';

const PlatformGroupsSchema = createSelectSchema(platformGroups).omit({ nameFolded: true });

const PlatformGroupListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number(),
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const platformGroupsRouter = (securityProcedure: PlatformSecurityProcedure) => router({
  // bounded-by: the platform groups, one set for every tenant, which a user manager creates by hand
  getPlatformGroups: securityProcedure
    .output(z.array(PlatformGroupsSchema.pick({ id: true, name: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .platformGroups.getPlatformGroups()),
  // bounded-by: the platform groups, one set for every tenant, which a user manager creates by hand, each with at most the platform roles
  listPlatformGroups: securityProcedure
    .output(z.array(PlatformGroupListRowSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .platformGroups.listPlatformGroups()),
  getPlatformGroup: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .output(PlatformGroupsSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .platformGroups.getPlatformGroup(input.id) ?? null),
  createPlatformGroup: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string() }))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformGroups.createPlatformGroup(input)),
  // bounded-by: the platform roles, each once, which a user manager creates by hand
  getPlatformGroupRoles: securityProcedure
    .input(z.object({ platformGroupId: z.uuid() }))
    .output(z.array(z.object({ role: z.object({ id: z.string() }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformGroups.getPlatformGroupRoles(input.platformGroupId)),
  addRoleToPlatformGroup: securityProcedure
    .input(z.object({ platformGroupId: z.uuid(), platformRoleId: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformGroups.addRoleToPlatformGroup(input.platformGroupId, input.platformRoleId)),
  removeRoleFromPlatformGroup: securityProcedure
    .input(z.object({ platformGroupId: z.uuid(), platformRoleId: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => withConflictOn(LastPlatformAdminError, () => services.withOrigin(origin)
      .platformGroups.removeRoleFromPlatformGroup(input.platformGroupId, input.platformRoleId))),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the deployment's users added to the platform group
  getPlatformGroupUsers: securityProcedure
    .input(z.object({ platformGroupId: z.uuid() }))
    .output(z.array(z.object({ user: z.object({ id: z.string() }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformGroups.getPlatformGroupUsers(input.platformGroupId)),
  addUserToPlatformGroup: securityProcedure
    .input(z.object({ platformGroupId: z.uuid(), userId: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformGroups.addUserToPlatformGroup(input.platformGroupId, input.userId)),
  removeUserFromPlatformGroup: securityProcedure
    .input(z.object({ platformGroupId: z.uuid(), userId: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => withConflictOn(LastPlatformAdminError, () => services.withOrigin(origin)
      .platformGroups.removeUserFromPlatformGroup(input.platformGroupId, input.userId))),
  // bounded-by: the platform groups, each once, which a user manager creates by hand
  getUserPlatformGroups: securityProcedure
    .input(z.object({ userId: z.uuid() }))
    .output(z.array(z.object({ group: PlatformGroupsSchema.pick({ id: true, name: true }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformGroups.getUserPlatformGroups(input.userId)),
  updatePlatformGroup: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string().min(1) }))
    .mutation(async ({ input: { id, ...values }, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformGroups.updatePlatformGroup(id, values)),
  deletePlatformGroup: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => withConflictOn(LastPlatformAdminError, () => services.withOrigin(origin)
      .platformGroups.deletePlatformGroup(input.id))),
});
