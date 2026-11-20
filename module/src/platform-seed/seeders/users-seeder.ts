import { uuidv7 } from 'uuidv7';
import { PlatformCapability_CreateTenants, PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess } from '../../modules/platform-capabilities';
import { platformGroupRoles, platformGroups, platformGroupUsers } from '../../modules/platform-groups/schema';
import { platformRoleCapabilities, platformRoles } from '../../modules/platform-roles/schema';
import { users } from '../../modules/users/schema';
import { adminUser, seedUsers } from '../data/users';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('users', async ({ db, state, xtmOneAccounts }) => {
  if (!xtmOneAccounts) {
    // eslint-disable-next-line no-console
    console.warn('[platform-seed] No XTM One administrator (platform_seed.xtm_one_admin): the seeded users are not created in XTM One, so none of them can sign in.');
  }
  // In XTM One first, every seeded user with the seeded password: a user XTM One refuses then leaves
  // no OpenCRQ account behind, and the next run reuses whatever this one created there.
  const xtmSubject = (email: string, fullName: string, role: 'admin' | 'user') => (xtmOneAccounts
    ? xtmOneAccounts({ email, fullName, password: state.adminPassword, role })
    : Promise.resolve(null));
  // An XTM One administrator, so the seeded platform administrator can also manage XTM One accounts.
  const adminSubject = await xtmSubject(state.adminEmail, adminUser.name, 'admin');
  const userSubjects: Array<string | null> = [];
  for (const user of seedUsers) {
    userSubjects.push(await xtmSubject(user.email, user.name, 'user'));
  }

  await db.insert(users).values({
    id: adminUser.id,
    xtmSubject: adminSubject,
    email: state.adminEmail,
    name: adminUser.name,
    title: adminUser.title,
    locale: adminUser.locale,
    theme: adminUser.theme,
  });
  state.adminUserId = adminUser.id;

  // The seeded administrator holds every platform capability through a platform group, as a
  // platform administrator made in OpenCRQ would.
  const adminRoleId = uuidv7();
  await db.insert(platformRoles).values({ id: adminRoleId, name: 'Admin' });
  await db.insert(platformRoleCapabilities).values([
    { platformRoleId: adminRoleId, capabilityId: PlatformCapability_CreateTenants },
    { platformRoleId: adminRoleId, capabilityId: PlatformCapability_ManageUsers },
    { platformRoleId: adminRoleId, capabilityId: PlatformCapability_PlatformAccess },
  ]);
  const adminGroupId = uuidv7();
  await db.insert(platformGroups).values({ id: adminGroupId, name: 'Admin' });
  await db.insert(platformGroupRoles).values({ platformGroupId: adminGroupId, platformRoleId: adminRoleId });
  await db.insert(platformGroupUsers).values({ platformGroupId: adminGroupId, userId: adminUser.id });

  for (const [index, user] of seedUsers.entries()) {
    await db.insert(users).values({
      id: user.id,
      xtmSubject: userSubjects[index],
      email: user.email,
      name: user.name,
      title: user.title,
      locale: user.locale,
      theme: user.theme,
    });
  }
});
