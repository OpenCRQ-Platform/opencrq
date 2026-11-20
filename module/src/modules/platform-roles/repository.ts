import { and, count, eq } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { platformCapabilities } from '../platform-capabilities';
import { platformRoleCapabilities, platformRoles } from './schema';

export const platformRolesRepository = defineRepository({
  findAllPlatformRoles: ({ db, views }) => db.select().from(views.platformRoles),
  findPlatformRoleListRows: async ({ db, views }) => {
    const [rows, capabilityCounts] = await Promise.all([
      db.select({ id: views.platformRoles.id, name: views.platformRoles.name }).from(views.platformRoles),
      db.select({ platformRoleId: views.platformRoleCapabilities.platformRoleId, count: count() })
        .from(views.platformRoleCapabilities)
        .innerJoin(views.platformCapabilities, eq(views.platformRoleCapabilities.capabilityId, views.platformCapabilities.id))
        .groupBy(views.platformRoleCapabilities.platformRoleId),
    ]);
    const capabilityCountByRole = new Map(capabilityCounts.map((row) => [row.platformRoleId, row.count]));
    return rows.map((role) => ({ ...role, capabilityCount: capabilityCountByRole.get(role.id) ?? 0 }));
  },
  findPlatformRoleById: async ({ db, views }, id: string) => {
    const role = await db.select().from(views.platformRoles).where(eq(views.platformRoles.id, id)).limit(1);
    return role.length > 0 ? role[0] : undefined;
  },
  insertPlatformRole: ({ db }, role: typeof platformRoles.$inferInsert) => db.insert(platformRoles).values(role),

  addPlatformRoleCapability: ({ db }, platformRoleId: string, capabilityId: string) => db.insert(platformRoleCapabilities).values({ platformRoleId, capabilityId }).onConflictDoNothing(),
  guardedRemovePlatformRoleCapability: ({ db }, platformRoleId: string, capabilityId: string) => db.delete(platformRoleCapabilities)
    .where(and(eq(platformRoleCapabilities.platformRoleId, platformRoleId), eq(platformRoleCapabilities.capabilityId, capabilityId))),

  updatePlatformRole: ({ db }, id: string, values: Partial<typeof platformRoles.$inferInsert>) => db.update(platformRoles).set(values).where(eq(platformRoles.id, id)),
  guardedDeletePlatformRole: ({ db }, id: string) => db.delete(platformRoles).where(eq(platformRoles.id, id)),

  findPlatformRoleCapabilities: async ({ db, views }, platformRoleId: string) => db.select({
    capability: platformCapabilities,
  })
    .from(views.platformRoleCapabilities)
    .innerJoin(views.platformCapabilities, eq(views.platformRoleCapabilities.capabilityId, views.platformCapabilities.id))
    .where(eq(views.platformRoleCapabilities.platformRoleId, platformRoleId)),

  findPlatformRolesByUserId: async ({ db, views }, userId: string) => db.selectDistinct({
    id: views.platformRoles.id,
    name: views.platformRoles.name,
  })
    .from(views.platformGroupUsers)
    .innerJoin(views.platformGroupRoles, eq(views.platformGroupUsers.platformGroupId, views.platformGroupRoles.platformGroupId))
    .innerJoin(views.platformRoles, eq(views.platformGroupRoles.platformRoleId, views.platformRoles.id))
    .where(eq(views.platformGroupUsers.userId, userId)),
});
