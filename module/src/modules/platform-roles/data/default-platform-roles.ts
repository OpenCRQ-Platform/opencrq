import {
  PlatformCapability_CreateTenants,
  PlatformCapability_ManageUsers,
  PlatformCapability_PlatformAccess,
} from '../../platform-capabilities/data/platform-capabilities-ids';

export const DefaultPlatformRole_PlatformAdministrator = '01a1ef46-dbce-7025-a814-8f45c3cf1100';
export const DefaultPlatformRole_UserManager = '01a1ef46-dbd3-7fdd-b0f5-e7b2c9d054fc';

/** The platform roles a platform holding no platform role nor group is given at boot. */
export const DEFAULT_PLATFORM_ROLES: ReadonlyArray<{ id: string, name: string, capabilityIds: ReadonlyArray<string> }> = [
  {
    id: DefaultPlatformRole_PlatformAdministrator,
    name: 'Platform administrator',
    capabilityIds: [PlatformCapability_CreateTenants, PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess],
  },
  {
    id: DefaultPlatformRole_UserManager,
    name: 'User manager',
    capabilityIds: [PlatformCapability_ManageUsers, PlatformCapability_PlatformAccess],
  },
];
