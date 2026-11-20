import { Chip, SearchField } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { RelatedTechnique, TechniqueGrainFilter } from '../related-techniques-utils';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { filterRelatedTechniques, isTechniqueGrainFilter } from '../related-techniques-utils';
import { useTechniqueRowNavigate } from './technique-table';

interface RelatedTechniquesTableProps {
  techniques: Array<RelatedTechnique>,
  storageKey: string,
  emptyState: ReactElement,
  /** Off where every row shares the same grain, which a column would only repeat. */
  showGrain?: boolean,
  /** On for the paginated tables, where a row below the first page is otherwise unreachable. */
  filterable?: boolean,
  /**
   * Column widths for a card holding a third of the page. Sizes are minimums the table widens
   * proportionally, so the full-width set overflows a narrow card into a horizontal scrollbar.
   */
  compact?: boolean,
}

export const RelatedTechniquesTable: FunctionComponent<RelatedTechniquesTableProps> = ({
  techniques,
  storageKey,
  emptyState,
  showGrain,
  filterable,
  compact,
}) => {
  const onClickRow = useTechniqueRowNavigate<RelatedTechnique>();
  const [search, setSearch] = useState('');
  const [grain, setGrain] = useState<TechniqueGrainFilter>('all');

  const rows = filterable === true ? filterRelatedTechniques(techniques, { search, grain }) : techniques;

  const columns: Array<ColumnDefWithOptionsHeader<RelatedTechnique, unknown>> = [
    {
      id: 'externalId',
      accessorKey: 'externalId',
      header: t`ID`,
      size: compact === true ? 110 : 140,
      cell: ({ row }): ReactElement => (
        // Sorted by external id, a sub-technique already sits under its parent: the indent is what
        // makes that adjacency read as a hierarchy rather than as a flat run of ids.
        <span className={row.original.isSubtechnique === true ? 'pl-4 font-mono' : 'font-mono'}>
          {row.original.externalId}
        </span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: compact === true ? 220 : 800,
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-2">
          <span>{row.original.name}</span>
          {row.original.revoked && <Chip severity="critical" label={t`Revoked`} />}
        </span>
      ),
    },
    ...(showGrain === true
      ? [{
        id: 'isSubtechnique',
        accessorKey: 'isSubtechnique',
        header: t`Grain`,
        size: 150,
        cell: ({ row }): ReactElement => (
          <span className="text-muted-foreground">
            {row.original.isSubtechnique === true ? <Trans>Sub-technique</Trans> : <Trans>Technique</Trans>}
          </span>
        ),
      } satisfies ColumnDefWithOptionsHeader<RelatedTechnique, unknown>]
      : []),
  ];

  const filters = filterable === true
    ? (
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          placeholder={t`Search techniques...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch('')}
          clearLabel={t`Clear search`}
          className="w-80"
        />
        {showGrain === true && (
          <Select
            value={grain}
            onValueChange={(value) => {
              if (isTechniqueGrainFilter(value)) {
                setGrain(value);
              }
            }}
          >
            <SelectTrigger className="w-56" aria-label={t`Filter by grain`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all"><Trans>All grains</Trans></SelectItem>
              <SelectItem value="technique"><Trans>Techniques</Trans></SelectItem>
              <SelectItem value="sub-technique"><Trans>Sub-techniques</Trans></SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    )
    : undefined;

  return (
    <DataPageLayout
      data={rows}
      columns={columns}
      storageKey={storageKey}
      hideToolbar={filterable !== true}
      leftHeaderContent={filters}
      initialSorting={[{ id: 'externalId', desc: false }]}
      emptyState={emptyState}
      onClickRow={onClickRow}
    />
  );
};
