import { Checkbox, Chip, Text } from '@filigran/design-system';
import type { AssetCategory, AssetSortKey } from '@app/module/client';
import { MAX_SCOPE_MAPPING_IDS } from '@app/module/client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { EstateMappingDelta } from './estate-assets-picker-utils';
import { DebouncedSearchField } from '../../../components/shared/debounced-search-field';
import { AssetName } from '../../../components/shared/asset-name';
import { SourceStack } from '../../../components/shared/source-stack';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { usePersistedPageSize, usePersistedSorting } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { getAssetCategoryLabel } from '../../../utils';
import { assetNameText } from '../../../utils/asset-name-utils';
import { isAssetSelected, orderSelectedFirst, selectedAssetCount, toggleAssetSelection } from './estate-assets-picker-utils';

const TABLE_ID = 'estateAssetsPicker';
const PAGE_LIMIT = 25;
const NAME_SORTING = [{ id: 'name', desc: false }];
/** Editing a scope, the mapped rows are what the reader came for, and they are a handful of pages out of thousands. */
const MAPPED_FIRST_SORTING = [{ id: 'selected', desc: true }];

const SORT_KEY_BY_COLUMN: Record<string, AssetSortKey | undefined> = {
  selected: 'mapped',
  name: 'name',
  categoryId: 'categoryId',
  exposure: 'exposure',
};

interface PickerRow {
  id: string,
  name: string | null,
  derivedName: string | null,
  categoryId: AssetCategory,
  exposure: string,
  mapped: boolean,
  sources: Array<string>,
}

interface EstateAssetsPickerProps {
  /**
   * The scope whose stored mapping each row reports membership of. Absent while the scope is still
   * being created, where nothing is stored yet and every tick is an addition.
   */
  organizationId?: string,
  /** How many assets the stored mapping holds, which the delta below is counted against. */
  mappedCount: number,
  delta: EstateMappingDelta,
  onChange: (delta: EstateMappingDelta) => void,
  disabled?: boolean,
  /**
   * Rendered above the table, handed the size of the estate the page is drawn from, or `undefined`
   * until the first page answers. The caller's own copy can then name that count without a query
   * of its own: it arrives with the page.
   */
  header?: (estateTotal: number | undefined) => ReactNode,
}

/**
 * The tenant's whole estate, server-paged, with the assets mapped into one risk scope ticked. It
 * offers every asset whatever the scope's mode, since closing a scope is done by picking here, and
 * the form carries only what this session toggled: a scope may map more assets than a browser can hold.
 */
