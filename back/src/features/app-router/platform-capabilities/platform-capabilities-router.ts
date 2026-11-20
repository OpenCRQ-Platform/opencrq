import { platformCapabilities } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { PlatformProcedure, PlatformSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { UserEffectivePermissionSchema } from '../effective-permission';

const PlatformCapabilitiesSchema = createSelectSchema(platformCapabilities);

export const platformCapabilitiesRouter = (authProcedure: PlatformProcedure, securityProcedure: PlatformSecurityProcedure) => router({
  // bounded-by: PLATFORM_CAPABILITIES, a code constant
  getPlatformCapabilities: authProcedure
    .output(z.array(PlatformCapabilitiesSchema.pick({ id: true, name: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .platformCapabilities.getPlatformCapabilities()),
  hasPlatformCapability: authProcedure
    .input(z.object({ capabilityId: z.uuid() }))
    .query(({ input: { capabilityId }, ctx: { origin, services } }) =>
      services.withOrigin(origin).platformCapabilities.hasPlatformCapability(capabilityId)),
  hasPlatformAccess: authProcedure
    .query(({ ctx: { origin, services } }) =>
      services.withOrigin(origin).platformCapabilities.hasPlatformAccess()),
  // bounded-by: one user's platform groups x their roles x PLATFORM_CAPABILITIES, one set for every tenant, plus PLATFORM_CAPABILITIES once for a super administrator
  getUserPlatformEffectivePermissions: securityProcedure
    .input(z.object({ userId: z.uuid() }))
    .output(z.array(UserEffectivePermissionSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .platformCapabilities.getUserPlatformEffectivePermissions(input.userId)),
});
