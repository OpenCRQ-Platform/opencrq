import { t } from '@lingui/core/macro';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { TaxonomiesToolbarMenu } from '../../../../../../components';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies')({
  loader: () => ({ crumb: t`Taxonomies` }),
  component: function TaxonomiesLayout() {
    return (
      <div className="mr-[200px]">
        <Outlet />
        <TaxonomiesToolbarMenu />
      </div>
    );
  },
});
