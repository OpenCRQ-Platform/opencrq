import type { ThreatEntityType, ThreatSourceKind } from '@app/module/client';
import { activityGradeFor } from '@app/module/client';
import { Chip } from '@filigran/design-system';
import type { VisibilityState } from '@tanstack/react-table';
import type { DataPageLayoutPaging } from '../../../components/ui/data-page-layout';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { t } from '@lingui/core/macro';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { OutcomeScoreBadge } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { formatDate } from '../../../utils/date-utils';
import { ACTIVITY_GRADE_SEVERITY, ActivityGradeBadge } from './activity-grade-badge';
import { observedAtSortValue } from './activity-utils';
import { threatActivityStatus, threatActivityStatusLabel } from './threat-hero-utils';
import { sourceKindLabel } from './threat-list-utils';
import { ThreatTypeBadge } from './threat-type-badge';
import { ThreatTypeChip } from './threat-type-chip';

export interface ThreatListRow {
  id: string,
  stixId: string,
  name: string,
  entityType: ThreatEntityType,
  kind?: ThreatSourceKind,
  mitreGroupId: string | null,
  stixCreated: string | null,
  updatedAt: string,
  // `null` means the list-projection recompute hasn't covered this analysis yet, not a real zero.
  cveCount: number | null,
  techniqueCount: number | null,
  activityScore: number | null,
  lastObservedAt: Date | string | null,
  topOutcomeName?: string | null,
  topOutcomeScore?: number | null,
}

// Shown in a derived column while the list-projection recompute hasn't reached this analysis yet
// (see `ThreatListRow`) — distinct from `EmptyValue`, which marks a value the data genuinely
// has none of.
const PendingValue: FunctionComponent = () => (
  <span className="txt-sub-content text-muted-foreground italic">{t`Calculating…`}</span>
);

const DateCell: FunctionComponent<{ date: Date | string, title?: string }> = ({ date, title }) => (
  <span className="whitespace-nowrap text-content-caption text-default-secondary" title={title}>{formatDate(date)}</span>
);

const ActivityStatusCell: FunctionComponent<{ lastObservedAt: Date | string | null }> = ({ lastObservedAt }) => {
  const now = new Date();
  const status = threatActivityStatus(lastObservedAt, now);
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <Chip severity={ACTIVITY_GRADE_SEVERITY[activityGradeFor(lastObservedAt, now)]} label={threatActivityStatusLabel(status)} />
      {lastObservedAt !== null && status !== 'not-dated' && <DateCell date={lastObservedAt} title={t`Last observation`} />}
    </span>
  );
};

const CountCell: FunctionComponent<{ count: number | null }> = ({ count }) => (
  count === null ? <PendingValue /> : <span className="tabular-nums">{count}</span>
);

const catalogColumns = (
  showOutcomeColumn: boolean | undefined,
  outcomeColumnHeader: string | undefined,
  renderRowMarks: ((row: ThreatListRow) => ReactNode) | undefined,
): Array<ColumnDefWithOptionsHeader<ThreatListRow, unknown>> => [
  {
    id: 'name',
    accessorKey: 'name',
    header: t`Name`,
    size: 230,
    cell: ({ row }): ReactElement => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="block truncate font-medium" title={row.original.name}>{row.original.name}</span>
        {renderRowMarks?.(row.original)}
      </span>
    ),
  },
  {
    id: 'entityType',
    accessorKey: 'entityType',
    header: t`Type`,
    size: 185,
    enableSorting: false,
    cell: ({ row }): ReactElement => <ThreatTypeChip entityType={row.original.entityType} />,
  },
  ...(showOutcomeColumn
    ? [{
      id: 'topOutcome',
      header: outcomeColumnHeader ?? t`Top outcome`,
      size: 220,
      accessorFn: (row: ThreatListRow) => row.topOutcomeScore ?? 0,
      cell: ({ row }: { row: { original: ThreatListRow } }): ReactElement => (
        row.original.topOutcomeScore == null
          ? <PendingValue />
          : (
            <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
              <OutcomeScoreBadge score={row.original.topOutcomeScore} />
              {row.original.topOutcomeName && (
                <span className="truncate" title={row.original.topOutcomeName}>{row.original.topOutcomeName}</span>
              )}
            </span>
          )
      ),
    } satisfies ColumnDefWithOptionsHeader<ThreatListRow, unknown>]
    : []),
  {
    id: 'activity',
    accessorFn: (row) => observedAtSortValue(row.lastObservedAt),
    sortUndefined: 'last',
    sortDescFirst: true,
    header: t`Observed activity`,
    size: 200,
    cell: ({ row }): ReactElement => <ActivityStatusCell lastObservedAt={row.original.lastObservedAt} />,
  },
  {
    id: 'cveCount',
    accessorKey: 'cveCount',
    header: t`CVE`,
    size: 80,
    cell: ({ row }): ReactElement => <CountCell count={row.original.cveCount} />,
  },
  {
    id: 'techniqueCount',
    accessorKey: 'techniqueCount',
    header: t`TTP`,
    size: 80,
    cell: ({ row }): ReactElement => <CountCell count={row.original.techniqueCount} />,
  },
  {
    id: 'source',
    accessorKey: 'kind',
    header: t`Source`,
    size: 135,
    enableSorting: false,
    cell: ({ row }): ReactElement => (
      row.original.kind === undefined
        ? <EmptyValue />
        : <span className="whitespace-nowrap"><Chip label={sourceKindLabel(row.original.kind)} /></span>
    ),
  },
  {
    id: 'stixCreated',
    accessorKey: 'stixCreated',
    header: t`Original Creation Date`,
    size: 170,
    cell: ({ row }): ReactElement => (
      row.original.stixCreated === null ? <EmptyValue /> : <DateCell date={row.original.stixCreated} />
    ),
  },
  {
    id: 'updatedAt',
    accessorKey: 'updatedAt',
    header: t`Last Updated`,
    size: 185,
    cell: ({ row }): ReactElement => <DateCell date={row.original.updatedAt} />,
  },
];

