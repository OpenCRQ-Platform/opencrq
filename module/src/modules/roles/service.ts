import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { rolesRepository } from './repository';

export const rolesService = defineService('roles', rolesRepository).implement({
  getRoles: async ({ repo }) => await repo.findAllRoles(),
  listRoles: async ({ repo }) => await repo.findRoleListRows(),
  getRole: async ({ repo }, id: string) => await repo.findRoleById(id),
  createRole: async ({ repo, eventOrigin }, role: { id: string, name: string }) => {
    await repo.insertRole({ ...role, tenantId: requireTenantId(eventOrigin) });
  },
  updateRole: async ({ repo }, id: string, values: { name?: string }) => await repo.updateRole(id, values),
  addCapabilityToRole: async ({ repo }, roleId: string, capabilityId: string) => await repo.addRoleCapability(roleId, capabilityId),
  removeCapabilityFromRole: async ({ repo }, roleId: string, capabilityId: string) => await repo.removeRoleCapability(roleId, capabilityId),
  getRoleCapabilities: async ({ repo }, roleId: string) => await repo.findRoleCapabilities(roleId),
  getRoleGroups: async ({ repo }, roleId: string) => await repo.findGroupsByRoleId(roleId),
  getUserRoles: async ({ repo }, userId: string) => await repo.findRolesByUserId(userId),
  deleteRole: async ({ repo }, id: string) => await repo.deleteRole(id),
});
