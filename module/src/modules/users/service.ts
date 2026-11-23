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
  getUserTheme: async ({ repo }, id: string) => await repo.getUserTheme(id),
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
  updateUser: async ({ repo }, id: string, data: { locale?: SupportedLocale | null, theme?: string, homeDashboardId?: string | null }) =>
    await repo.updateUser(id, data),
});
