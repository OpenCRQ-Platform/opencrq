import { roles } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const RolesSchema = createSelectSchema(roles).omit({ nameFolded: true });

const RoleListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  capabilityCount: z.number(),
});

export const rolesRouter = (securityProcedure: TenantSecurityProcedure) => router({
  // bounded-by: the tenant's roles, which a security manager creates by hand
  getRoles: securityProcedure
    .output(z.array(RolesSchema.pick({ id: true, name: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .roles.getRoles()),
  // bounded-by: the tenant's roles, which a security manager creates by hand
  listRoles: securityProcedure
    .output(z.array(RoleListRowSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .roles.listRoles()),
  getRole: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .output(RolesSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .roles.getRole(input.id) ?? null),
  createRole: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .roles.createRole(input);
    }),
  // bounded-by: CAPABILITIES, a code constant, each once
  getRoleCapabilities: securityProcedure
    .input(z.object({ roleId: z.uuid() }))
    // XTM One's role tool prints the capability names.
    .output(z.array(z.object({ capability: z.object({ id: z.string(), name: z.string() }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .roles.getRoleCapabilities(input.roleId)),
  addCapabilityToRole: securityProcedure
    .input(z.object({ roleId: z.uuid(), capabilityId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .roles.addCapabilityToRole(input.roleId, input.capabilityId);
    }),
  removeCapabilityFromRole: securityProcedure
    .input(z.object({ roleId: z.uuid(), capabilityId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .roles.removeCapabilityFromRole(input.roleId, input.capabilityId);
    }),
  // bounded-by: the tenant's roles, each once, which a security manager creates by hand
  getUserRoles: securityProcedure
    .input(z.object({ userId: z.uuid() }))
    .output(z.array(RolesSchema.pick({ id: true, name: true })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .roles.getUserRoles(input.userId)),
  updateRole: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string().min(1) }))
    .output(z.void())
    .mutation(async ({ input: { id, ...values }, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .roles.updateRole(id, values);
    }),
  deleteRole: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .roles.deleteRole(input.id);
    }),
  // bounded-by: the tenant's groups, each once, which a security manager creates by hand
  getRoleGroups: securityProcedure
    .input(z.object({ roleId: z.uuid() }))
    .output(z.array(z.object({ group: z.object({ id: z.string(), name: z.string() }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .roles.getRoleGroups(input.roleId)),
});
