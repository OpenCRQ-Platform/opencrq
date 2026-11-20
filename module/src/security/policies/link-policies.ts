import { and, eq, exists, sql } from 'drizzle-orm';
import type { groupRoles, groupUsers, roleCapabilities, serviceAccountGroups } from '../../modules';
import type { EventOrigin, GatekeeperResult, SecurityPolicyRule } from '../policy';
import { groups, roles, serviceAccounts, tenantUsers } from '../../modules';
import { ownedByTenant } from './capability-policies';

/** Link rows are inserted or deleted, never rewritten: an update would bypass the checks `create` makes on both ends. */
const noUpdate = (): GatekeeperResult => sql`false`;

const linkedGroupInTenant = (origin: EventOrigin, table: typeof groupUsers | typeof groupRoles | typeof serviceAccountGroups): GatekeeperResult => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'platform':
      return sql`false`;
    case 'client':
    case 'connector':
    case 'job':
      return ownedByTenant(groups, table.groupId, origin.tenantId);
  }
};

/**
 * A membership links a group of the caller's tenant to a member of that tenant. No `read` rule:
 * the capability chain reads `group_users`, so filtering it would lock the security manager out.
 */
export const groupUsersLinkPolicy: SecurityPolicyRule<typeof groupUsers> = {
  update: noUpdate,
  delete: linkedGroupInTenant,
  create: (origin, values) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'platform':
        return sql`false`;
      case 'client':
      case 'connector':
      case 'job':
        return and(
          ownedByTenant(groups, values.groupId, origin.tenantId),
          exists(
            // Locks the membership so a removal of the member waits for this grant, then deletes it.
            sql`(select 1 from ${tenantUsers} where ${and(
              eq(tenantUsers.tenantId, origin.tenantId),
              eq(tenantUsers.userId, values.userId),
            )} for key share)`,
          ),
        );
    }
  },
};

/** A grant links a group of the caller's tenant to a role of that same tenant. No `read` rule, as for `group_users`. */
export const groupRolesLinkPolicy: SecurityPolicyRule<typeof groupRoles> = {
  update: noUpdate,
  delete: linkedGroupInTenant,
  create: (origin, values) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'platform':
        return sql`false`;
      case 'client':
      case 'connector':
      case 'job':
        return and(
          ownedByTenant(groups, values.groupId, origin.tenantId),
          ownedByTenant(roles, values.roleId, origin.tenantId),
        );
    }
  },
};

const roleInTenant = (origin: EventOrigin, table: typeof roleCapabilities): GatekeeperResult => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'platform':
      return sql`false`;
    case 'client':
    case 'connector':
    case 'job':
      return ownedByTenant(roles, table.roleId, origin.tenantId);
  }
};

/**
 * A capability granted to a role changes what every group holding that role can do, so the role
 * must belong to the caller's tenant. No `read` rule, as for `group_users`.
 */
export const roleCapabilitiesLinkPolicy: SecurityPolicyRule<typeof roleCapabilities> = {
  update: noUpdate,
  delete: roleInTenant,
  create: (origin, values) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'platform':
        return sql`false`;
      case 'client':
      case 'connector':
      case 'job':
        return ownedByTenant(roles, values.roleId, origin.tenantId);
    }
  },
};

/** A service account gets the capabilities of the groups it joins, so both ends must belong to the caller's tenant. No `read` rule, as for `group_users`. */
export const serviceAccountGroupsLinkPolicy: SecurityPolicyRule<typeof serviceAccountGroups> = {
  update: noUpdate,
  delete: linkedGroupInTenant,
  create: (origin, values) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'platform':
        return sql`false`;
      case 'client':
      case 'connector':
      case 'job':
        return and(
          ownedByTenant(serviceAccounts, values.serviceAccountId, origin.tenantId),
          ownedByTenant(groups, values.groupId, origin.tenantId),
        );
    }
  },
};
