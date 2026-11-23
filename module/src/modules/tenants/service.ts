import { newError, StructuredError } from '@app/utils';
import type { SupportedLocale } from '../users/validation';
import type { CreateTenantOptions } from './repository';
import type { OpenctiThreatVisibility } from './threat-visibility';
import { isForeignKeyViolationOf } from '../../db/pg-errors';
import { defineService } from '../../registry';
import { requireClientTenantId } from '../../security';
import { PlatformCapability_CreateTenants } from '../platform-capabilities';
import { platformCapabilitiesService } from '../platform-capabilities/service';
import { tenantsRepository } from './repository';

export class TenantDeletionConflictError extends StructuredError {
  override readonly name: string = 'TenantDeletionConflictError';

  constructor() {
    super('This tenant changed during its deletion, or still holds data that prevents it', { data: {} });
  }
}

/** A tenant id the caller does not reach: unknown, or one they are not a member of. */
export class TenantNotFoundError extends StructuredError {
  override readonly name: string = 'TenantNotFoundError';

  constructor() {
    super('Tenant not found', { data: {} });
  }
}

export const tenantsService = defineService(
  'tenants',
  tenantsRepository,
).dependsOn(() => [platformCapabilitiesService]).implement({
  getTenants: async ({ repo }) => await repo.findAllTenants(),
  getTenantsWithMemberCount: async ({ repo }) => await repo.findAllTenantsWithMemberCount(),
  getTenant: async ({ repo }, id: string) => await repo.findTenantById(id),
  setTenantDefaultLocale: async ({ repo, eventOrigin }, defaultLocale: SupportedLocale | null) => {
    await repo.updateDefaultLocale(requireClientTenantId(eventOrigin), defaultLocale);
  },
  getThreatVisibility: async ({ repo }, tenantId: string): Promise<OpenctiThreatVisibility> =>
    (await repo.findTenantById(tenantId))?.threatVisibility ?? 'per_member',
  setThreatVisibility: async ({ repo, eventOrigin }, threatVisibility: OpenctiThreatVisibility) => {
    await repo.updateThreatVisibility(requireClientTenantId(eventOrigin), threatVisibility);
  },
  // Whether the acting user reaches the tenant, as the tenants policy answers it: a member, or the super administrator.
  callerReachesTenant: async ({ repo }, tenantId: string) => (await repo.findTenantById(tenantId)) !== undefined,
  createTenant: async ({ repo, deps }, input: { id: string, name: string }, currentUserId: string, options?: CreateTenantOptions) => {
    const canCreate = await deps.platformCapabilities.hasPlatformCapability(PlatformCapability_CreateTenants);
    if (!canCreate) {
      throw newError('You do not have permission to create tenants');
    }
    return await repo.createTenantWithAdmin({ id: input.id, name: input.name }, currentUserId, options);
  },
  createInitialTenant: async ({ repo, eventOrigin }, input: { id: string, name: string }, options?: CreateTenantOptions): Promise<boolean> => {
    if (eventOrigin.type !== 'system') {
      throw newError('System origin required');
    }
    return await repo.createInitialTenantIfNone(input, options);
  },
  renameTenant: async ({ repo, deps }, id: string, name: string): Promise<void> => {
    const canRename = await deps.platformCapabilities.hasPlatformCapability(PlatformCapability_CreateTenants);
    if (!canRename) {
      throw newError('You do not have permission to rename tenants');
    }
    if (!await repo.renameTenant(id, name)) {
      throw new TenantNotFoundError();
    }
  },
  deleteTenants: async ({ atomic, deps }, ids: Array<string>) => {
    const canDelete = await deps.platformCapabilities.hasPlatformCapability(PlatformCapability_CreateTenants);
    if (!canDelete) {
      throw newError('You do not have permission to delete tenants');
    }
    try {
      await atomic(async ({ repo }) => {
        if (!await repo.deleteTenants(ids)) {
          throw new TenantDeletionConflictError();
        }
      });
    } catch (error) {
      if (isForeignKeyViolationOf(error)) {
        throw new TenantDeletionConflictError();
      }
      throw error;
    }
  },
  addTenantUser: async ({ repo }, tenantId: string, userId: string) => await repo.addTenantUser(tenantId, userId),
  removeTenantUser: async ({ atomic }, tenantId: string, userId: string) => {
    await atomic(async ({ repo }) => {
      await repo.removeTenantUser(tenantId, userId);
    });
  },
  getTenantUsers: async ({ repo }, tenantId: string) => await repo.getTenantUsers(tenantId),
  listTenantUsers: async ({ repo }, tenantId: string) => await repo.findTenantUserListRows(tenantId),
  getTenantUserNamesByIds: async ({ repo }, tenantId: string, ids: Array<string>) => await repo.getTenantUserNamesByIds(tenantId, ids),
  getTenantUserProfile: async ({ repo }, tenantId: string, userId: string) => await repo.getTenantUserProfile(tenantId, userId),
  updateTenantUserProfile: async ({ repo }, tenantId: string, userId: string, data: { name?: string | null, title?: string | null }) => await repo.updateTenantUserProfile(tenantId, userId, data),
  isTenantUser: async ({ repo }, tenantId: string, userId: string) => await repo.isTenantUser(tenantId, userId),
});
