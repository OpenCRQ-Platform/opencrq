import { msg } from '@lingui/core/macro';
import {
  PlatformCapability_CreateTenants,
  PlatformCapability_ManageUsers,
  PlatformCapability_PlatformAccess,
} from '@app/module/client';
import type { CapabilitiesMap } from '../../components/shared/capabilities-checklist';

export const PLATFORM_CAPABILITIES_MAP: CapabilitiesMap = {
  'Platform': {
    category: msg`Platform`,
    capabilities: {
      [PlatformCapability_PlatformAccess]: { name: msg`Platform Administration Access`, description: msg`Access to the platform administration section.` },
      [PlatformCapability_ManageUsers]: { name: msg`Manage Users`, description: msg`Create and manage platform users.` },
      [PlatformCapability_CreateTenants]: { name: msg`Create Tenants`, description: msg`Create and manage tenants.` },
    },
  },
};
