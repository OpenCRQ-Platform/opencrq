import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { Skeleton } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import type { ProfileLabels, ProfileNotes, ScopeFrequencyRow, ScopeIdentity, TefCatalog } from '../threat-event-frequency-utils';
import { DebouncedSearchField, TooltipHintProvider } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { cn } from '../../../utils';
import { formatNumber } from '../../../utils/format-number';
import { threatEventFrequencyScopesListSearchSchema } from '../threat-event-frequency-list-search';
import { hasEmployeeCount, matchingScopes, outcomesByFrequency, profileNotes, readForOutcome, scopeFrequencyRows, scopeSizeSortKey } from '../threat-event-frequency-utils';
import { countryNoteText, formatAttempts, formatRange, profileLabels, sectorNoteText, sizeNoteText, unsetPartText } from './frequency-labels';
import { ProfileChip } from './profile-frequency';

interface ScopeTableRow extends ScopeFrequencyRow {
  id: string,
  notes: ProfileNotes,
}

/** Every cell holds one line, so that every row has the same height. */
const OneLine: FunctionComponent<{ children: ReactNode, className?: string }> = ({ children, className }) => (
  <span className={cn('block truncate', className)}>{children}</span>
);

/** A header on one line, cut short, so that every header has the same height; the full label shows on hover. */
const OneLineHeader: FunctionComponent<{ label: string, title?: string }> = ({ label, title }) => (
  <span className="block truncate" title={title ?? label}>{label}</span>
);

/** A part of the scope's profile, as the alert chip with its reason when the catalogue does not measure it. */
const ProfileCell: FunctionComponent<{ part: keyof ProfileLabels, value: string | null, note: string | null }> = ({ part, value, note }) => {
  const text = value ?? unsetPartText(part);
  if (note === null) {
    return <OneLine className="text-muted-foreground"><span title={text}>{text}</span></OneLine>;
  }
  return <span className="flex min-w-0"><ProfileChip label={text} note={note} /></span>;
};

interface AllScopesFrequencyProps {
  catalog: TefCatalog,
  scopes: ReadonlyArray<ScopeIdentity>,
}

export const AllScopesFrequency: FunctionComponent<AllScopesFrequencyProps> = ({ catalog, scopes }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { filters, setFilters } = useUrlListFilters(threatEventFrequencyScopesListSearchSchema);
  const { data: readings, isError } = useQuery(trpc.crqIndicators.getTefCatalogScopeReadings.queryOptions());
  if (isError) {
    return <p className="txt-sub-content text-muted-foreground"><Trans>The frequencies could not be loaded.</Trans></p>;
  }
  if (readings === undefined) {
    return <Skeleton className="h-96 w-full" />;
  }
  const allRows = scopeFrequencyRows(scopes, readings);
  const rows: Array<ScopeTableRow> = matchingScopes(allRows, filters.search).map((row) => ({
    ...row,
    id: row.scope.id,
    notes: profileNotes(row.reading.outcomes.map(({ read }) => read)),
  }));
  const outcomes = outcomesByFrequency(allRows);
  const labelsOf = (row: ScopeTableRow) => profileLabels(catalog, row.scope);

  const columns: Array<ColumnDefWithOptionsHeader<ScopeTableRow, unknown>> = [
    {
      id: 'name',
      accessorFn: (row) => row.scope.name,
      header: t`Risk scope`,
      size: 190,
      cell: ({ row }): ReactElement => <OneLine className="font-medium">{row.original.scope.name}</OneLine>,
    },
    {
      id: 'country',
      accessorFn: (row) => labelsOf(row).country ?? '',
      header: t`Country`,
      size: 150,
      cell: ({ row }): ReactElement => {
        const { notes } = row.original;
        return <ProfileCell part="country" value={labelsOf(row.original).country} note={notes.country === null ? null : countryNoteText(notes.country)} />;
      },
    },
    {
      id: 'sector',
      accessorFn: (row) => labelsOf(row).sector ?? '',
      header: t`Sector`,
      size: 170,
      cell: ({ row }): ReactElement => {
        const { notes } = row.original;
        return <ProfileCell part="sector" value={labelsOf(row.original).sector} note={notes.sector === null ? null : sectorNoteText(notes.sector)} />;
      },
    },
    {
      id: 'size',
      accessorFn: (row) => scopeSizeSortKey(row.scope, row.reading),
      header: t`Size`,
      size: 150,
      cell: ({ row }): ReactElement => {
        const { notes } = row.original;
        const { scope } = row.original;
        const value = hasEmployeeCount(scope) ? formatNumber(scope.employeeCount) : labelsOf(row.original).size;
        return <ProfileCell part="size" value={value} note={notes.size === null ? null : sizeNoteText(notes.size)} />;
      },
    },
    {
      id: 'attempts',
      accessorFn: (row) => row.reading.total.likely,
      header: () => <OneLineHeader label={t`Attempts/yr`} title={t`Most likely value`} />,
      size: 110,
      cell: ({ row }): ReactElement => (
        <span className="block text-right font-mono font-semibold tabular-nums">{formatAttempts(row.original.reading.total.likely)}</span>
      ),
    },
    {
      id: 'range',
      accessorFn: (row) => row.reading.total.high,
      header: () => <OneLineHeader label={t`Range`} />,
      size: 130,
      cell: ({ row }): ReactElement => {
        const { low, high } = row.original.reading.total;
        return <span className="block whitespace-nowrap text-right font-mono tabular-nums text-muted-foreground">{formatRange(low, high)}</span>;
      },
    },
    ...outcomes.map(({ id, name }): ColumnDefWithOptionsHeader<ScopeTableRow, unknown> => ({
      id,
      accessorFn: (row) => readForOutcome(row.reading, id)?.likely ?? 0,
      header: () => <OneLineHeader label={name} title={i18n._({ id: '{name}, attempts per year', message: '{name}, attempts per year', values: { name } })} />,
      size: 130,
      cell: ({ row }): ReactElement => {
        const read = readForOutcome(row.original.reading, id);
        return <span className="block text-right font-mono tabular-nums">{read === undefined ? null : formatAttempts(read.likely)}</span>;
      },
    })),
  ];

  return (
    <TooltipHintProvider>
      <DataPageLayout
        data={rows}
        columns={columns}
        storageKey="threat-event-frequency-scopes"
        initialSorting={[{ id: 'attempts', desc: true }]}
        leftHeaderContent={(
          <DebouncedSearchField
            placeholder={t`Search a risk scope...`}
            value={filters.search}
            onCommit={(search) => setFilters({ search })}
            clearLabel={t`Clear search`}
            className="w-80"
          />
        )}
        onClickRow={(row) => {
          void navigate({
            to: '/$tenantId/{-$organizationId}/threat-event-frequency',
            params: (prev) => ({ ...prev, tenantId: prev.tenantId!, organizationId: row.original.id }),
          });
        }}
      />
    </TooltipHintProvider>
  );
};
