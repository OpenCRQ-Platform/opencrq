import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { serviceAccountsRepository } from './repository';

export const serviceAccountsService = defineService('serviceAccounts', serviceAccountsRepository).implement({
  getServiceAccounts: async ({ repo }) => await repo.findAllServiceAccounts(),
  listServiceAccounts: async ({ repo }) => await repo.findServiceAccountListRows(),
  getServiceAccount: async ({ repo }, id: string) => await repo.findServiceAccountById(id),
  getServiceAccountNamesByIds: async ({ repo }, ids: Array<string>) => await repo.findServiceAccountNamesByIds(ids),
  createServiceAccount: async ({ repo, eventOrigin }, serviceAccount: { id: string, name: string, description?: string | null }) => {
    await repo.insertServiceAccount({ ...serviceAccount, tenantId: requireTenantId(eventOrigin) });
  },
  updateServiceAccount: async ({ repo }, id: string, values: { name?: string, active?: boolean, description?: string | null }) =>
    await repo.updateServiceAccount(id, { ...values, updatedAt: new Date() }),
  addGroupToServiceAccount: async ({ repo }, serviceAccountId: string, groupId: string) =>
    await repo.addServiceAccountGroup(serviceAccountId, groupId),
  removeGroupFromServiceAccount: async ({ repo }, serviceAccountId: string, groupId: string) =>
    await repo.removeServiceAccountGroup(serviceAccountId, groupId),
  getServiceAccountRoles: async ({ repo }, serviceAccountId: string) =>
    await repo.findServiceAccountRoles(serviceAccountId),
  getServiceAccountGroups: async ({ repo }, serviceAccountId: string) =>
    await repo.findServiceAccountGroups(serviceAccountId),
  getGroupServiceAccounts: async ({ repo }, groupId: string) =>
    await repo.findGroupServiceAccounts(groupId),
});
