import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../../lib';
import { CopyableValue, SettingsCard, SettingsField } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useCanManagePlatform } from '../../../hooks/utils/use-can-manage-platform';

export const PlatformParameters: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data: health } = useQuery(trpc.health.queryOptions(undefined, { staleTime: Infinity }));
  const canManagePlatform = useCanManagePlatform();
  const { data: instance } = useQuery(trpc.edition.getInstance.queryOptions(undefined, {
    enabled: canManagePlatform,
    staleTime: Infinity,
    retry: false,
    meta: { skipErrorToast: true },
  }));

  return (
    <SettingsCard icon="server" title={t`OpenCRQ platform`}>
      <SettingsField label={t`Version`}>
        {health?.version == null ? <EmptyValue /> : <CopyableValue value={health.version} copyLabel={t`Copy the version`} />}
      </SettingsField>
      {canManagePlatform && (
        <SettingsField label={t`Instance identifier`}>
          {instance == null ? <EmptyValue /> : <CopyableValue value={instance.instanceId} copyLabel={t`Copy the instance identifier`} />}
        </SettingsField>
      )}
    </SettingsCard>
  );
};
