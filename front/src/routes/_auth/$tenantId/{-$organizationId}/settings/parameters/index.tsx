import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PlatformParameters, TenantDefaultLocaleField, TenantHomeDashboardField } from '../../../../../../features';
import { FeatureFlagged } from '../../../../../../features/feature-flags';
import { FiligranLicenseCard, XtmOneCard } from '../../../../../../features/edition';
import { CopyableValue, SettingsCard, SettingsField } from '../../../../../../components/shared';
import { EmptyValue } from '../../../../../../components/ui/empty-value';
import { useTRPC } from '../../../../../../lib';

const RouteComponent = () => {
  const trpc = useTRPC();
  const { tenantId } = Route.useParams();
  const { data: tenant } = useQuery(trpc.tenants.getTenant.queryOptions({ id: tenantId }));

  return (
    // The arbitrary column template: FDS ships `md:grid-cols-2` unlayered, and it would win.
    <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[repeat(2,minmax(0,1fr))]">
      <SettingsCard icon="building-2" title={t`Tenant`}>
        <SettingsField label={t`Name`}>{tenant?.name ?? <EmptyValue />}</SettingsField>
        <SettingsField label={t`Identifier`}>
          <CopyableValue value={tenantId} copyLabel={t`Copy the tenant identifier`} />
        </SettingsField>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-6 gap-y-4">
          <TenantHomeDashboardField />
          <TenantDefaultLocaleField tenantId={tenantId} />
        </div>
      </SettingsCard>
      <PlatformParameters />
      <FeatureFlagged flag="enterprise-edition-status">
        <FiligranLicenseCard />
        <XtmOneCard />
      </FeatureFlagged>
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/parameters/')({
  component: RouteComponent,
});
