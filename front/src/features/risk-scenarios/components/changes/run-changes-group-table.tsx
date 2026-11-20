import type { ChangeCategoryKey, ChangeGroup, ChangeGroupKind, ChangeGroupRow, ChangeGroupSortKey, EvidenceState, SeverityBand } from '@app/module/client';
import { CHANGE_GROUP_SORT_KEYS, RUN_CHANGE_GROUP_PAGE_SIZE } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, linkOptions } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import { AssetName } from '../../../../components/shared/asset-name';
import { DebouncedSearchField } from '../../../../components/shared/debounced-search-field';
import { DataPageLayout } from '../../../../components/ui/data-page-layout';
import { usePersistedPageSize, usePersistedSorting } from '../../../../hooks';
import { useTRPC } from '../../../../lib';
import { formatTimeOfDay } from '../../../../utils';
import { formatFixed } from '../../../../utils/format-number';
import { severityBandFigureColor, severityBandLabel } from '../../../finding-score/ui/severity-ramp';
import { EffectMark } from './change-effect-mark';

const TABLE_ID = 'runChangeGroup';

export interface ComparedRuns {
  riskScenarioId: string,
  firstRunId: string,
  secondRunId: string,
}

export const uniqueCveFindingLink = (cveId: string) => linkOptions({
  from: '/$tenantId/{-$organizationId}',
  to: 'findings/cve/$cveId',
  params: { cveId },
});

export const cveFindingsLink = (cveId: string, state: EvidenceState) => linkOptions({
  from: '/$tenantId/{-$organizationId}',
  to: 'findings',
  search: { vulnerability: cveId, state },
});

export const assetLink = (supportingAssetId: string) => linkOptions({
  from: '/$tenantId/{-$organizationId}',
  to: 'assets/$supportingAssetId',
  params: { supportingAssetId },
});

type GroupTableRow = ChangeGroupRow & { id: string };

type Column = ColumnDefWithOptionsHeader<GroupTableRow, unknown>;

const ItemCell: FunctionComponent<{ row: ChangeGroupRow }> = ({ row: { item } }) => {
  const { link } = item;
  if (link?.kind === 'asset') {
    return (
      <Link {...assetLink(link.supportingAssetId)} className="text-primary hover:underline">
        <AssetName name={item.label} derivedName={null} />
      </Link>
    );
  }
  if (link?.kind === 'cve') {
    return <Link {...uniqueCveFindingLink(link.cveId)} className="text-primary hover:underline">{item.key}</Link>;
  }
  if (link?.kind === 'cve-findings') {
    return <Link {...cveFindingsLink(link.cveId, link.state)} className="text-primary hover:underline">{item.key}</Link>;
  }
  return <span>{item.label ?? item.key}</span>;
};

const ASSET_KINDS: ReadonlySet<ChangeGroupKind> = new Set(['first-measured', 'posture-moved']);

/** The order the server answers without a sort: assets the worst posture first, CVEs the most assets first. */
const defaultSorting = (ofAsset: boolean) => [{ id: ofAsset ? 'band' : 'assets', desc: true }];

const toSortKey = (columnId: string | undefined): ChangeGroupSortKey | undefined =>
  CHANGE_GROUP_SORT_KEYS.find((key) => key === columnId);

const BandWord: FunctionComponent<{ band: SeverityBand | null, ofAsset: boolean }> = ({ band, ofAsset }) => {
  if (band !== null) {
    return <span style={{ color: severityBandFigureColor(band) }}>{severityBandLabel(band)}</span>;
  }
  return <span className="text-muted-foreground">{ofAsset ? <Trans>No posture</Trans> : <Trans>No band</Trans>}</span>;
};

const BandCell: FunctionComponent<{ row: ChangeGroupRow, kind: ChangeGroupKind }> = ({ row, kind }) => {
  const ofAsset = ASSET_KINDS.has(kind);
  switch (kind) {
    case 'appeared':
    case 'first-measured':
      return <BandWord band={row.to} ofAsset={ofAsset} />;
    case 'left':
    case 'no-longer-reported':
      return <BandWord band={row.from} ofAsset={ofAsset} />;
    case 'band-moved':
    case 'posture-moved':
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <BandWord band={row.from} ofAsset={ofAsset} />
          <ArrowRight aria-label={t`to`} className="size-3.5 text-muted-foreground" />
          <BandWord band={row.to} ofAsset={ofAsset} />
        </span>
      );
    default:
      return kind satisfies never;
  }
};

