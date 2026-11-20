import { LastPlatformAdminError, platformRoles } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { PlatformSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { withConflictOn } from '../structured-error-conflict';

const PlatformRolesSchema = createSelectSchema(platformRoles).omit({ nameFolded: true });

const PlatformRoleListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  capabilityCount: z.number(),
});

export const platformRolesRouter = (securityProcedure: PlatformSecurityProcedure) => router({
  // bounded-by: the platform roles, one set for every tenant, which a user manager creates by hand
  getPlatformRoles: securityProcedure
    .output(z.array(PlatformRolesSchema.pick({ id: true, name: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .platformRoles.getPlatformRoles()),
  // bounded-by: the platform roles, one set for every tenant, which a user manager creates by hand
  listPlatformRoles: securityProcedure
    .output(z.array(PlatformRoleListRowSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .platformRoles.listPlatformRoles()),
  getPlatformRole: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .output(PlatformRolesSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .platformRoles.getPlatformRole(input.id) ?? null),
  createPlatformRole: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string() }))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformRoles.createPlatformRole(input)),
  // bounded-by: PLATFORM_CAPABILITIES, a code constant, each once
  getPlatformRoleCapabilities: securityProcedure
    .input(z.object({ platformRoleId: z.uuid() }))
    .output(z.array(z.object({ capability: z.object({ id: z.string() }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformRoles.getPlatformRoleCapabilities(input.platformRoleId)),
  addCapabilityToPlatformRole: securityProcedure
    .input(z.object({ platformRoleId: z.uuid(), capabilityId: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformRoles.addCapabilityToPlatformRole(input.platformRoleId, input.capabilityId)),
  removeCapabilityFromPlatformRole: securityProcedure
    .input(z.object({ platformRoleId: z.uuid(), capabilityId: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => withConflictOn(LastPlatformAdminError, () => services.withOrigin(origin)
      .platformRoles.removeCapabilityFromPlatformRole(input.platformRoleId, input.capabilityId))),
  updatePlatformRole: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string().min(1) }))
    .mutation(async ({ input: { id, ...values }, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformRoles.updatePlatformRole(id, values)),
  deletePlatformRole: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => withConflictOn(LastPlatformAdminError, () => services.withOrigin(origin)
      .platformRoles.deletePlatformRole(input.id))),
  // bounded-by: the platform roles, each once, which a user manager creates by hand
  getUserPlatformRoles: securityProcedure
    .input(z.object({ userId: z.uuid() }))
    .output(z.array(PlatformRolesSchema.pick({ id: true, name: true })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformRoles.getUserPlatformRoles(input.userId)),
});
