import { newError } from '@app/utils';
import type { SupportedLocale } from './validation';
import { defineService } from '../../registry';
import { platformCapabilitiesService } from '../platform-capabilities/service';
import { usersRepository } from './repository';

export const usersService = defineService(
  'users',
  usersRepository,
).dependsOn(() => [platformCapabilitiesService]).implement({
  getUsers: async ({ repo }) => await repo.findAllUsers(),
  listPlatformUsers: async ({ repo }) => await repo.findPlatformUserListRows(),
  getUser: async ({ repo }, id: string) => await repo.findUserById(id),
  /**
   * Refuses an owner the caller's tenant cannot see. The secured users view holds the tenant's
   * members and the super administrators only, so a foreign id would be stored as an owner nobody
   * in the tenant can resolve. A null or absent owner passes: it clears the owner or leaves it.
   */
  refuseOwnerOutsideTenant: async ({ repo }, ownerId: string | null | undefined) => {
    if (ownerId != null && await repo.findUserById(ownerId) === undefined) {
      throw newError('The owner is not a member of this tenant');
    }
  },
  getUserTheme: async ({ repo }, id: string) => await repo.getUserTheme(id),
  getUserPastelColours: async ({ repo }, id: string) => await repo.getUserPastelColours(id),
  getUserLocale: async ({ repo }, id: string) => await repo.getUserLocale(id),
  getUserHomeDashboard: async ({ repo }, id: string) => await repo.getUserHomeDashboard(id),
  /**
   * No tRPC router exposes this today, and integration tests are its only caller. The mutation
   * that eventually does must wrap it with `withConflictOn(LastPlatformAdminError, ...)` (see
   * `platform-roles-router.ts`), or a refusal here falls through to tRPC's default formatter as an
   * opaque `INTERNAL_SERVER_ERROR`.
   */
  // eslint-disable-next-line app/no-unused-service-method -- exercised by integration-tests/src/tests/service/{platform-admin,cascade-deletes}.test.ts, unreachable from a router until one exposes it
  deleteUser: async ({ atomic }, id: string) => await atomic(async ({ repo, deps }) =>
    await deps.platformCapabilities.keepingPlatformReachable(() => repo.guardedDeleteUser(id))),
  updateUser: async ({ repo }, id: string, data: { locale?: SupportedLocale | null, theme?: string, pastelColours?: boolean, homeDashboardId?: string | null }) =>
    await repo.updateUser(id, data),
});
