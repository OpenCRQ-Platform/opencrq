import { and, eq, exists, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { EventOrigin, GatekeeperResult, SecurityPolicyRule } from '../policy';
import {
  PlatformCapability_ManageUsers,
  platformGroupRoles,
  platformGroupUsers,
  platformRoleCapabilities,
} from '../../modules';
import { userIsSuperAdmin } from './super-admin-policies';

/**
 * Whether the user holds a platform capability: through a platform group, or as the super
 * administrator. `platform-capabilities/repository.ts` answers its capability checks with this same
 * predicate, so a policy and the UI never disagree. The last-administrator guard counts group
 * holders only, on purpose: the super administrator status comes and goes with XTM One's claim.
 */
export const platformCapabilityHeld = (userId: string, capabilityId: string | PgColumn): SQL =>
  sql`(${userIsSuperAdmin(userId)} or ${exists(
    sql`(select 1
         from ${platformGroupUsers}
         inner join ${platformGroupRoles} on ${eq(platformGroupUsers.platformGroupId, platformGroupRoles.platformGroupId)}
         inner join ${platformRoleCapabilities} on ${eq(platformGroupRoles.platformRoleId, platformRoleCapabilities.platformRoleId)}
         where ${and(
            eq(platformGroupUsers.userId, userId),
            eq(platformRoleCapabilities.capabilityId, capabilityId),
          )})`,
  )})`;

export const hasManageUsers = (userId: string): SQL => platformCapabilityHeld(userId, PlatformCapability_ManageUsers);

/**
 * `client` and `platform` share the arm deliberately: `userOrigin()` in `trpc.ts` makes the caller
 * `client` on the mere presence of an `x-tenant-id` header, so treating them differently would leave
 * the header as the bypass.
 */
const requirePlatformManageUsers = (origin: EventOrigin): GatekeeperResult => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'connector':
    case 'job':
      return sql`false`;
    case 'client':
    case 'platform':
      return hasManageUsers(origin.userId);
  }
};

/**
 * The floor for the five platform group/role tables: `create` / `update` / `delete` only, no
 * `read`. A read rule would filter the rows `hasPlatformCapability` reads through
 * `views.platformGroupUsers` / `views.platformGroupRoles` / `views.platformRoleCapabilities`, so
 * every caller would come back uncapable and the platform surface would lock out, fresh installs
 * included. Read authorization for these tables is enforced instead at the tRPC boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle: PgTableWithColumns requires `any` type parameter
export const platformSecurityPolicy: SecurityPolicyRule<PgTableWithColumns<any>> = {
  create: (origin) => requirePlatformManageUsers(origin),
  update: (origin) => requirePlatformManageUsers(origin),
  delete: (origin) => requirePlatformManageUsers(origin),
};
