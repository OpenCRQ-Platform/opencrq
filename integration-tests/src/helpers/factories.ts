import type { CreateTenantOptions, DrizzleDB, EventOrigin } from '@app/module';
import {
  PlatformCapability_CreateTenants,
  PlatformCapability_ManageUsers,
  PlatformCapability_PlatformAccess,
  platformGroupRoles,
  platformGroups,
  platformGroupUsers,
  platformRoleCapabilities,
  platformRoles,
  users,
} from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { TestServices } from '../setup/test-context';
import { db as testDb } from '../setup/db';

/**
 * A platform administrator: every platform capability through an `Admin` platform group, as the
 * platform seed makes its administrator.
 */
export const createPlatformAdmin = async (db: DrizzleDB, { id = uuidv7(), email }: { id?: string, email?: string } = {}) => {
  // The full id: the first 8 characters of a uuidv7 are its millisecond timestamp, equal for about
  // 65 seconds, so two admins created in one test would collide on users_email_unique.
  const userEmail = email ?? `admin-${id}@test.com`;
  const roleId = uuidv7();
  const groupId = uuidv7();
  await db.insert(users).values({ id, email: userEmail });
  await db.insert(platformRoles).values({ id: roleId, name: 'Admin' });
  await db.insert(platformRoleCapabilities).values([
    PlatformCapability_CreateTenants,
    PlatformCapability_ManageUsers,
    PlatformCapability_PlatformAccess,
  ].map((capabilityId) => ({ platformRoleId: roleId, capabilityId })));
  await db.insert(platformGroups).values({ id: groupId, name: 'Admin' });
  await db.insert(platformGroupRoles).values({ platformGroupId: groupId, platformRoleId: roleId });
  await db.insert(platformGroupUsers).values({ platformGroupId: groupId, userId: id });
  return { userId: id, email: userEmail };
};

/** The platform administrator most tests start from, holding every platform capability. */
export const createAdminUser = async (_services: TestServices) => createPlatformAdmin(testDb);

/**
 * Creates a tenant and adds the given user as its admin.
 * The user must have the CREATE_TENANTS platform capability.
 */
export const createTenant = async (services: TestServices, userId: string, options?: CreateTenantOptions) => {
  const tenantId = uuidv7();
  const origin: EventOrigin = { type: 'platform', userId };

  await services.withOrigin(origin).tenants.createTenant(
    { id: tenantId, name: `Test Tenant ${tenantId.substring(0, 8)}` },
    userId,
    options,
  );

  return tenantId;
};

export const createTenantWithAdmin = async (services: TestServices) => {
  const admin = await createAdminUser(services);
  const tenantId = await createTenant(services, admin.userId);

  return {
    ...admin,
    tenantId,
    origin: { type: 'client' as const, userId: admin.userId, tenantId } satisfies EventOrigin,
  };
};

/**
 * Creates a new user directly in the database, as a first sign-in through XTM One would, without
 * its XTM One id. Does NOT add the user to any tenant.
 */
export const createUser = async (db: DrizzleDB, email?: string) => {
  const userId = uuidv7();
  const userEmail = email ?? `user-${userId}@test.com`;

  await db.execute(sql`INSERT INTO users (id, email) VALUES (${userId}, ${userEmail})`);

  return { userId, email: userEmail };
};

/** Grants a capability through the full group → role → capability chain, in the admin's tenant. */
export const grantCapability = async (
  services: TestServices,
  adminOrigin: EventOrigin,
  userId: string,
  capabilityId: string,
) => {
  const roleId = uuidv7();
  await services.withOrigin(adminOrigin).roles.createRole({ id: roleId, name: `Role ${roleId.substring(0, 8)}` });
  await services.withOrigin(adminOrigin).roles.addCapabilityToRole(roleId, capabilityId);

  const groupId = uuidv7();
  await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: `Group ${groupId.substring(0, 8)}` });
  await services.withOrigin(adminOrigin).groups.addRoleToGroup(groupId, roleId);
  await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, userId);
};

/** Adds a new user to the tenant of `adminOrigin`, the only tenant the `tenant_users` create rule lets it add to. */
export const createTenantUser = async (
  services: TestServices,
  db: DrizzleDB,
  adminOrigin: EventOrigin,
) => {
  if (adminOrigin.type !== 'client') {
    throw new Error(`createTenantUser needs a client origin, got ${adminOrigin.type}`);
  }
  const { tenantId } = adminOrigin;
  const user = await createUser(db);

  await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, user.userId);

  return {
    ...user,
    tenantId,
    origin: { type: 'client' as const, userId: user.userId, tenantId } satisfies EventOrigin,
  };
};
