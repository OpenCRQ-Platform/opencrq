import { msg } from '@lingui/core/macro';
import { Capability_ManageSecurity } from '@app/module/client';
import type { CapabilitiesMap } from '../../components/shared/capabilities-checklist';

export const CAPABILITIES_MAP: CapabilitiesMap = {
  'Security': {
    category: msg`Security`,
    capabilities: {
      [Capability_ManageSecurity]: { name: msg`Manage Security`, description: msg`Manage users, groups, roles and their capabilities.` },
    },
  },
};
