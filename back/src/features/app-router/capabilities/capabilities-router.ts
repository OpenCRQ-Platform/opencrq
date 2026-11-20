import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { UserEffectivePermissionSchema } from '../effective-permission';

export const capabilitiesRouter = (authProcedure: TenantProcedure) => router({
  // bounded-by: CAPABILITIES, the tenant capability catalogue, one platform-wide copy
  getCapabilities: authProcedure
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .capabilities.getCapabilities()),
  hasManageSecurity: authProcedure
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .capabilities.hasManageSecurity()),
  // bounded-by: one user's groups x their roles x CAPABILITIES, all but the catalogue created by hand, plus CAPABILITIES once for a super administrator
  getUserEffectivePermissions: authProcedure
    .input(z.object({ userId: z.uuid() }))
    .output(z.array(UserEffectivePermissionSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .capabilities.getUserEffectivePermissions(input.userId)),
  // bounded-by: one service account's groups x their roles x CAPABILITIES, all but the catalogue created by hand
  getServiceAccountEffectivePermissions: authProcedure
    .input(z.object({ serviceAccountId: z.uuid() }))
    .output(z.array(z.object({
      capabilityId: z.string(),
      capabilityName: z.string(),
      roleId: z.string(),
      roleName: z.string(),
      groupId: z.string(),
      groupName: z.string(),
    })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .capabilities.getServiceAccountEffectivePermissions(input.serviceAccountId)),
});
