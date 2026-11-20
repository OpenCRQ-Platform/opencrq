import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { Capability_ManageSecurity } from './data/capabilities-ids';
import { withGrantProvenance } from './effective-permissions';
import { capabilitiesRepository } from './repository';

export const capabilitiesService = defineService('capabilities', capabilitiesRepository).implement({
  getCapabilities: async ({ repo }) => await repo.findAllCapabilities(),
  // eslint-disable-next-line app/no-unused-service-method -- no router endpoint reads this; tenant-isolation integration coverage exercises it directly
  getUserCapabilities: async ({ repo, eventOrigin }, userId: string) => {
    // Unlike `hasCapability`, this looks up an explicit target user rather than the origin's own
    // actor, so `job` and `connector` (which carry a tenant) resolve normally; `platform` has none
    // to scope the lookup to and returns none, while `auth` and `system` reach `requireTenantId`
    // below and throw for the same reason.
    if (eventOrigin.type === 'platform') {
      return [];
    }
    return repo.findUserCapabilities(requireTenantId(eventOrigin), userId);
  },
  hasCapability: async ({ repo, eventOrigin }, capabilityId: string) => {
    if (eventOrigin.type === 'system') {
      return true;
    }
    // `auth` is mid-authentication, `job` has no actor behind it, and `platform` carries no tenant
    // to anchor a capability grant in — mirrors `requireManageSecurity`'s switch.
    if (eventOrigin.type === 'auth' || eventOrigin.type === 'job' || eventOrigin.type === 'platform') {
      return false;
    }
    return repo.hasCapability(eventOrigin, capabilityId);
  },
  hasManageSecurity: async ({ repo, eventOrigin }) => {
    if (eventOrigin.type === 'system') {
      return true;
    }
    if (eventOrigin.type === 'auth' || eventOrigin.type === 'job' || eventOrigin.type === 'platform') {
      return false;
    }
    return repo.hasCapability(eventOrigin, Capability_ManageSecurity);
  },
  getUserEffectivePermissions: async ({ repo }, userId: string) => withGrantProvenance(
    await repo.findEffectivePermissions({ userId }),
    await repo.findSuperAdministratorCapabilities(userId),
  ),
  getServiceAccountEffectivePermissions: async ({ repo }, serviceAccountId: string) => repo.findEffectivePermissions({ serviceAccountId }),
});
