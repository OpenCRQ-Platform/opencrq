import { Button, Chip } from '@filigran/design-system';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactElement } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { DebouncedSearchField } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { cweCatalogueListSearchSchema } from '../cwe-catalogue-list-search';
import { compareCweIds, filterCweCatalogue } from '../cwe-catalogue-utils';

type CatalogueEntry = inferRouterOutputs<TRPCRouter>['cwe']['list'][number];
type CatalogueRow = CatalogueEntry & { id: string };

export const CweCatalogueDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery(trpc.cwe.list.queryOptions());
  const { filters, setFilters } = useUrlListFilters(cweCatalogueListSearchSchema);

  const rows: Array<CatalogueRow> = filterCweCatalogue(data ?? [], filters)
    .map((entry) => ({ ...entry, id: entry.externalId }));

  const columns: Array<ColumnDefWithOptionsHeader<CatalogueRow, unknown>> = [
    {
      id: 'externalId',
      accessorKey: 'externalId',
      header: t`CWE`,
      size: 120,
      sortingFn: (left, right) => compareCweIds(left.original.externalId, right.original.externalId),
      cell: ({ row }): ReactElement => <span className="font-mono">{row.original.externalId}</span>,
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 420,
      cell: ({ row }): ReactElement => <span className="line-clamp-2">{row.original.name}</span>,
    },
    {
      id: 'techniqueCount',
      accessorKey: 'techniqueCount',
      header: t`Techniques`,
      size: 110,
      cell: ({ row }): ReactElement => <span className="tabular-nums">{row.original.techniqueCount}</span>,
    },
    {
      id: 'modified',
      accessorKey: 'modified',
      header: t`Origin`,
      size: 120,
      cell: ({ row }): ReactElement | null => (row.original.modified ? <Chip label={t`Modified`} /> : null),
    },
  ];

  return (
    <DataPageLayout
      data={rows}
      columns={columns}
      isLoading={isLoading}
      storageKey="cweCatalogue"
      leftHeaderContent={(
        <>
          <DebouncedSearchField
            placeholder={t`Search weaknesses...`}
            value={filters.search}
            onCommit={(search) => setFilters({ search })}
            clearLabel={t`Clear search`}
            className="w-80"
          />
          <Button
            priority={filters.presentInFindings ? 'primary' : 'secondary'}
            aria-pressed={filters.presentInFindings}
            onClick={() => setFilters({ presentInFindings: !filters.presentInFindings })}
          >
            <Trans>Present in my findings</Trans>
          </Button>
          <Button
            priority={filters.modified ? 'primary' : 'secondary'}
            aria-pressed={filters.modified}
            onClick={() => setFilters({ modified: !filters.modified })}
          >
            {t({ message: 'Modified', context: 'filter keeping the modified weaknesses' })}
          </Button>
        </>
      )}
      onClickRow={(row) => {
        void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'settings/taxonomies/cwe/$cweId',
          params: { cweId: row.original.externalId },
        });
      }}
    />
  );
};
