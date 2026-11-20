import { and, eq, exists, getTableName, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { EventOrigin, GatekeeperResult, SecurityPolicyRule } from '../policy';
import type { roles, serviceAccounts } from '../../modules';
import { Capability_ManageSecurity, groupRoles, groups, groupUsers, roleCapabilities, serviceAccountGroups } from '../../modules';
import { userIsSuperAdmin } from './super-admin-policies';

export type TenantOwnedTable = typeof groups | typeof roles | typeof serviceAccounts;

/**
 * Aliased explicitly: `manageSecurityPolicy` is itself attached to `groups` (`groups/schema.ts`),
 * so an unaliased reference to `groups` here would shadow the outer query's own reference to it.
 * Aliasing the table symbol (rather than a raw SQL string) keeps a future rename of a table or its
 * columns caught by TypeScript. Built inside the function, not as a module-level constant: the
 * tables and this file both sit on the `modules` <-> `security/policies` import cycle, so an eager
 * `alias(...)` at the top of this module can run before the schema file has finished initializing
 * its export, and `alias()` rejects that `undefined` target at runtime.
 */
export const ownedByTenant = (table: TenantOwnedTable, id: PgColumn | string, tenantId: string): SQL => {
  const owner = alias(table, 'tenant_owned_row');
  // Interpolating an aliased table directly renders just its alias name (drizzle-orm sql.js), not
  // `real_table AS alias`, so the FROM clause is built from the real table plus that alias name.
  return exists(
    sql`(select 1 from ${table} as ${sql.raw(getTableName(owner))} where ${eq(owner.id, id)} and ${eq(owner.tenantId, tenantId)})`,
  );
};

export const groupBelongsToTenant = (groupIdColumn: PgColumn, tenantId: string): SQL =>
  ownedByTenant(groups, groupIdColumn, tenantId);

export const capabilityHeldInTenant = (
  origin: Extract<EventOrigin, { type: 'client' | 'connector' }>,
  capabilityId: string,
): SQL => {
  const actorFrom = origin.type === 'client'
    ? sql`${groupUsers} inner join ${groupRoles} on ${and(eq(groupUsers.groupId, groupRoles.groupId), eq(groupUsers.userId, origin.userId))}`
    : sql`${serviceAccountGroups} inner join ${groupRoles} on ${and(eq(serviceAccountGroups.groupId, groupRoles.groupId), eq(serviceAccountGroups.serviceAccountId, origin.serviceAccountId))}`;

  const heldThroughGroups = exists(
    sql`(select 1
         from ${actorFrom}
                  inner join ${roleCapabilities} on ${eq(groupRoles.roleId, roleCapabilities.roleId)}
         where ${and(
            eq(roleCapabilities.capabilityId, capabilityId),
            groupBelongsToTenant(groupRoles.groupId, origin.tenantId),
          )})`,
  );
  return origin.type === 'client'
    ? sql`(${userIsSuperAdmin(origin.userId)} or ${heldThroughGroups})`
    : heldThroughGroups;
};

const requireManageSecurity = (origin: EventOrigin): GatekeeperResult => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    // A capability is granted through membership of a tenant group: none reaches a background task
    // or the tenant-less surface.
    case 'job':
    case 'platform':
      return sql`false`;
    case 'client':
    case 'connector':
      return capabilityHeldInTenant(origin, Capability_ManageSecurity);
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle: PgTableWithColumns requires `any` type parameter
export const manageSecurityPolicy: SecurityPolicyRule<PgTableWithColumns<any>> = {
  read: (origin) => requireManageSecurity(origin),
  update: (origin) => requireManageSecurity(origin),
  delete: (origin) => requireManageSecurity(origin),
  create: (origin) => requireManageSecurity(origin),
};

/** No `read` rule: every member reads the setting, only a security manager writes it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle: PgTableWithColumns requires `any` type parameter
export const manageSecurityWritePolicy: SecurityPolicyRule<PgTableWithColumns<any>> = {
  update: (origin) => requireManageSecurity(origin),
  delete: (origin) => requireManageSecurity(origin),
  create: (origin) => requireManageSecurity(origin),
};
