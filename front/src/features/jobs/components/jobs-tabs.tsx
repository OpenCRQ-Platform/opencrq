import { t } from '@lingui/core/macro';
import { linkOptions } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { RouteTabs } from '../../../components/shared';

/**
 * The jobs landing's views, each at its own address so a tab can be linked to.
 */
export const JobsTabs: FunctionComponent = () => (
  <RouteTabs
    tabs={[
      {
        key: 'runs',
        label: t`Runs`,
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/jobs', to: 'runs' }),
      },
      {
        key: 'queue',
        label: t`Queue`,
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/jobs', to: 'queue' }),
      },
      {
        key: 'kinds',
        label: t`Kinds`,
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/jobs', to: 'kinds' }),
      },
      {
        key: 'schedules',
        label: t`Schedules`,
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/jobs', to: 'schedules' }),
      },
    ]}
  />
);
