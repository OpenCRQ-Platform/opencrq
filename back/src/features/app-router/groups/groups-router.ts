import { groups } from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const GroupsSchema = createSelectSchema(groups).omit({ nameFolded: true });

const GroupListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number(),
  serviceAccountCount: z.number(),
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const groupsRouter = (securityProcedure: TenantSecurityProcedure) => router({
  // bounded-by: the tenant's groups, which a security manager creates by hand
  getGroups: securityProcedure
    .output(z.array(GroupsSchema.pick({ id: true, name: true, slug: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .groups.getGroups()),
  // bounded-by: the tenant's groups, which a security manager creates by hand, each with at most the tenant's roles
  listGroups: securityProcedure
    .output(z.array(GroupListRowSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .groups.listGroups()),
  getGroup: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .output(GroupsSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .groups.getGroup(input.id) ?? null),
  createGroup: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .groups.createGroup(input);
    }),
  // bounded-by: the tenant's roles, each once, which a security manager creates by hand
  getGroupRoles: securityProcedure
    .input(z.object({ groupId: z.uuid() }))
    // XTM One's group tool prints the role names.
    .output(z.array(z.object({ role: z.object({ id: z.string(), name: z.string() }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .groups.getGroupRoles(input.groupId)),
  addRoleToGroup: securityProcedure
    .input(z.object({ groupId: z.uuid(), roleId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .groups.addRoleToGroup(input.groupId, input.roleId);
    }),
  removeRoleFromGroup: securityProcedure
    .input(z.object({ groupId: z.uuid(), roleId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .groups.removeRoleFromGroup(input.groupId, input.roleId);
    }),
  // bounded-by: the tenant's groups, each once, which a security manager creates by hand
  getUserGroups: securityProcedure
    .input(z.object({ userId: z.uuid() }))
    .output(z.array(z.object({ group: GroupsSchema.pick({ id: true, name: true }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .groups.getUserGroups(input.userId)),
  addUserToGroup: securityProcedure
    .input(z.object({ groupId: z.uuid(), userId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin, tenantId } }) => {
      const scoped = services.withOrigin(origin);
      // A group holds members only, and a super administrator reaches the tenant without being one.
      if (!(await scoped.tenants.isTenantUser(tenantId, input.userId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'This user is not a member of the tenant' });
      }
      await scoped.groups.addUserToGroup(input.groupId, input.userId);
    }),
  removeUserFromGroup: securityProcedure
    .input(z.object({ groupId: z.uuid(), userId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .groups.removeUserFromGroup(input.groupId, input.userId);
    }),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the group's members, invited one by one into the tenant
  getGroupUsers: securityProcedure
    .input(z.object({ groupId: z.uuid() }))
    // XTM One's group tool prints each member's name and email.
    .output(z.array(z.object({ user: z.object({ id: z.string(), email: z.string(), name: z.string().nullable() }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .groups.getGroupUsers(input.groupId)),
  updateGroup: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string().min(1) }))
    .output(z.void())
    .mutation(async ({ input: { id, ...values }, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .groups.updateGroup(id, values);
    }),
  deleteGroup: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .groups.deleteGroup(input.id);
    }),
});
