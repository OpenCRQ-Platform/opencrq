import type { ScenarioFindingSortKey } from '@app/module/client';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import type { inferRouterOutputs } from '@trpc/server';
import { Button, Chip, Paper } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { SCENARIO_FINDING_SORT_KEYS } from '@app/module/client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Bug, List, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import { riskScenarioFindingsListSearchSchema } from '../risk-scenario-findings-list-search';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { SourceStack } from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { EmptyValue } from '../../../components/ui/empty-value';
import { dismissedStateFilterLabel, EvidenceStateChip } from '../../finding-detail';
import { ScoreGaugeMark, severityBandLabel } from '../../finding-score';
import { usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { daysSince, formatDate, getAssetCategoryLabel, isEvidenceStateFilter } from '../../../utils';
import { assetNameText } from '../../../utils/asset-name-utils';
import { RiskScenarioUniqueCves } from './risk-scenario-unique-cves';
import { FigureFamilyDate } from './figure-family-date';
import { isFindingsSeverityFilter } from './risk-scenario-findings-utils';

type RiskScenarioFinding = inferRouterOutputs<TRPCRouter>['riskScenarios']['listFindingsForRiskScenario']['items'][number];

const TABLE_ID = 'riskScenario.scoredFindings';
const PAGE_LIMIT = 50;
const DEFAULT_SORTING = [{ id: 'score', desc: true }];

const toSortKey = (columnId: string | undefined): ScenarioFindingSortKey | undefined =>
  SCENARIO_FINDING_SORT_KEYS.find((key) => key === columnId);

interface RiskScenarioFindingsProps {
  riskScenarioId: string,
}

const RiskScenarioAllFindings: FunctionComponent<RiskScenarioFindingsProps> = ({ riskScenarioId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { filters, setFilters } = useUrlListFilters(riskScenarioFindingsListSearchSchema);
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;

  // The walk below a primary asset can reach hundreds of thousands of findings, so the server filters, orders and pages them.
  const { data, isError, isPlaceholderData, isFetching, refetch } = useQuery(trpc.riskScenarios.listFindingsForRiskScenario.queryOptions(
    {
      riskScenarioId,
      page,
      limit: pageSize,
      sortBy: toSortKey(activeSort?.id),
      sortDesc: activeSort?.desc ?? true,
      state: filters.state,
      severity: filters.severity,
    },
    { placeholderData: keepPreviousData },
  ));
  const rows = data?.items ?? [];

  // The state column only earns its width when the filter lets a dismissed finding through, whose
  // chip names what dismissed it. Under the applicable filter, every row would repeat the filter.
  const stateColumns: Array<ColumnDefWithOptionsHeader<RiskScenarioFinding, unknown>> = filters.state !== 'applicable'
    ? [{
      id: 'currentState',
      accessorFn: (row) => row.currentState ?? 'applicable',
      header: t`State`,
      size: 170,
      cell: ({ row }): ReactElement => (
        <EvidenceStateChip
          state={row.original.currentState ?? 'applicable'}
          kind="cve"
          origin={row.original.stateOrigin}
          dismissalType={row.original.dismissalType}
        />
      ),
    }]
    : [];

  const columns: Array<ColumnDefWithOptionsHeader<RiskScenarioFinding, unknown>> = [
    {
      id: 'name',
      accessorFn: (row) => row.cveId,
      header: t`Finding`,
      size: 280,
      cell: ({ row }): ReactElement => (
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono font-medium shrink-0">{row.original.cveId}</span>
          {row.original.cveTitle && (
            <span className="txt-sub-content text-muted-foreground truncate">{row.original.cveTitle}</span>
          )}
        </span>
      ),
    },
    ...stateColumns,
    {
      id: 'score',
      accessorFn: (row) => row.score ?? undefined,
      sortUndefined: 'last',
      header: t`Score`,
      size: 90,
      cell: ({ row }): ReactElement => {
        const { score, band } = row.original;
        if (score === null || band === null) {
          return <EmptyValue />;
        }
        const bandWord = severityBandLabel(band);
        return (
          <ScoreGaugeMark
            score={score}
            band={band}
            label={t`Finding score: ${score} out of 100, ${bandWord} band`}
          />
        );
      },
    },
    {
      id: 'assetName',
      accessorFn: (row) => assetNameText({ name: row.supportingAssetName, derivedName: row.supportingAssetDerivedName }, t`Unnamed asset`),
      header: t`Asset`,
      size: 220,
      cell: ({ row }): ReactElement => (
        <AssetName name={row.original.supportingAssetName} derivedName={row.original.supportingAssetDerivedName} className="font-medium truncate" />
      ),
    },
    {
      id: 'assetCategoryId',
      accessorFn: (row) => row.assetCategoryId ?? undefined,
      sortUndefined: 'last',
      header: t`Asset type`,
      size: 150,
      cell: ({ row }): ReactElement => (
        row.original.assetCategoryId === null
          ? <EmptyValue />
          : <Chip label={getAssetCategoryLabel(row.original.assetCategoryId)} />
      ),
    },
    {
      id: 'connectorSource',
      accessorFn: (row) => row.sources?.join(','),
      enableSorting: false,
      header: t`Source`,
      size: 100,
      cell: ({ row }): ReactElement => (
        row.original.sources === null ? <EmptyValue /> : <SourceStack sources={row.original.sources} />
      ),
    },
    {
      id: 'path',
      enableSorting: false,
      header: t`Attack Path`,
      size: 220,
      cell: ({ row }): ReactElement => {
        const { firstPath: first, pathCount } = row.original;
        if (first === null) {
          return <EmptyValue />;
        }
        const depth = first.depth;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <Chip label={depth === 0 ? t`Direct` : t`Transitive (${depth})`} />
            <AssetName name={first.viaAssetName} derivedName={first.viaAssetDerivedName} className="text-muted-foreground truncate" />
            {pathCount > 1 && (
              <span className="txt-sub-content text-muted-foreground">+{pathCount - 1}</span>
            )}
          </div>
        );
      },
    },
    {
      id: 'exploitedBy',
      enableSorting: false,
      header: t`Exploited By`,
      size: 200,
      cell: ({ row }): ReactElement => {
        const threats = row.original.exploitedBy;
        if (threats.length === 0) {
          return <EmptyValue />;
        }
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate font-medium">{threats[0].name}</span>
            {threats.length > 1 && (
              <span className="txt-sub-content text-muted-foreground">+{threats.length - 1}</span>
            )}
          </div>
        );
      },
    },
    {
      id: 'lastEvaluatedAt',
      accessorFn: (row) => row.lastEvaluatedAt ?? undefined,
      sortUndefined: 'last',
      header: t`Last seen`,
      size: 140,
      cell: ({ row }): ReactElement => (
        row.original.lastEvaluatedAt === null
          ? <EmptyValue />
          : <span className="text-muted-foreground">{formatDate(row.original.lastEvaluatedAt)}</span>
      ),
    },
    {
      id: 'ageDays',
      accessorFn: (row) => daysSince(row.firstSeenAt) ?? undefined,
      sortUndefined: 'last',
      header: t`Age`,
      size: 120,
      cell: ({ row }): ReactElement => {
        const days = daysSince(row.original.firstSeenAt);
        if (days === null) {
          return <EmptyValue />;
        }
        return (
          <span className="text-muted-foreground">
            {plural(days, { one: '# day', other: '# days' })}
          </span>
        );
      },
    },
  ];

  // No data and no error is still waiting, a retry paused in a background tab included: never an empty scenario.
  if (data === undefined && !isError) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Paper className="flex flex-col items-center gap-4 p-[48px_24px]">
        <TriangleAlert className="h-12 w-12 text-destructive" />
        <div className="text-center">
          <p className="txt-subtitle font-medium">
            <Trans>Findings could not be loaded</Trans>
          </p>
          <p className="txt-sub-content text-muted-foreground">
            <Trans>The findings for this scenario are unavailable, so this is not a clean scenario.</Trans>
          </p>
        </div>
        <Button priority="secondary" onClick={() => void refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </Paper>
    );
  }

  if (data === undefined || data.summary.unfiltered === 0) {
    return (
      <Paper className="flex flex-col items-center gap-4 p-[48px_24px]">
        <ShieldCheck className="h-12 w-12 text-muted-foreground" />
        <div className="text-center">
          <p className="txt-subtitle font-medium">
            <Trans>No findings on this scenario</Trans>
          </p>
          <p className="txt-sub-content text-muted-foreground">
            <Trans>No finding affects the assets in this scenario's blast radius.</Trans>
          </p>
        </div>
      </Paper>
    );
  }

  const { critical, high, medium, low, unscored, dismissed, total } = data.summary;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Chip severity="critical" label={t`Critical: ${critical}`} />
        <Chip severity="high" label={t`High: ${high}`} />
        <Chip severity="medium" label={t`Medium: ${medium}`} />
        <Chip severity="low" label={t`Low: ${low}`} />
        {unscored > 0 && <Chip label={t`Unscored: ${unscored}`} />}
        <Chip label={t`Set aside or no longer reported: ${dismissed}`} />
      </div>

      <DataPageLayout
        data={rows}
        total={total}
        columns={columns}
        isPlaceholderData={isPlaceholderData}
        isFetching={isFetching}
        storageKey={TABLE_ID}
        initialPageSize={PAGE_LIMIT}
        initialSorting={DEFAULT_SORTING}
        pageIndex={page - 1}
        serverSorted
        onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
        onClickRow={(row) => {
          void navigate({
            from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/findings',
            to: '/$tenantId/{-$organizationId}/findings/$evidenceId',
            params: { evidenceId: row.original.id },
          });
        }}
        leftHeaderContent={(
          <>
            <Select
              value={filters.state}
              onValueChange={(value) => {
                if (isEvidenceStateFilter(value)) {
                  setFilters({ state: value });
                  setPage(1);
                }
              }}
            >
              <SelectTrigger className="w-56" aria-label={t`Filter by state`}>
                <SelectValue placeholder={t`Filter by state`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="applicable"><Trans>Applicable</Trans></SelectItem>
                <SelectItem value="dismissed">{dismissedStateFilterLabel('cve')}</SelectItem>
                <SelectItem value="all"><Trans>All states</Trans></SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.severity}
              onValueChange={(value) => {
                if (isFindingsSeverityFilter(value)) {
                  setFilters({ severity: value });
                  setPage(1);
                }
              }}
            >
              <SelectTrigger className="w-44" aria-label={t`Filter by severity`}>
                <SelectValue placeholder={t`Filter by severity`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><Trans>All severities</Trans></SelectItem>
                <SelectItem value="critical"><Trans>Critical</Trans></SelectItem>
                <SelectItem value="high"><Trans>High</Trans></SelectItem>
                <SelectItem value="medium"><Trans>Medium</Trans></SelectItem>
                <SelectItem value="low"><Trans>Low</Trans></SelectItem>
                <SelectItem value="unscored"><Trans>Unscored</Trans></SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
      />
    </div>
  );
};

export const RiskScenarioFindings: FunctionComponent<RiskScenarioFindingsProps> = ({ riskScenarioId }) => {
  const { filters, setFilters } = useUrlListFilters(riskScenarioFindingsListSearchSchema);
  const viewItems: Array<IconButtonGroupItem<'all' | 'unique'>> = [
    { value: 'all', icon: <List className="size-4" />, tooltip: t`By finding` },
    { value: 'unique', icon: <Bug className="size-4" />, tooltip: t`By CVE` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <IconButtonGroup items={viewItems} value={filters.view} onChange={(view) => setFilters({ view })} />
        <span className="txt-sub-content text-muted-foreground">
          {filters.view === 'unique'
            ? <Trans>CVEs of the risk scope, ranked by what fixing each one removes from the annual loss exposure.</Trans>
            : <Trans>Findings on the assets this scenario's primary assets depend on.</Trans>}
        </span>
        {filters.view === 'unique' && <div className="ml-auto"><FigureFamilyDate riskScenarioId={riskScenarioId} family="cves" /></div>}
      </div>
      {filters.view === 'unique'
        ? <RiskScenarioUniqueCves riskScenarioId={riskScenarioId} />
        : <RiskScenarioAllFindings riskScenarioId={riskScenarioId} />}
    </div>
  );
};
