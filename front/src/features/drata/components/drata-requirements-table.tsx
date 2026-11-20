import { includesFolded } from '@app/utils/text-fold';
import { Button, Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RequirementDrawerTarget } from './drata-requirement-drawer';
import { EmptyValue } from '../../../components/ui/empty-value';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { drataRequirementsListSearchSchema } from '../drata-requirements-list-search';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { NOT_READY_SEVERITY, READY_SEVERITY } from '../drata-utils';
import { DebouncedSearchField } from '../../../components/shared';
import { DrataRequirementDrawer } from './drata-requirement-drawer';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type DrataRequirementRow = RouterOutputs['drata']['getRequirements'][number];

export const DrataRequirementsTable: FunctionComponent<{ frameworkId: string }> = ({ frameworkId }) => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.drata.getRequirements.queryOptions({ frameworkId }));
  const { filters, setFilters } = useUrlListFilters(drataRequirementsListSearchSchema);
  const { inScopeOnly, notReadyOnly } = filters;
  const [drawerTarget, setDrawerTarget] = useState<RequirementDrawerTarget | null>(null);

  const rows = (data ?? [])
    .filter((row) => !inScopeOnly || row.isInScope)
    .filter((row) => !notReadyOnly || (row.isInScope && !row.isReady))
    .filter((row) => includesFolded(row.name, filters.search)
      || includesFolded(row.code ?? '', filters.search));

  const columns: Array<ColumnDefWithOptionsHeader<DrataRequirementRow, unknown>> = [
    {
      id: 'code',
      accessorKey: 'code',
      header: t`Code`,
      size: 110,
      cell: ({ row }): ReactElement => (
        row.original.code === null
          ? <EmptyValue />
          : <span className="font-mono">{row.original.code}</span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Requirement`,
      size: 340,
      cell: ({ row }): ReactElement => <span className="line-clamp-2">{row.original.name}</span>,
    },
    {
      id: 'category',
      accessorKey: 'category',
      header: t`Category`,
      size: 140,
      cell: ({ row }): ReactElement => (
        row.original.category === null
          ? <EmptyValue />
          : <span className="text-muted-foreground">{row.original.category}</span>
      ),
    },
    {
      id: 'scope',
      accessorKey: 'isInScope',
      header: t`Scope`,
      size: 110,
      cell: ({ row }): ReactElement => (
        row.original.isInScope
          ? <Chip label={t`In scope`} />
          : <Chip label={t`Out of scope`} />
      ),
    },
    {
      id: 'state',
      accessorKey: 'isReady',
      header: t`State`,
      size: 110,
      cell: ({ row }): ReactElement => (
        row.original.isReady
          ? <Chip severity={READY_SEVERITY} label={t`Ready`} />
          : <Chip severity={NOT_READY_SEVERITY} label={t`Not ready`} />
      ),
    },
    {
      id: 'controls',
      accessorKey: 'controlCount',
      header: t`Controls`,
      size: 90,
      cell: ({ row }): ReactElement => <span>{row.original.controlCount}</span>,
    },
  ];

  return (
    <>
      <DataPageLayout
        data={rows}
        columns={columns}
        isLoading={isLoading}
        storageKey="drata_requirements"
        onClickRow={(row) => setDrawerTarget(row.original)}
        leftHeaderContent={(
          <>
            <DebouncedSearchField
              placeholder={t`Search requirements...`}
              value={filters.search}
              onCommit={(next) => setFilters({ search: next })}
              clearLabel={t`Clear search`}
              className="w-80"
            />
            <Button
              priority={inScopeOnly ? 'primary' : 'secondary'}
              onClick={() => setFilters({ inScopeOnly: !inScopeOnly })}
            >
              <Trans>In scope</Trans>
            </Button>
            <Button
              priority={notReadyOnly ? 'primary' : 'secondary'}
              onClick={() => setFilters({ notReadyOnly: !notReadyOnly })}
            >
              <Trans>Not ready</Trans>
            </Button>
          </>
        )}
      />
      <DrataRequirementDrawer requirement={drawerTarget} onClose={() => setDrawerTarget(null)} />
    </>
  );
};
