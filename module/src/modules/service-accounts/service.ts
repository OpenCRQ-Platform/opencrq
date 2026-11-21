import { uuidv7 } from 'uuidv7';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { serviceAccountsRepository } from './repository';

/** The group every tenant is provisioned with for the accounts its connectors run as. */
export const CONNECTORS_GROUP_SLUG = 'connectors';

export const serviceAccountsService = defineService('serviceAccounts', serviceAccountsRepository).implement({
  getServiceAccounts: async ({ repo }) => await repo.findAllServiceAccounts(),
  listServiceAccounts: async ({ repo }) => await repo.findServiceAccountListRows(),
  getServiceAccount: async ({ repo }, id: string) => await repo.findServiceAccountById(id),
  getServiceAccountNamesByIds: async ({ repo }, ids: Array<string>) => await repo.findServiceAccountNamesByIds(ids),
  createServiceAccount: async ({ repo, eventOrigin }, serviceAccount: { id: string, name: string, description?: string | null }) => {
    await repo.insertServiceAccount({ ...serviceAccount, tenantId: requireTenantId(eventOrigin) });
  },
  /**
   * Creates the account an integration runs as, in the tenant's Connectors group when it has one
   * (the group the Service accounts page puts a new account in too), and returns its id. Runs in the
   * caller's transaction, so the integration that binds it rolls it back with its own write.
   */
  createConnectorServiceAccount: async ({ repo, eventOrigin }, name: string): Promise<string> => {
    const id = uuidv7();
    await repo.insertServiceAccount({ id, name, tenantId: requireTenantId(eventOrigin) });
    const connectorsGroupId = await repo.findGroupIdBySlug(CONNECTORS_GROUP_SLUG);
    if (connectorsGroupId !== null) {
      await repo.addServiceAccountGroup(id, connectorsGroupId);
    }
    return id;
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
