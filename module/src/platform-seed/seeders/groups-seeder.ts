import { groupRoles, groups, groupUsers } from '../../modules/groups/schema';
import {
  Group_SecurityTeam,
  Group_Viewers,
  Role_SecurityAnalyst,
  Role_Viewer,
  Tenant_Acme,
  User_Alice,
  User_Charlie,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('groups', async ({ db }) => {
  await db.insert(groups).values({ id: Group_SecurityTeam, name: 'Security Team', tenantId: Tenant_Acme });
  await db.insert(groupRoles).values({ groupId: Group_SecurityTeam, roleId: Role_SecurityAnalyst });
  await db.insert(groupUsers).values({ groupId: Group_SecurityTeam, userId: User_Alice });

  await db.insert(groups).values({ id: Group_Viewers, name: 'Viewers', tenantId: Tenant_Acme });
  await db.insert(groupRoles).values({ groupId: Group_Viewers, roleId: Role_Viewer });
  await db.insert(groupUsers).values({ groupId: Group_Viewers, userId: User_Charlie });

  // Note: the 'Connectors' group is created automatically by createTenantWithAdmin for every tenant.
});
