import type { FunctionComponent, ReactElement } from 'react';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { usePersistedPageSize, usePersistedSorting } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatDateTime, formatDollar, formatFixed, formatFractionAsPercent } from '../../../utils';
import { EmptyValue } from '../../../components/ui/empty-value';
import { SectionCard } from '../../../components';
import { DataPageLayout } from '../../../components/ui/data-page-layout';

const TABLE_ID = 'riskScenario.runHistory';
const PAGE_LIMIT = 20;
const DEFAULT_SORTING = [{ id: 'createdAt', desc: true }];

const formatLef = (value: number) => formatFixed(value, 3);

interface CrqRunHistoryProps {
  riskScenarioId: string,
}

export const CrqRunHistory: FunctionComponent<CrqRunHistoryProps> = ({ riskScenarioId }) => {
  const trpc = useTRPC();
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [pageIndex, setPageIndex] = useState(0);
  const [activeSort] = sorting;
  const { data, isPlaceholderData, isFetching } = useQuery(trpc.crqIndicators.listRunHistory.queryOptions(
    { riskScenarioId, page: pageIndex + 1, limit: pageSize, sortDesc: activeSort?.desc ?? true },
    { placeholderData: keepPreviousData },
  ));
  const runHistory = data?.items ?? [];

  if (data === undefined || data.total === 0) {
    return null;
  }

  const columns: Array<ColumnDefWithOptionsHeader<(typeof runHistory)[number], unknown>> = [
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: t`Date`,
      size: 170,
      cell: ({ row }): ReactElement => (
        <span>{formatDateTime(row.original.createdAt)}</span>
      ),
    },
    {
      id: 'vulnerability',
      header: t`V(scenario)`,
      size: 130,
      cell: ({ row }): ReactElement => (
        <div className="flex flex-col">
          <span className="font-medium">{formatFractionAsPercent(row.original.vulnerabilityP50, 1)}</span>
          <span className="txt-sub-content text-muted-foreground">
            {formatFractionAsPercent(row.original.vulnerabilityP5, 1)} – {formatFractionAsPercent(row.original.vulnerabilityP95, 1)}
          </span>
        </div>
      ),
    },
    {
      id: 'lef',
      header: t`LEF mean`,
      size: 100,
      cell: ({ row }): ReactElement => (
        <span>{row.original.lefMean != null ? formatLef(row.original.lefMean) : <EmptyValue />}</span>
      ),
    },
    {
      id: 'ale',
      header: t`ALE mean`,
      size: 110,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">{row.original.aleMean != null ? formatDollar(row.original.aleMean) : <EmptyValue />}</span>
      ),
    },
    {
      id: 'coverage',
      header: t`Coverage`,
      size: 100,
      cell: ({ row }): ReactElement => (
        <span>{row.original.coveredTechniqueCount}/{row.original.techniqueCount}</span>
      ),
    },
  ];

  return (
    <SectionCard title={t`Simulation History`} >
      <DataPageLayout
        data={runHistory}
        total={data.total}
        columns={columns}
        isPlaceholderData={isPlaceholderData}
        isFetching={isFetching}
        storageKey={TABLE_ID}
        initialPageSize={PAGE_LIMIT}
        initialSorting={DEFAULT_SORTING}
        serverSorted
        pageIndex={pageIndex}
        onServerPageChange={(pagination) => setPageIndex(pagination.pageIndex)}
        hideToolbar
      />
    </SectionCard>
  );
};
