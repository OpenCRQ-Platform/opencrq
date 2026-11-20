import { includesFolded } from '@app/utils/text-fold';
import { Button, Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactElement } from 'react';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { drataControlsListSearchSchema } from '../drata-controls-list-search';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { cn } from '../../../utils';
import { DebouncedSearchField } from '../../../components/shared';
import { ControlSignals, ControlStateBadge } from './drata-requirement-drawer';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type DrataFrameworkControlRow = RouterOutputs['drata']['getControlsForFramework'][number];

export const DrataControlsTable: FunctionComponent<{ frameworkId: string }> = ({ frameworkId }) => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.drata.getControlsForFramework.queryOptions({ frameworkId }));
  const { filters, setFilters } = useUrlListFilters(drataControlsListSearchSchema);
  const { notReadyOnly } = filters;

  const controls = data ?? [];
  const rows = controls
    .filter((row) => !notReadyOnly || (!row.isReady && row.archivedAt == null))
    .filter((row) => includesFolded(row.name, filters.search)
      || includesFolded(row.code, filters.search));
  const shownCount = rows.length;
  const totalCount = controls.length;

  const columns: Array<ColumnDefWithOptionsHeader<DrataFrameworkControlRow, unknown>> = [
    {
      id: 'code',
      accessorKey: 'code',
      header: t`Code`,
      size: 110,
      cell: ({ row }): ReactElement => (
        <span className={cn('font-mono', row.original.archivedAt != null && 'opacity-50')}>{row.original.code}</span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Control`,
      size: 340,
      cell: ({ row }): ReactElement => (
        <span className={cn('line-clamp-2', row.original.archivedAt != null && 'opacity-50')}>
          {row.original.name}
          {row.original.archivedAt != null && <Chip className="ml-2" label={t`Archived`} />}
        </span>
      ),
    },
    {
      id: 'state',
      accessorKey: 'isReady',
      header: t`State`,
      size: 110,
      cell: ({ row }): ReactElement => <ControlStateBadge isReady={row.original.isReady} />,
    },
    {
      id: 'signals',
      header: t`Signals`,
      size: 110,
      cell: ({ row }): ReactElement => <ControlSignals control={row.original} />,
    },
    {
      id: 'requirements',
      accessorKey: 'requirementCount',
      header: t`Requirements`,
      size: 110,
      cell: ({ row }): ReactElement => <span>{row.original.requirementCount}</span>,
    },
  ];

  return (
    <DataPageLayout
      data={rows}
      columns={columns}
      isLoading={isLoading}
      storageKey="drata_framework_controls"
      leftHeaderContent={(
        <>
          <DebouncedSearchField
            placeholder={t`Search controls...`}
            value={filters.search}
            onCommit={(next) => setFilters({ search: next })}
            clearLabel={t`Clear search`}
            className="w-80"
          />
          <Button
            priority={notReadyOnly ? 'primary' : 'secondary'}
            onClick={() => setFilters({ notReadyOnly: !notReadyOnly })}
          >
            <Trans>Not ready</Trans>
          </Button>
          {notReadyOnly && (
            <span className="txt-sub-content text-muted-foreground">
              {t({
                message: plural(totalCount, {
                  one: `${shownCount} of # control`,
                  other: `${shownCount} of # controls`,
                }),
              })}
            </span>
          )}
        </>
      )}
    />
  );
};
