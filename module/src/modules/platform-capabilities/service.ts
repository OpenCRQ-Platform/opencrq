import { StructuredError } from '@app/utils';
import { originUserId } from '../../security';
import { defineService } from '../../registry';
import { withGrantProvenance } from '../capabilities/effective-permissions';
import { PLATFORM_CAPABILITIES } from './data/platform-capabilities-data';
import { PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess } from './data/platform-capabilities-ids';
import { platformCapabilitiesRepository } from './repository';

export class LastPlatformAdminError extends StructuredError {
  override readonly name: string = 'LastPlatformAdminError';

  constructor(capabilityIds: Array<string>) {
    const names = capabilityIds.map((id) => PLATFORM_CAPABILITIES.find((entry) => entry.id === id)?.name ?? id);
    super(
      `The platform must keep at least one user holding the ${names.join(' and ')} capabilit${names.length > 1 ? 'ies' : 'y'}`,
      { data: { capabilityIds } },
    );
  }
}

/**
 * The capabilities the platform administration surface is reachable through: `MANAGE_USERS` gates
 * its tRPC routers (`createPlatformSecurityProcedure`) and `PLATFORM_ACCESS` its frontend routes,
 * which log the caller out when it is missing. Emptying either one is unrecoverable in-product.
 */
const REACHABILITY_CAPABILITY_IDS = [PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess];

export const platformCapabilitiesService = defineService(
  'platformCapabilities',
  platformCapabilitiesRepository,
).implement({
  getPlatformCapabilities: async ({ repo }) => await repo.findAllPlatformCapabilities(),
  // eslint-disable-next-line app/no-unused-service-method -- no router endpoint reads this; platform-admin integration coverage exercises it directly
  getUserPlatformCapabilities: async ({ repo }, userId: string) => await repo.findUserPlatformCapabilities(userId),
  hasPlatformCapability: async ({ repo, eventOrigin }, capabilityId: string) => {
    if (eventOrigin.type === 'system' || eventOrigin.type === 'auth') {
      return true;
    }
    const userId = originUserId(eventOrigin);
    return userId ? repo.hasPlatformCapability(userId, capabilityId) : false;
  },
  hasPlatformAccess: async ({ repo, eventOrigin }) => {
    if (eventOrigin.type === 'system' || eventOrigin.type === 'auth') {
      return true;
    }
    const userId = originUserId(eventOrigin);
    return userId ? repo.hasPlatformCapability(userId, PlatformCapability_PlatformAccess) : false;
  },
  getUserPlatformEffectivePermissions: async ({ repo }, userId: string) => withGrantProvenance(
    await repo.findUserPlatformEffectivePermissions(userId),
    await repo.findSuperAdministratorPlatformCapabilities(userId),
  ),
  /**
   * Runs a write that could empty a reachability capability, and rolls it back when it removes the
   * last holder of one. A capability with no holder before the write is left alone: a fresh
   * platform's groups have no member, and the super administrator still reaches the surface.
   * To call inside the `atomic()` that owns the transaction: the lock is transaction-scoped and the
   * check has to see the write before it commits.
   */
  keepingPlatformReachable: async ({ repo }, write: () => PromiseLike<unknown>) => {
    await repo.lockPlatformCapabilityHolders();
    const heldCapabilityIds: Array<string> = [];
    for (const capabilityId of REACHABILITY_CAPABILITY_IDS) {
      if (await repo.platformCapabilityHasHolder(capabilityId)) {
        heldCapabilityIds.push(capabilityId);
      }
    }
    await write();
    const emptiedCapabilityIds: Array<string> = [];
    for (const capabilityId of heldCapabilityIds) {
      if (!await repo.platformCapabilityHasHolder(capabilityId)) {
        emptiedCapabilityIds.push(capabilityId);
      }
    }
    if (emptiedCapabilityIds.length > 0) {
      throw new LastPlatformAdminError(emptiedCapabilityIds);
    }
  },
});
