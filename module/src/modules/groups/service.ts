import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { groupsRepository } from './repository';

export const groupsService = defineService('groups', groupsRepository).implement({
  getGroups: async ({ repo }) => await repo.findAllGroups(),
  listGroups: async ({ repo }) => await repo.findGroupListRows(),
  getGroup: async ({ repo }, id: string) => await repo.findGroupById(id),
  createGroup: async ({ repo, eventOrigin }, group: { id: string, name: string }) => {
    await repo.insertGroup({ ...group, tenantId: requireTenantId(eventOrigin) });
  },
  updateGroup: async ({ repo }, id: string, values: { name?: string }) => await repo.updateGroup(id, values),
  addUserToGroup: async ({ repo }, groupId: string, userId: string) => await repo.addGroupUser(groupId, userId),
  removeUserFromGroup: async ({ repo }, groupId: string, userId: string) => await repo.removeGroupUser(groupId, userId),
  getGroupUsers: async ({ repo }, groupId: string) => await repo.findGroupUsers(groupId),
  addRoleToGroup: async ({ repo }, groupId: string, roleId: string) => await repo.addGroupRole(groupId, roleId),
  removeRoleFromGroup: async ({ repo }, groupId: string, roleId: string) => await repo.removeGroupRole(groupId, roleId),
  getGroupRoles: async ({ repo }, groupId: string) => await repo.findGroupRoles(groupId),
  getUserGroups: async ({ repo }, userId: string) => await repo.findGroupsByUserId(userId),
  deleteGroup: async ({ repo }, id: string) => await repo.deleteGroup(id),
});
