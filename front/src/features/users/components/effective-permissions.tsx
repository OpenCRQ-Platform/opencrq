import type { FunctionComponent } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib';
import { CAPABILITIES_MAP } from '../../roles/capabilities';
import { EditRole } from '../../roles/components/role-update';
import { EffectivePermissionsView } from './effective-permissions-view';

export const EffectivePermissions: FunctionComponent<{ userId: string }> = ({ userId }) => {
  const trpc = useTRPC();
  const { data: allCapabilities } = useSuspenseQuery(trpc.capabilities.getCapabilities.queryOptions());
  const { data: effectivePermissions } = useSuspenseQuery(trpc.capabilities.getUserEffectivePermissions.queryOptions({ userId }));

  return (
    <EffectivePermissionsView
      allCapabilities={allCapabilities}
      effectivePermissions={effectivePermissions}
      capabilitiesMap={CAPABILITIES_MAP}
      renderRoleEditor={(roleId, onClose) => (
        <EditRole
          roleId={roleId}
          onCloseDrawer={onClose}
        />
      )}
    />
  );
};