export const EstateAssetsPicker: FunctionComponent<EstateAssetsPickerProps> = ({
  organizationId,
  mappedCount,
  delta,
  onChange,
  disabled,
  header,
}) => {
  const trpc = useTRPC();
  const isDisabled = disabled ?? false;
  const [search, setSearch] = useState('');
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const defaultSorting = organizationId === undefined ? NAME_SORTING : MAPPED_FIRST_SORTING;
  const { sorting } = usePersistedSorting(TABLE_ID, defaultSorting);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;
  const sortBy = (activeSort === undefined ? undefined : SORT_KEY_BY_COLUMN[activeSort.id]) ?? 'name';
  const sortDesc = activeSort?.desc ?? false;

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.supportingAssets.listSupportingAssets.queryOptions(
    {
      page,
      limit: pageSize,
      search: search.trim() === '' ? null : search.trim(),
      source: null,
      organizationId: null,
      membershipOrganizationId: organizationId ?? null,
      sortBy,
      sortDesc,
    },
    { placeholderData: keepPreviousData },
  ));

  const rows: Array<PickerRow> = (data?.items ?? []).map((asset) => ({
    id: asset.id,
    name: asset.name,
    derivedName: asset.derivedName,
    categoryId: asset.categoryId,
    exposure: asset.exposure,
    mapped: asset.mapped,
    sources: asset.sources.flatMap((source) => (source.source === null ? [] : [source.source])),
  }));

  // The server ordered on the mapping it has stored, so a tick made since the drawer opened has to
  // be raised client-side; the selection that ordering reads is frozen until the page or the sort
  // changes, or the row just ticked would slide out from under the pointer.
  const orderKey = `${page}|${sortBy}|${String(sortDesc)}|${search}`;
  const [orderBasis, setOrderBasis] = useState({ key: orderKey, delta });
  const basis = orderBasis.key === orderKey ? orderBasis : { key: orderKey, delta };
  if (basis !== orderBasis) {
    setOrderBasis(basis);
  }
  const orderedRows = sortBy === 'mapped' && sortDesc ? orderSelectedFirst(rows, basis.delta) : rows;

  const total = data?.total ?? 0;
  // Undefined until the first page lands: the sentences it sizes are withheld rather than reading zero.
  const estateTotal = data?.estateTotal;
  const selectedCount = selectedAssetCount(mappedCount, delta);
  const isAtCap = delta.added.length >= MAX_SCOPE_MAPPING_IDS || delta.removed.length >= MAX_SCOPE_MAPPING_IDS;

  const toggle = (id: string, storedAsMapped: boolean) => {
    const next = toggleAssetSelection(delta, id, storedAsMapped);
    if (next.added.length > MAX_SCOPE_MAPPING_IDS || next.removed.length > MAX_SCOPE_MAPPING_IDS) {
      return;
    }
    onChange(next);
  };

  const columns: Array<ColumnDefWithOptionsHeader<PickerRow, unknown>> = [
    {
      id: 'selected',
      header: t`Mapped`,
      // Mapped first on the first click: the ordering exists to find what is already in the scope.
      sortDescFirst: true,
      size: 90,
      cell: ({ row }): ReactElement => (
        <Checkbox
          checked={isAssetSelected(delta, row.original.id, row.original.mapped)}
          disabled={isDisabled}
          aria-label={assetNameText(row.original, t`Unnamed asset`)}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => toggle(row.original.id, row.original.mapped)}
        />
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Asset`,
      size: 260,
      cell: ({ row }): ReactElement => <AssetName name={row.original.name} derivedName={row.original.derivedName} className="font-medium" />,
    },
    {
      id: 'categoryId',
      accessorKey: 'categoryId',
      header: t`Category`,
      size: 160,
      cell: ({ row }): ReactElement => <Chip label={getAssetCategoryLabel(row.original.categoryId)} />,
    },
    {
      id: 'exposure',
      header: t`Exposure`,
      size: 120,
      cell: ({ row }): ReactElement => {
        switch (row.original.exposure) {
          case 'internet_facing': return <Chip severity="critical" label={t`Internet`} />;
          case 'internal': return <Chip severity="info" label={t`Internal`} />;
          default: return <Chip label={t`Unknown`} />;
        }
      },
    },
    {
      id: 'sources',
      enableSorting: false,
      header: t`Source`,
      size: 100,
      cell: ({ row }): ReactElement => <SourceStack sources={row.original.sources} />,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {header?.(data?.estateTotal)}
      <div className="flex items-baseline justify-between gap-4">
        <Text as="h3" variant="content-compact-bold"><Trans>Mapped assets</Trans></Text>
        {isDisabled
          ? (
            <Text as="p" variant="content-compact" className="text-default-secondary">
              <Trans>Read-only: the scope is measured over the whole estate. Choose “Mapped assets only” to select some.</Trans>
            </Text>
          )
          : estateTotal !== undefined && (
            <Text as="p" variant="content-compact" className="text-default-secondary">
              {plural(selectedCount, {
                one: `# selected of ${estateTotal}`,
                other: `# selected of ${estateTotal}`,
              })}
            </Text>
          )}
      </div>
      {isAtCap && !isDisabled && (
        <Text as="p" variant="content-compact" className="text-[var(--fds-color-feedback-error-primary)]">
          <Trans>One save carries at most {MAX_SCOPE_MAPPING_IDS} changes. Save these, then map the rest.</Trans>
        </Text>
      )}
      <DebouncedSearchField
        placeholder={t`Search an asset...`}
        value={search}
        disabled={isDisabled}
        onCommit={(next) => {
          setSearch(next);
          setPage(1);
        }}
        clearLabel={t`Clear search`}
        className="w-80"
      />
      {/* Dimmed rather than unmounted: the tab must not change height when the mode does. */}
      <div className={isDisabled ? 'opacity-50' : undefined} inert={isDisabled}>
        <DataPageLayout
          data={orderedRows}
          total={total}
          columns={columns}
          isLoading={isLoading}
          isPlaceholderData={isPlaceholderData}
          isFetching={isFetching}
          storageKey={TABLE_ID}
          initialPageSize={PAGE_LIMIT}
          initialSorting={defaultSorting}
          pageIndex={page - 1}
          serverSorted
          onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
          leftHeaderContent={estateTotal === undefined ? null : (
            <span className="txt-sub-content text-muted-foreground">
              {sortBy === 'mapped' && sortDesc
                ? plural(estateTotal, {
                  one: '# asset in the tenant · sorted with the selected first',
                  other: '# assets in the tenant · sorted with the selected first',
                })
                : plural(estateTotal, { one: '# asset in the tenant', other: '# assets in the tenant' })}
            </span>
          )}
        />
      </div>
    </div>
  );
};
