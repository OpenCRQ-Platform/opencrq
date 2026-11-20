import { z } from 'zod';

/** One row per capability and grant: a group's role, or XTM One's super administrator status. */
export const UserEffectivePermissionSchema = z.discriminatedUnion('grantedBy', [
  z.object({
    grantedBy: z.literal('group'),
    capabilityId: z.string(),
    capabilityName: z.string(),
    roleId: z.string(),
    roleName: z.string(),
    groupId: z.string(),
    groupName: z.string(),
  }),
  z.object({
    grantedBy: z.literal('super_administrator'),
    capabilityId: z.string(),
    capabilityName: z.string(),
    roleId: z.null(),
    roleName: z.null(),
    groupId: z.null(),
    groupName: z.null(),
  }),
]);
