import { and, count, eq } from 'drizzle-orm';
import { newError } from '@app/utils';
import { defineRepository } from '../../registry';
import { capabilities, groupRoles, groupUsers } from '../schema';
import { roleCapabilities, roles } from './schema';

export const rolesRepository = defineRepository({
  findAllRoles: ({ db, views }) => db.select().from(views.roles),
  findRoleListRows: async ({ db, views }) => {
    const [rows, capabilityCounts] = await Promise.all([
      db.select({ id: views.roles.id, name: views.roles.name }).from(views.roles),
      db.select({ roleId: roleCapabilities.roleId, count: count() })
        .from(roleCapabilities)
        .innerJoin(capabilities, eq(roleCapabilities.capabilityId, capabilities.id))
        .innerJoin(views.roles, eq(roleCapabilities.roleId, views.roles.id))
        .groupBy(roleCapabilities.roleId),
    ]);
    const capabilityCountByRole = new Map(capabilityCounts.map((row) => [row.roleId, row.count]));
    return rows.map((role) => ({ ...role, capabilityCount: capabilityCountByRole.get(role.id) ?? 0 }));
  },
  findRoleById: async ({ db, views }, id: string) => {
    const role = await db.select().from(views.roles).where(eq(views.roles.id, id)).limit(1);
    return role.length > 0 ? role[0] : undefined;
  },
  insertRole: ({ db }, role: typeof roles.$inferInsert) => db.insert(roles).values(role),
  updateRole: ({ db }, id: string, values: Partial<typeof roles.$inferInsert>) => db.update(roles).set(values).where(eq(roles.id, id)),
  deleteRole: ({ db }, id: string) => db.delete(roles).where(eq(roles.id, id)),

  addRoleCapability: async ({ db, views }, roleId: string, capabilityId: string) => {
    const role = await db.select({ id: views.roles.id }).from(views.roles).where(eq(views.roles.id, roleId)).limit(1);
    if (role.length === 0) {
      throw newError('Access Denied');
    }
    return db.insert(roleCapabilities).values({ roleId, capabilityId }).onConflictDoNothing();
  },
  removeRoleCapability: async ({ db, views }, roleId: string, capabilityId: string) => {
    const role = await db.select({ id: views.roles.id }).from(views.roles).where(eq(views.roles.id, roleId)).limit(1);
    if (role.length === 0) {
      throw newError('Access Denied');
    }
    return db.delete(roleCapabilities)
      .where(and(eq(roleCapabilities.roleId, roleId), eq(roleCapabilities.capabilityId, capabilityId)));
  },

  findRoleCapabilities: async ({ db, views }, roleId: string) => db.select({
    capability: capabilities,
  })
    .from(roleCapabilities)
    .innerJoin(capabilities, eq(roleCapabilities.capabilityId, capabilities.id))
    .innerJoin(views.roles, eq(roleCapabilities.roleId, views.roles.id))
    .where(eq(roleCapabilities.roleId, roleId)),

  findGroupsByRoleId: async ({ db, views }, roleId: string) => db.select({
    group: {
      id: views.groups.id,
      name: views.groups.name,
      tenantId: views.groups.tenantId,
    },
  })
    .from(groupRoles)
    .innerJoin(views.groups, eq(groupRoles.groupId, views.groups.id))
    .innerJoin(views.roles, eq(groupRoles.roleId, views.roles.id))
    .where(eq(groupRoles.roleId, roleId)),

  findRolesByUserId: async ({ db, views }, userId: string) => db.selectDistinct({
    id: views.roles.id,
    name: views.roles.name,
    tenantId: views.roles.tenantId,
  })
    .from(groupUsers)
    .innerJoin(groupRoles, eq(groupUsers.groupId, groupRoles.groupId))
    .innerJoin(views.roles, eq(groupRoles.roleId, views.roles.id))
    .where(eq(groupUsers.userId, userId)),
});
