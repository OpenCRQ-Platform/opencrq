import type { FunctionComponent } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib';
import { CAPABILITIES_MAP } from '../../roles/capabilities';
import { EditRole } from '../../roles/components/role-update';
import { EffectivePermissionsView } from '../../users/components/effective-permissions-view';

export const ServiceAccountEffectivePermissions: FunctionComponent<{ serviceAccountId: string }> = ({ serviceAccountId }) => {
  const trpc = useTRPC();
  const { data: allCapabilities } = useSuspenseQuery(trpc.capabilities.getCapabilities.queryOptions());
  const { data: effectivePermissions } = useSuspenseQuery(trpc.capabilities.getServiceAccountEffectivePermissions.queryOptions({ serviceAccountId }));

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
