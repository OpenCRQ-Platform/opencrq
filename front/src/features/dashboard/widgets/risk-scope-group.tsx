import { Card, CardHeader, CardTitle, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { getRouteApi } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import { DashboardGroup, MetricInfo } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { formatDollar, formatRevenueBand } from '../../../utils';

const tenantRoute = getRouteApi('/_auth/$tenantId');

interface ScopeFieldCardProps {
  title: string,
  value: string | number | null | undefined,
  figure?: boolean,
}

const ScopeFieldCard: FunctionComponent<ScopeFieldCardProps> = ({ title, value, figure }) => (
  <Card elevation={2} gap={8}>
    <CardHeader>
      <CardTitle as="h3">{title}</CardTitle>
    </CardHeader>
    <Text as="span" variant={figure === true ? 'title-xl' : 'title-md'} className={figure === true ? 'tabular-nums' : undefined}>
      {value ?? <EmptyValue />}
    </Text>
  </Card>
);

const ScopeFields: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 lg:grid-cols-[repeat(4,minmax(0,1fr))]">{children}</div>
);

interface RiskScopeGroupProps {
  organizationId: string,
}

export const RiskScopeGroup: FunctionComponent<RiskScopeGroupProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data: organization } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: organizationId }));
  const { data: financialProfile } = useQuery(trpc.financialProfiles.getFinancialProfile.queryOptions({ organizationId }));

  const annualRevenue = financialProfile?.annualRevenue ?? null;
  // The declared band stands in until the financial profile states the figure itself.
  const revenue = annualRevenue === null
    ? (organization?.revenueBand ? formatRevenueBand(organization.revenueBand) : null)
    : formatDollar(annualRevenue);

  return (
    <DashboardGroup icon="building-2" title={t`Risk scope`}>
      <ScopeFields>
        <ScopeFieldCard title={t`Name`} value={organization?.name} />
        <ScopeFieldCard title={t`Country`} value={organization?.country?.name} />
        <ScopeFieldCard title={t`Sector`} value={organization?.sector?.name} />
        <ScopeFieldCard title={t`Annual revenue`} value={revenue} figure />
      </ScopeFields>
    </DashboardGroup>
  );
};

export const AllRiskScopesGroup: FunctionComponent = () => {
  const trpc = useTRPC();
  const { tenant } = tenantRoute.useLoaderData();
  const { data: scopes } = useQuery(trpc.organizations.getOrganizations.queryOptions());
  const { data: scenarios } = useQuery(trpc.dashboard.getScenarioSummaries.queryOptions({}));

  return (
    <DashboardGroup
      icon="building-2"
      title={t`Risk scope`}
      info={(
        <MetricInfo
          title={t`All risk scopes`}
          what={<Trans>The whole tenant: every figure of this dashboard aggregates the scenarios of every risk scope.</Trans>}
          how={<Trans>Pick a risk scope at the top right to read the dashboard on that scope alone.</Trans>}
        />
      )}
    >
      <ScopeFields>
        <ScopeFieldCard title={t`Name`} value={t`All risk scopes`} />
        <ScopeFieldCard title={t`Tenant`} value={tenant.name} />
        <ScopeFieldCard title={t`Risk scopes`} value={scopes?.length} figure />
        <ScopeFieldCard title={t`Risk scenarios`} value={scenarios?.length} figure />
      </ScopeFields>
    </DashboardGroup>
  );
};
