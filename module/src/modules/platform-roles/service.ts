import type { platformRoles } from './schema';
import { defineService } from '../../registry';
import { platformCapabilitiesService } from '../platform-capabilities/service';
import { platformRolesRepository } from './repository';

export const platformRolesService = defineService(
  'platformRoles',
  platformRolesRepository,
).dependsOn(() => [platformCapabilitiesService]).implement({
  getPlatformRoles: async ({ repo }) => await repo.findAllPlatformRoles(),
  listPlatformRoles: async ({ repo }) => await repo.findPlatformRoleListRows(),
  getPlatformRole: async ({ repo }, id: string) => await repo.findPlatformRoleById(id),
  createPlatformRole: async ({ repo }, role: typeof platformRoles.$inferInsert) => await repo.insertPlatformRole(role),
  updatePlatformRole: async ({ repo }, id: string, values: { name?: string }) => await repo.updatePlatformRole(id, values),
  addCapabilityToPlatformRole: async ({ repo }, platformRoleId: string, capabilityId: string) => await repo.addPlatformRoleCapability(platformRoleId, capabilityId),
  removeCapabilityFromPlatformRole: async ({ atomic }, platformRoleId: string, capabilityId: string) => await atomic(async ({ repo, deps }) =>
    await deps.platformCapabilities.keepingPlatformReachable(() => repo.guardedRemovePlatformRoleCapability(platformRoleId, capabilityId))),
  deletePlatformRole: async ({ atomic }, id: string) => await atomic(async ({ repo, deps }) =>
    await deps.platformCapabilities.keepingPlatformReachable(() => repo.guardedDeletePlatformRole(id))),
  getPlatformRoleCapabilities: async ({ repo }, platformRoleId: string) => await repo.findPlatformRoleCapabilities(platformRoleId),
  getUserPlatformRoles: async ({ repo }, userId: string) => await repo.findPlatformRolesByUserId(userId),
});
