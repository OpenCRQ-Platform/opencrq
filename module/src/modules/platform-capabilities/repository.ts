import { withTransactionLock } from '@app/utils';
import { and, eq } from 'drizzle-orm';
import type { RepositoryContext } from '../../registry';
import { defineRepository } from '../../registry';
import { platformCapabilityHeld, userIsSuperAdmin } from '../../security/policies';

/**
 * The `platformGroupUsers → platformGroupRoles → platformRoleCapabilities` join every "who holds
 * capability X" check is built on.
 */
const platformCapabilityHolders = ({ db, views }: RepositoryContext) => db.select({
  userId: views.platformGroupUsers.userId,
  capabilityId: views.platformRoleCapabilities.capabilityId,
})
  .from(views.platformGroupUsers)
  .innerJoin(views.platformGroupRoles, eq(views.platformGroupUsers.platformGroupId, views.platformGroupRoles.platformGroupId))
  .innerJoin(views.platformRoleCapabilities, eq(views.platformGroupRoles.platformRoleId, views.platformRoleCapabilities.platformRoleId));

export const platformCapabilitiesRepository = defineRepository({
  findAllPlatformCapabilities: ({ db, views }) => db.select().from(views.platformCapabilities),

  hasPlatformCapability: async ({ db, views }, userId: string, capabilityId: string) => {
    const result = await db.select({ id: views.platformCapabilities.id })
      .from(views.platformCapabilities)
      .where(and(eq(views.platformCapabilities.id, capabilityId), platformCapabilityHeld(userId, capabilityId)))
      .limit(1);

    return result.length > 0;
  },

  findUserPlatformCapabilities: async ({ db, views }, userId: string) => db.select({
    capability: { id: views.platformCapabilities.id, name: views.platformCapabilities.name },
  })
    .from(views.platformCapabilities)
    .where(platformCapabilityHeld(userId, views.platformCapabilities.id)),

  findSuperAdministratorPlatformCapabilities: async ({ db, views }, userId: string) => db.select({
    capabilityId: views.platformCapabilities.id,
    capabilityName: views.platformCapabilities.name,
  })
    .from(views.platformCapabilities)
    .where(userIsSuperAdmin(userId)),

  findUserPlatformEffectivePermissions: async ({ db, views }, userId: string) => db.select({
    capabilityId: views.platformCapabilities.id,
    capabilityName: views.platformCapabilities.name,
    roleId: views.platformRoles.id,
    roleName: views.platformRoles.name,
    groupId: views.platformGroups.id,
    groupName: views.platformGroups.name,
  })
    .from(views.platformGroupUsers)
    .innerJoin(views.platformGroups, eq(views.platformGroupUsers.platformGroupId, views.platformGroups.id))
    .innerJoin(views.platformGroupRoles, eq(views.platformGroupUsers.platformGroupId, views.platformGroupRoles.platformGroupId))
    .innerJoin(views.platformRoles, eq(views.platformGroupRoles.platformRoleId, views.platformRoles.id))
    .innerJoin(views.platformRoleCapabilities, eq(views.platformGroupRoles.platformRoleId, views.platformRoleCapabilities.platformRoleId))
    .innerJoin(views.platformCapabilities, eq(views.platformRoleCapabilities.capabilityId, views.platformCapabilities.id))
    .where(eq(views.platformGroupUsers.userId, userId)),

  platformCapabilityHasHolder: async (ctx, capabilityId: string) => {
    const result = await platformCapabilityHolders(ctx)
      .where(eq(ctx.views.platformRoleCapabilities.capabilityId, capabilityId))
      .limit(1);

    return result.length > 0;
  },

  /**
   * Serializes the platform reachability invariant. The callback is empty because only the lock is
   * wanted: it is transaction-scoped, so it keeps holding for the caller's transaction after this
   * returns, and concurrent removals of two distinct holders can no longer each see the other's.
   */
  lockPlatformCapabilityHolders: async ({ rawDb }) => {
    // eslint-disable-next-line no-restricted-syntax -- advisory lock only, no read or write goes through the raw handle
    await withTransactionLock(rawDb(), 'platform_capability_holders', () => Promise.resolve());
  },
});
