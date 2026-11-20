import type { EventOrigin } from '@app/module';
import {
  DefaultPlatformGroup_PlatformAdministrators,
  DefaultPlatformGroup_UserManagers,
  DefaultPlatformRole_PlatformAdministrator,
  DefaultPlatformRole_UserManager,
  PlatformCapability_CreateTenants,
  PlatformCapability_ManageUsers,
  PlatformCapability_PlatformAccess,
  platformGroupRoles,
  platformGroups,
  platformGroupUsers,
  platformRoleCapabilities,
  platformRoles,
} from '@app/module';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPlatformAdmin, createUser } from '../../helpers/factories';
import { db, pool } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const system = () => services.withOrigin({ type: 'system' });

const capabilityIdsOf = async (roleId: string) => (await db
  .select({ capabilityId: platformRoleCapabilities.capabilityId })
  .from(platformRoleCapabilities)
  .where(eq(platformRoleCapabilities.platformRoleId, roleId)))
  .map((row) => row.capabilityId)
  .sort();

const roleIdsOf = async (groupId: string) => (await db
  .select({ roleId: platformGroupRoles.platformRoleId })
  .from(platformGroupRoles)
  .where(eq(platformGroupRoles.platformGroupId, groupId)))
  .map((row) => row.roleId);

describe('Default platform roles and groups', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('should create the two roles, the two groups and their links on an empty platform', async () => {
    const created = await system().platformGroups.createDefaultPlatformRolesAndGroups();

    expect(created).toBe(true);
    const roles = await db.select({ id: platformRoles.id, name: platformRoles.name }).from(platformRoles);
    expect(roles).toHaveLength(2);
    expect(roles).toEqual(expect.arrayContaining([
      { id: DefaultPlatformRole_PlatformAdministrator, name: 'Platform administrator' },
      { id: DefaultPlatformRole_UserManager, name: 'User manager' },
    ]));
    expect(await capabilityIdsOf(DefaultPlatformRole_PlatformAdministrator)).toEqual([
      PlatformCapability_CreateTenants,
      PlatformCapability_ManageUsers,
      PlatformCapability_PlatformAccess,
    ].sort());
    expect(await capabilityIdsOf(DefaultPlatformRole_UserManager)).toEqual([
      PlatformCapability_ManageUsers,
      PlatformCapability_PlatformAccess,
    ].sort());
    const groups = await db.select({ id: platformGroups.id, name: platformGroups.name }).from(platformGroups);
    expect(groups).toHaveLength(2);
    expect(groups).toEqual(expect.arrayContaining([
      { id: DefaultPlatformGroup_PlatformAdministrators, name: 'Platform administrators' },
      { id: DefaultPlatformGroup_UserManagers, name: 'User managers' },
    ]));
    expect(await roleIdsOf(DefaultPlatformGroup_PlatformAdministrators)).toEqual([DefaultPlatformRole_PlatformAdministrator]);
    expect(await roleIdsOf(DefaultPlatformGroup_UserManagers)).toEqual([DefaultPlatformRole_UserManager]);
    expect(await db.select().from(platformGroupRoles)).toHaveLength(2);
    expect(await db.select().from(platformGroupUsers)).toHaveLength(0);
  });

  it('should create nothing when a platform role and a platform group already exist', async () => {
    await createPlatformAdmin(db);

    const created = await system().platformGroups.createDefaultPlatformRolesAndGroups();

    expect(created).toBe(false);
    expect((await db.select({ name: platformRoles.name }).from(platformRoles)).map((row) => row.name)).toEqual(['Admin']);
    expect((await db.select({ name: platformGroups.name }).from(platformGroups)).map((row) => row.name)).toEqual(['Admin']);
  });

  it('should create nothing when only a platform role exists', async () => {
    const roleId = uuidv7();
    await db.insert(platformRoles).values({ id: roleId, name: 'Custom' });

    const created = await system().platformGroups.createDefaultPlatformRolesAndGroups();

    expect(created).toBe(false);
    expect((await db.select({ id: platformRoles.id }).from(platformRoles)).map((row) => row.id)).toEqual([roleId]);
    expect(await db.select().from(platformGroups)).toHaveLength(0);
  });

  it('should create nothing when only a platform group exists', async () => {
    const groupId = uuidv7();
    await db.insert(platformGroups).values({ id: groupId, name: 'Custom' });

    const created = await system().platformGroups.createDefaultPlatformRolesAndGroups();

    expect(created).toBe(false);
    expect((await db.select({ id: platformGroups.id }).from(platformGroups)).map((row) => row.id)).toEqual([groupId]);
    expect(await db.select().from(platformRoles)).toHaveLength(0);
  });

  it('should not recreate a default that was deleted', async () => {
    await system().platformGroups.createDefaultPlatformRolesAndGroups();
    await db.delete(platformGroups).where(eq(platformGroups.id, DefaultPlatformGroup_UserManagers));
    await db.delete(platformRoles).where(eq(platformRoles.id, DefaultPlatformRole_UserManager));

    const created = await system().platformGroups.createDefaultPlatformRolesAndGroups();

    expect(created).toBe(false);
    expect(await db.select().from(platformRoles).where(eq(platformRoles.id, DefaultPlatformRole_UserManager))).toHaveLength(0);
    expect(await db.select().from(platformGroups).where(eq(platformGroups.id, DefaultPlatformGroup_UserManagers))).toHaveLength(0);
  });

  it('should not restore a default that was modified', async () => {
    await system().platformGroups.createDefaultPlatformRolesAndGroups();
    await db.update(platformRoles).set({ name: 'Renamed' }).where(eq(platformRoles.id, DefaultPlatformRole_PlatformAdministrator));
    await db.delete(platformRoleCapabilities).where(and(
      eq(platformRoleCapabilities.platformRoleId, DefaultPlatformRole_PlatformAdministrator),
      eq(platformRoleCapabilities.capabilityId, PlatformCapability_CreateTenants),
    ));

    const created = await system().platformGroups.createDefaultPlatformRolesAndGroups();

    expect(created).toBe(false);
    const [role] = await db.select({ name: platformRoles.name }).from(platformRoles)
      .where(eq(platformRoles.id, DefaultPlatformRole_PlatformAdministrator));
    expect(role.name).toBe('Renamed');
    expect(await capabilityIdsOf(DefaultPlatformRole_PlatformAdministrator)).toEqual([
      PlatformCapability_ManageUsers,
      PlatformCapability_PlatformAccess,
    ].sort());
  });

  it('should create one set of defaults when two calls run together', async () => {
    // Two idle pool connections, or the second call waits for a connection to open and starts after the first commits.
    await Promise.all([pool.query('select pg_sleep(0.05)'), pool.query('select pg_sleep(0.05)')]);
    const results = await Promise.all([
      system().platformGroups.createDefaultPlatformRolesAndGroups(),
      system().platformGroups.createDefaultPlatformRolesAndGroups(),
    ]);

    expect([...results].sort()).toEqual([false, true]);
    expect(await db.select().from(platformRoles)).toHaveLength(2);
    expect(await db.select().from(platformGroups)).toHaveLength(2);
  });

  it('should refuse a client origin and a platform origin and create nothing', async () => {
    const admin = await createPlatformAdmin(db);
    const clientOrigin: EventOrigin = { type: 'client', userId: admin.userId, tenantId: uuidv7() };
    const platformOrigin: EventOrigin = { type: 'platform', userId: admin.userId };

    await expect(services.withOrigin(clientOrigin).platformGroups.createDefaultPlatformRolesAndGroups())
      .rejects.toThrow('System origin required');
    await expect(services.withOrigin(platformOrigin).platformGroups.createDefaultPlatformRolesAndGroups())
      .rejects.toThrow('System origin required');

    expect(await db.select().from(platformRoles)).toHaveLength(1);
    expect(await db.select().from(platformGroups)).toHaveLength(1);
  });

  it('should let a super administrator delete a default group and its role, which have no member', async () => {
    await system().platformGroups.createDefaultPlatformRolesAndGroups();
    const { userId } = await createUser(db);
    await db.execute(sql`UPDATE users SET is_super_admin = true WHERE id = ${userId}`);
    const scoped = services.withOrigin({ type: 'platform', userId });

    await scoped.platformGroups.deletePlatformGroup(DefaultPlatformGroup_UserManagers);
    await scoped.platformRoles.deletePlatformRole(DefaultPlatformRole_UserManager);

    expect(await db.select().from(platformGroups).where(eq(platformGroups.id, DefaultPlatformGroup_UserManagers))).toHaveLength(0);
    expect(await db.select().from(platformRoles).where(eq(platformRoles.id, DefaultPlatformRole_UserManager))).toHaveLength(0);
  });
});
