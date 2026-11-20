import {
  PlatformCapability_CreateTenants,
  PlatformCapability_ManageUsers,
  PlatformCapability_PlatformAccess,
} from './platform-capabilities-ids';

export interface PlatformCapabilityReference {
  id: string,
  name: string,
}

/** The platform capability catalog, reprovisioned on every boot. */
export const PLATFORM_CAPABILITIES: ReadonlyArray<PlatformCapabilityReference> = [
  { id: PlatformCapability_CreateTenants, name: 'Create Tenants' },
  { id: PlatformCapability_ManageUsers, name: 'Manage Users' },
  { id: PlatformCapability_PlatformAccess, name: 'Platform Administration Access' },
];
