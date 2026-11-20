import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { UniqueFindingTableRow } from '../../findings-home';
import type { CveGain } from '../cve-gain-utils';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { usePersistedPageSize, usePersistedSorting } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { toUniqueFindingTableRow, uniqueFindingsTableColumns } from '../../findings-home';
import { CveGainCell } from './cve-gain-cell';
import { CveGainsInfoTooltip } from './cve-gains-info-tooltip';
import { ScenarioMixturePendingNotice } from './scenario-mixture-pending-notice';

type SortKey = 'gain' | 'score' | 'affectedAssets' | 'name' | 'age';

const TABLE_ID = 'riskScenario.uniqueCves';
const PAGE_LIMIT = 50;
const DEFAULT_SORTING = [{ id: 'gain', desc: true }];

/** A column absent from here must declare `enableSorting: false`, or it offers an ordering the server cannot answer. */
const SORT_KEY_BY_COLUMN: Record<string, SortKey | undefined> = {
  gain: 'gain',
  score: 'score',
  affectedAssets: 'affectedAssets',
  name: 'name',
  ageDays: 'age',
};

const toSortKey = (columnId: string | undefined): SortKey | undefined =>
  (columnId === undefined ? undefined : SORT_KEY_BY_COLUMN[columnId]);

const FixGainHeader = (): ReactElement => (
  <span className="flex items-center gap-1.5">
    {t`Fix gain`}
    {/* The header sorts on click: the tooltip's own click must not reach it. */}
    <span onClick={(event) => event.stopPropagation()}>
      <CveGainsInfoTooltip />
    </span>
  </span>
);

interface RiskScenarioUniqueCvesProps {
  riskScenarioId: string,
}

export const RiskScenarioUniqueCves: FunctionComponent<RiskScenarioUniqueCvesProps> = ({ riskScenarioId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.riskScenarios.listUniqueCvesForRiskScenario.queryOptions(
    {
      riskScenarioId,
      page,
      limit: pageSize,
      sortBy: toSortKey(activeSort?.id) ?? 'gain',
      sortDesc: activeSort?.desc ?? true,
    },
    { placeholderData: keepPreviousData },
  ));

  const baselineAle = data?.baselineAle ?? null;
  const items = data?.items ?? [];
  const rows = items.map((item) => toUniqueFindingTableRow({ ...item, mitreTechniqueExternalId: null, mitreTechniqueName: null, expectationType: null }));
  const gainByKey = new Map<string, CveGain>(items.map((item) => [item.key, item.gain]));

  const [nameColumn, ...otherColumns] = uniqueFindingsTableColumns();
  const columns: Array<ColumnDefWithOptionsHeader<UniqueFindingTableRow, unknown>> = [
    nameColumn,
    {
      id: 'gain',
      accessorFn: (row) => {
        const gain = gainByKey.get(row.id);
        return gain?.state === 'amount' ? gain.mean : undefined;
      },
      sortUndefined: 'last',
      header: (): ReactElement => <FixGainHeader />,
      size: 220,
      cell: ({ row }): ReactElement => {
        const gain = gainByKey.get(row.original.id);
        return gain === undefined ? <EmptyValue /> : <CveGainCell gain={gain} baselineAle={baselineAle} />;
      },
    },
    ...otherColumns,
  ];

  return (
    <div className="flex flex-col gap-4">
      {data?.mixturePending && <ScenarioMixturePendingNotice />}
      <DataPageLayout
        data={rows}
        total={data?.total ?? 0}
        columns={columns}
        isLoading={isLoading}
        isPlaceholderData={isPlaceholderData}
        isFetching={isFetching}
        storageKey={TABLE_ID}
        initialPageSize={PAGE_LIMIT}
        initialSorting={DEFAULT_SORTING}
        pageIndex={page - 1}
        serverSorted
        onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
        emptyState={(
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <p><Trans>No applicable finding to group.</Trans></p>
          </div>
        )}
        onClickRow={(row) => {
          void navigate({
            from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/findings',
            to: '/$tenantId/{-$organizationId}/findings/cve/$cveId',
            params: { cveId: row.original.name },
          });
        }}
      />
    </div>
  );
};
