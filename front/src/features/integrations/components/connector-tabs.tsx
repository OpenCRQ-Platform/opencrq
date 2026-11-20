import { t } from '@lingui/core/macro';
import { linkOptions } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { RouteTabs } from '../../../components/shared';

/**
 * The two halves of the integrations landing, each at its own address so a tab can be linked to.
 * The connector pages sit one level below, under `integrations/connectors`.
 */
export const ConnectorTabs: FunctionComponent = () => (
  <RouteTabs
    tabs={[
      {
        key: 'deployed',
        label: t`Deployed`,
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'integrations/deployed' }),
      },
      {
        key: 'available',
        label: t`Available`,
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'integrations/available' }),
      },
    ]}
  />
);