const buildColumns = (kind: ChangeGroupKind): Array<Column> => {
  const ofAsset = ASSET_KINDS.has(kind);
  const moved = kind === 'band-moved' || kind === 'posture-moved';
  const columns: Array<Column | false> = [
    {
      id: 'item',
      // `manualSorting` never reads these accessors: they only make each column sortable.
      accessorFn: (row) => row.item.label ?? row.item.key,
      header: ofAsset ? t`Asset` : t`CVE`,
      size: ofAsset ? 240 : 140,
      enableHiding: false,
      // On the one column a reader cannot hide: the chronology reads it to mark the hovered row on the curve.
      cell: ({ row }): ReactElement => <span data-change-at={row.original.at}><ItemCell row={row.original} /></span>,
    },
    {
      id: 'band',
      accessorFn: (row) => row.to ?? row.from,
      header: ofAsset ? t`Posture` : t`Band`,
      size: moved ? 130 : 140,
      cell: ({ row }): ReactElement => <BandCell row={row.original} kind={kind} />,
    },
    !ofAsset && {
      id: 'assets',
      accessorFn: (row) => row.assets,
      header: t`Assets`,
      size: 88,
      cell: ({ row }): ReactElement => <span className="tabular-nums">{formatFixed(row.original.assets ?? 0, 0)}</span>,
    },
    {
      id: 'time',
      accessorFn: (row) => row.at,
      header: t`Time`,
      size: 92,
      cell: ({ row }): ReactElement => <span className="tabular-nums text-muted-foreground">{formatTimeOfDay(row.original.at)}</span>,
    },
    moved && {
      id: 'direction',
      header: () => <span className="sr-only">{t`Effect`}</span>,
      enableSorting: false,
      size: 64,
      cell: ({ row }): ReactElement => <EffectMark direction={row.original.direction} />,
    },
  ];
  return columns.filter((column) => column !== false);
};

export const RunChangesGroupTable: FunctionComponent<{ comparison: ComparedRuns, category: ChangeCategoryKey, group: ChangeGroup }> = ({ comparison, category, group }) => {
  const trpc = useTRPC();
  const ofAsset = ASSET_KINDS.has(group.kind);
  const sortingStorageKey = `${TABLE_ID}-${ofAsset ? 'assets' : 'cves'}`;
  const { pageSize: initialPageSize } = usePersistedPageSize(TABLE_ID, RUN_CHANGE_GROUP_PAGE_SIZE);
  const { sorting } = usePersistedSorting(sortingStorageKey, defaultSorting(ofAsset));
  const [activeSort] = sorting;
  const sortBy = toSortKey(activeSort?.id);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState({ index: 0, size: initialPageSize });
  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.aleChangeExplain.getRunChangeGroup.queryOptions(
    {
      ...comparison,
      category,
      kind: group.kind,
      from: group.from,
      to: group.to,
      search: search.trim(),
      sort: sortBy === undefined ? null : { by: sortBy, desc: activeSort?.desc ?? false },
      offset: page.index * page.size,
      limit: page.size,
    },
    { placeholderData: keepPreviousData },
  ));
  const rows = (data?.rows ?? []).map((row): GroupTableRow => ({ ...row, id: row.item.key }));

  return (
    <DataPageLayout
      data={rows}
      total={data?.total ?? 0}
      columns={buildColumns(group.kind)}
      isLoading={isLoading}
      isPlaceholderData={isPlaceholderData}
      isFetching={isFetching}
      storageKey={TABLE_ID}
      sortingStorageKey={sortingStorageKey}
      initialSorting={defaultSorting(ofAsset)}
      serverSorted
      initialPageSize={RUN_CHANGE_GROUP_PAGE_SIZE}
      pageIndex={page.index}
      onServerPageChange={(pagination) => setPage({ index: pagination.pageIndex, size: pagination.pageSize })}
      leftHeaderContent={(
        <DebouncedSearchField
          placeholder={ofAsset ? t`Search asset...` : t`Search CVE...`}
          value={search}
          onCommit={(next) => {
            setSearch(next);
            setPage({ ...page, index: 0 });
          }}
          clearLabel={t`Clear search`}
          className="w-72"
        />
      )}
      emptyState={ofAsset ? <Trans>No asset matches.</Trans> : <Trans>No CVE matches.</Trans>}
    />
  );
};
