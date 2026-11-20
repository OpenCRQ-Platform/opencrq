import { linkOptions, useParams } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { RouteTab } from '../../../components/shared';
import { RouteTabs } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { FindingsKpiPanel, UniqueFindingsKpiPanel } from './findings-kpi-panel';

interface FindingsListShellProps {
  view: 'all' | 'unique',
  children: ReactNode,
}

export const FindingsListShell: FunctionComponent<FindingsListShellProps> = ({ view, children }) => {
  const trpc = useTRPC();
  const { organizationId } = useParams({ strict: false });
  const { data: scope } = useQuery(trpc.organizations.getOrganization.queryOptions(
    { id: organizationId ?? '' },
    { enabled: organizationId !== undefined },
  ));
  // Until the scope answers, its mode is unknown, and a closed one must never reach for the
  // tenant's daily series: a tile would draw a tenant trend against the scope's own counts.
  const isScopeResolved = organizationId === undefined || scope !== undefined;
  const isClosedScope = scope?.estateMode === 'closed';
  const { data: counts, isLoading: isLoadingCounts } = useQuery(trpc.findingScore.getFindingsPanelCounts.queryOptions({
    organizationId: organizationId ?? null,
  }));
  const { data: baselines, isLoading: isLoadingBaselines } = useQuery(trpc.findingScore.getFindingBaselines.queryOptions(
    undefined,
    { enabled: isScopeResolved && !isClosedScope },
  ));
  const { data: uniqueCounts, isLoading: isLoadingUniqueCounts } = useQuery(trpc.findingScore.getUniqueFindingsPanelCounts.queryOptions(
    { organizationId: organizationId ?? null },
    { enabled: view === 'unique' },
  ));

  const tabs: Array<RouteTab> = [
    {
      key: 'all',
      label: t`All findings`,
      linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/findings', to: '/$tenantId/{-$organizationId}/findings', search: true }),
    },
    {
      key: 'unique',
      label: t`Unique findings`,
      linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/findings', to: '/$tenantId/{-$organizationId}/findings/unique', search: true }),
    },
  ];

  const isLoading = !isScopeResolved || isLoadingCounts || (!isClosedScope && isLoadingBaselines);

  return (
    <div className="flex flex-col gap-5">
      {view === 'unique'
        ? (
          <UniqueFindingsKpiPanel
            counts={counts}
            baselines={isClosedScope ? null : baselines}
            uniqueCounts={uniqueCounts}
            isLoading={isLoading || isLoadingUniqueCounts}
          />
        )
        : <FindingsKpiPanel counts={counts} baselines={isClosedScope ? null : baselines} isLoading={isLoading} />}
      <RouteTabs tabs={tabs} />
      {children}
    </div>
  );
};
