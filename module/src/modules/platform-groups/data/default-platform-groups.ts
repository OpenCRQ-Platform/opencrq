import {
  DefaultPlatformRole_PlatformAdministrator,
  DefaultPlatformRole_UserManager,
} from '../../platform-roles/data/default-platform-roles';

export const DefaultPlatformGroup_PlatformAdministrators = '01a1ef46-dbd3-7fdd-b0f5-e7b3bab7874f';
export const DefaultPlatformGroup_UserManagers = '01a1ef46-dbd3-7fdd-b0f5-e7b433f9a515';

export const DEFAULT_PLATFORM_GROUPS: ReadonlyArray<{ id: string, name: string, roleIds: ReadonlyArray<string> }> = [
  {
    id: DefaultPlatformGroup_PlatformAdministrators,
    name: 'Platform administrators',
    roleIds: [DefaultPlatformRole_PlatformAdministrator],
  },
  {
    id: DefaultPlatformGroup_UserManagers,
    name: 'User managers',
    roleIds: [DefaultPlatformRole_UserManager],
  },
];
