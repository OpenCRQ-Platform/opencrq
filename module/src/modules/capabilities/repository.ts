import { and, eq, exists, or } from 'drizzle-orm';
import type { EventOrigin } from '../../security/policy';
import { defineRepository } from '../../registry';
import { capabilityHeldInTenant, groupBelongsToTenant, userIsSuperAdmin } from '../../security/policies';
import { groupRoles, groupUsers, roleCapabilities } from '../schema';
import { capabilities } from './schema';

export const capabilitiesRepository = defineRepository({
  findAllCapabilities: ({ db }) => db.select().from(capabilities),

  hasCapability: async ({ db }, origin: Extract<EventOrigin, { type: 'client' | 'connector' }>, capabilityId: string) => {
    const result = await db.select({ id: capabilities.id })
      .from(capabilities)
      .where(capabilityHeldInTenant(origin, capabilityId))
      .limit(1);

    return result.length > 0;
  },

  // The same two ways `capabilityHeldInTenant` grants a capability: the super administrator, or a group of the tenant.
  findUserCapabilities: async ({ db }, tenantId: string, userId: string) => db.select({
    id: capabilities.id,
    name: capabilities.name,
  })
    .from(capabilities)
    .where(or(
      userIsSuperAdmin(userId),
      exists(db.select({ roleId: roleCapabilities.roleId })
        .from(groupUsers)
        .innerJoin(groupRoles, eq(groupUsers.groupId, groupRoles.groupId))
        .innerJoin(roleCapabilities, eq(groupRoles.roleId, roleCapabilities.roleId))
        .where(and(
          eq(groupUsers.userId, userId),
          eq(roleCapabilities.capabilityId, capabilities.id),
          groupBelongsToTenant(groupUsers.groupId, tenantId),
        ))),
    )),

  findSuperAdministratorCapabilities: async ({ db }, userId: string) => db.select({
    capabilityId: capabilities.id,
    capabilityName: capabilities.name,
  })
    .from(capabilities)
    .where(userIsSuperAdmin(userId)),

  findEffectivePermissions: async ({ db, views }, actor: { userId: string } | { serviceAccountId: string }) => {
    const baseQuery = db.select({
      capabilityId: capabilities.id,
      capabilityName: capabilities.name,
      roleId: views.roles.id,
      roleName: views.roles.name,
      groupId: views.groups.id,
      groupName: views.groups.name,
    })
      .from(groupRoles)
      .innerJoin(views.roles, eq(groupRoles.roleId, views.roles.id))
      .innerJoin(roleCapabilities, eq(groupRoles.roleId, roleCapabilities.roleId))
      .innerJoin(capabilities, eq(roleCapabilities.capabilityId, capabilities.id));

    return 'userId' in actor
      ? baseQuery
        .innerJoin(groupUsers, eq(groupRoles.groupId, groupUsers.groupId))
        .innerJoin(views.groups, eq(groupUsers.groupId, views.groups.id))
        .where(eq(groupUsers.userId, actor.userId))
      : baseQuery
        .innerJoin(views.serviceAccountGroups, eq(groupRoles.groupId, views.serviceAccountGroups.groupId))
        .innerJoin(views.groups, eq(views.serviceAccountGroups.groupId, views.groups.id))
        .innerJoin(views.serviceAccounts, eq(views.serviceAccountGroups.serviceAccountId, views.serviceAccounts.id))
        .where(eq(views.serviceAccountGroups.serviceAccountId, actor.serviceAccountId));
  },
});
