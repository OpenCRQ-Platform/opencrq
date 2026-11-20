import { t } from '@lingui/core/macro';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../components/ui/data-table-types';
import type { DashboardId } from './dashboard-registry';
import { DebouncedSearchField } from '../../components/shared';
import { DataPageLayout } from '../../components/ui/data-page-layout';
import { useUrlListFilters } from '../../hooks';
import { HomeDashboardChips } from './components/home-dashboard-chips';
import { filterDashboards } from './dashboard-catalogue-utils';
import { DASHBOARD_DEFINITIONS } from './dashboard-registry';
import { dashboardsListSearchSchema } from './dashboards-list-search';
import { useHomeDashboards } from './hooks/use-home-dashboards';

interface DashboardRow {
  id: DashboardId,
  name: string,
  description: string,
}

export const DashboardsListPage: FunctionComponent = () => {
  const navigate = useNavigate();
  const { filters, setFilters } = useUrlListFilters(dashboardsListSearchSchema);
  const { userHomeId, tenantHomeId } = useHomeDashboards();

  const rows: Array<DashboardRow> = filterDashboards(
    DASHBOARD_DEFINITIONS.map((definition) => ({ id: definition.id, name: definition.getLabel(), description: definition.getDescription() })),
    filters.search,
  );

  const columns: Array<ColumnDefWithOptionsHeader<DashboardRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 240,
      cell: ({ row }): ReactElement => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: t`Description`,
      size: 480,
      cell: ({ row }): ReactElement => <span className="text-muted-foreground">{row.original.description}</span>,
    },
    {
      id: 'home',
      header: t`Home`,
      size: 260,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <HomeDashboardChips isMyHome={row.original.id === userHomeId} isTenantHome={row.original.id === tenantHomeId} />
      ),
    },
  ];

  return (
    <DataPageLayout
      data={rows}
      columns={columns}
      storageKey="dashboards"
      leftHeaderContent={(
        <DebouncedSearchField
          placeholder={t`Search dashboards...`}
          value={filters.search}
          onCommit={(next) => setFilters({ search: next })}
          clearLabel={t`Clear search`}
          className="w-80"
        />
      )}
      onClickRow={(row) => void navigate({
        from: '/$tenantId/{-$organizationId}',
        to: 'dashboards/$dashboardId',
        params: { dashboardId: row.original.id },
      })}
    />
  );
};