interface ThreatListTableBaseProps {
  data: Array<ThreatListRow>,
  isLoading: boolean,
  storageKey: string,
  showOutcomeColumn?: boolean,
  outcomeColumnHeader?: string,
  leftHeaderContent?: ReactNode,
  emptyState?: ReactNode,
  initialSorting?: Array<{ id: string, desc: boolean }>,
  /**
   * Server-paginated mode, for the threat-center list: every column sorts and pages through
   * `threats.list` rather than the client-side row model. Omit `total` and what goes with it for a
   * caller feeding a full, unpaginated array — the CVE detail page's own `getByCveId` list.
   */
  serverSorted?: boolean,
  initialPageSize?: number,
  onServerPageChange?: (pagination: { pageIndex: number, pageSize: number }) => void,
  isPlaceholderData?: boolean,
  onDeleteItems?: (ids: Array<string>) => void | Promise<void>,
  /** The threat center's columns; without it, the summary columns the CVE detail page lists its citing threats with. */
  catalog?: boolean,
  initialColumnVisibility?: VisibilityState,
  /** The marks of the same threat in the connected XTM products, beside its name (catalog columns). */
  renderRowMarks?: (row: ThreatListRow) => ReactNode,
}

type ThreatListTableProps = ThreatListTableBaseProps & DataPageLayoutPaging;

/**
 * Shared threat table, row click navigates to the threat detail page. Used by the threats list page
 * with the catalog columns and by the CVE detail page's citing threats section.
 */
export const ThreatListTable: FunctionComponent<ThreatListTableProps> = ({
  data,
  isLoading,
  storageKey,
  showOutcomeColumn,
  outcomeColumnHeader,
  leftHeaderContent,
  emptyState,
  initialSorting,
  serverSorted,
  initialPageSize,
  onServerPageChange,
  isPlaceholderData,
  onDeleteItems,
  catalog,
  initialColumnVisibility,
  renderRowMarks,
  ...paging
}) => {
  const navigate = useNavigate();

  const columns: Array<ColumnDefWithOptionsHeader<ThreatListRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      cell: ({ row }): ReactElement => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'entityType',
      accessorKey: 'entityType',
      header: t`Type`,
      size: 140,
      enableSorting: false,
      cell: ({ row }): ReactElement => <ThreatTypeBadge entityType={row.original.entityType} />,
    },
    {
      id: 'mitreGroupId',
      accessorKey: 'mitreGroupId',
      header: t`MITRE ID`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">{row.original.mitreGroupId ?? <EmptyValue />}</span>
      ),
    },
    {
      id: 'cveCount',
      accessorKey: 'cveCount',
      header: t`CVE`,
      size: 100,
      cell: ({ row }): ReactElement => (
        row.original.cveCount === null ? <PendingValue /> : <span>{row.original.cveCount}</span>
      ),
    },
    {
      id: 'techniqueCount',
      accessorKey: 'techniqueCount',
      header: t`TTP`,
      size: 100,
      cell: ({ row }): ReactElement => (
        row.original.techniqueCount === null ? <PendingValue /> : <span>{row.original.techniqueCount}</span>
      ),
    },
    {
      id: 'activity',
      accessorFn: (row) => observedAtSortValue(row.lastObservedAt),
      sortUndefined: 'last',
      sortDescFirst: true,
      header: t`Observed activity`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <ActivityGradeBadge lastObservedAt={row.original.lastObservedAt} />
      ),
    },
    {
      id: 'stixCreated',
      accessorKey: 'stixCreated',
      header: t`Original Creation Date`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span className="txt-sub-content text-muted-foreground">
          {row.original.stixCreated ? formatDate(row.original.stixCreated) : <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'updatedAt',
      accessorKey: 'updatedAt',
      header: t`Last Updated`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span className="txt-sub-content text-muted-foreground">
          {formatDate(row.original.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <DataPageLayout
      data={data}
      {...paging}
      columns={catalog ? catalogColumns(showOutcomeColumn, outcomeColumnHeader, renderRowMarks) : columns}
      initialColumnVisibility={initialColumnVisibility}
      isLoading={isLoading}
      isPlaceholderData={isPlaceholderData}
      storageKey={storageKey}
      leftHeaderContent={leftHeaderContent}
      emptyState={emptyState}
      initialSorting={initialSorting}
      serverSorted={serverSorted}
      initialPageSize={initialPageSize}
      onServerPageChange={onServerPageChange}
      onDeleteItems={onDeleteItems}
      onClickRow={(row) => {
        void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'threat-center/threats/$threatId',
          params: { threatId: row.original.id },
        });
      }}
    />
  );
};
