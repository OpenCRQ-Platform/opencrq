import { newError } from '@app/utils';
import type { platformGroups } from './schema';
import { defineService } from '../../registry';
import { platformCapabilitiesService } from '../platform-capabilities/service';
import { platformGroupsRepository } from './repository';

export const platformGroupsService = defineService(
  'platformGroups',
  platformGroupsRepository,
).dependsOn(() => [platformCapabilitiesService]).implement({
  getPlatformGroups: async ({ repo }) => await repo.findAllPlatformGroups(),
  listPlatformGroups: async ({ repo }) => await repo.findPlatformGroupListRows(),
  getPlatformGroup: async ({ repo }, id: string) => await repo.findPlatformGroupById(id),
  createPlatformGroup: async ({ repo }, group: typeof platformGroups.$inferInsert) => await repo.insertPlatformGroup(group),
  createDefaultPlatformRolesAndGroups: async ({ repo, eventOrigin }): Promise<boolean> => {
    if (eventOrigin.type !== 'system') {
      throw newError('System origin required');
    }
    return await repo.createDefaultPlatformRolesAndGroupsIfNone();
  },
  updatePlatformGroup: async ({ repo }, id: string, values: { name?: string }) => await repo.updatePlatformGroup(id, values),
  deletePlatformGroup: async ({ atomic }, id: string) => await atomic(async ({ repo, deps }) =>
    await deps.platformCapabilities.keepingPlatformReachable(() => repo.guardedDeletePlatformGroup(id))),
  addUserToPlatformGroup: async ({ repo }, platformGroupId: string, userId: string) => await repo.addPlatformGroupUser(platformGroupId, userId),
  removeUserFromPlatformGroup: async ({ atomic }, platformGroupId: string, userId: string) => await atomic(async ({ repo, deps }) =>
    await deps.platformCapabilities.keepingPlatformReachable(() => repo.guardedRemovePlatformGroupUser(platformGroupId, userId))),
  getPlatformGroupUsers: async ({ repo }, platformGroupId: string) => await repo.findPlatformGroupUsers(platformGroupId),
  addRoleToPlatformGroup: async ({ repo }, platformGroupId: string, platformRoleId: string) => await repo.addPlatformGroupRole(platformGroupId, platformRoleId),
  removeRoleFromPlatformGroup: async ({ atomic }, platformGroupId: string, platformRoleId: string) => await atomic(async ({ repo, deps }) =>
    await deps.platformCapabilities.keepingPlatformReachable(() => repo.guardedRemovePlatformGroupRole(platformGroupId, platformRoleId))),
  getPlatformGroupRoles: async ({ repo }, platformGroupId: string) => await repo.findPlatformGroupRoles(platformGroupId),
  getUserPlatformGroups: async ({ repo }, userId: string) => await repo.findUserPlatformGroups(userId),
});
