import type { FunctionComponent } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib';
import { PLATFORM_CAPABILITIES_MAP } from '../../platform-roles/platform-capabilities';
import { EditPlatformRole } from '../../platform-roles/components/platform-role-update';
import { EffectivePermissionsView } from './effective-permissions-view';

export const PlatformEffectivePermissions: FunctionComponent<{ userId: string }> = ({ userId }) => {
  const trpc = useTRPC();
  const { data: allCapabilities } = useSuspenseQuery(trpc.platformCapabilities.getPlatformCapabilities.queryOptions());
  const { data: effectivePermissions } = useSuspenseQuery(trpc.platformCapabilities.getUserPlatformEffectivePermissions.queryOptions({ userId }));

  return (
    <EffectivePermissionsView
      allCapabilities={allCapabilities}
      effectivePermissions={effectivePermissions}
      capabilitiesMap={PLATFORM_CAPABILITIES_MAP}
      renderRoleEditor={(roleId, onClose) => (
        <EditPlatformRole
          platformRoleId={roleId}
          onCloseDrawer={onClose}
        />
      )}
    />
  );
};
