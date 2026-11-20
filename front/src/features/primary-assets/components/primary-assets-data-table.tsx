import type { SecurityNeedLevel } from '@app/module/client';
import { SECURITY_NEED_LEVELS } from '@app/module/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { OverallLevelFilter } from '../primary-asset-fields-utils';
import { EllipsisVertical } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DebouncedSearchField } from '../../../components/shared';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { BadgeGroup } from '../../../components/ui/badge-group';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useConfirmationDialog, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatDuration, securityNeedLabel } from '../primary-asset-fields-labels';
import { businessFunctionSuggestions, filterByNativeFields, overallSecurityNeed, resolveBusinessFunctionFilter, securityNeedRank } from '../primary-asset-fields-utils';
import { businessResourceName } from '../../business-value-categories';
import { primaryAssetsListSearchSchema } from '../primary-assets-list-search';
import { filterPrimaryAssets } from '../primary-assets-utils';
import { PrimaryAssetCreateSheet } from './primary-asset-create-sheet';
import { SecurityNeedChip } from './security-need-chip';

interface PrimaryAsset {
  id: string,
  name: string,
  description: string | null,
  reference: string | null,
  businessFunction: string | null,
  availability: SecurityNeedLevel | null,
  integrity: SecurityNeedLevel | null,
  confidentiality: SecurityNeedLevel | null,
  traceability: SecurityNeedLevel | null,
  rtoMinutes: number | null,
  owner: { name: string | null } | null,
  businessValueCategories: Array<{ id: string, code: string, name: string }>,
}

/** A business function is free text, so the "every function" option needs a value no function takes. */
const ALL_BUSINESS_FUNCTIONS = '__all_business_functions__';

const OVERALL_LEVEL_FILTERS: ReadonlyArray<OverallLevelFilter> = ['all', 'not_set', ...SECURITY_NEED_LEVELS];

interface PrimaryAssetsDataTableProps {
  organizationId: string,
}

/**
 * `BadgeGroup` keeps the resources on the row's single line and collapses the rest into a `+n`.
 * Wrapping them instead lets the cell drive both the height of every row and, since the table sizes
 * its columns from their content, the column's own width.
 */
const BusinessResourceChips: FunctionComponent<{ categories: PrimaryAsset['businessValueCategories'] }> = ({ categories }) => {
  if (categories.length === 0) {
    return <EmptyValue />;
  }
  return (
    <BadgeGroup
      chipClassName="max-w-[200px]"
      items={categories.map((category) => ({ title: businessResourceName(category) }))}
    />
  );
};

export const PrimaryAssetsDataTable: FunctionComponent<PrimaryAssetsDataTableProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;

  const { filters, setFilters } = useUrlListFilters(primaryAssetsListSearchSchema);

  const { data, isLoading } = useQuery(trpc.primaryAssets.getPrimaryAssets.queryOptions({ organizationId }));
  const functionOptions = data === undefined ? undefined : businessFunctionSuggestions(data);
  const businessFunction = resolveBusinessFunctionFilter(filters.businessFunction, functionOptions);
  const rows = filterByNativeFields(filterPrimaryAssets(data ?? [], filters.search), { businessFunction, level: filters.level });

  const deletePrimaryAssets = useMutation(trpc.primaryAssets.deletePrimaryAssets.mutationOptions({
    meta: { successMessage: msg`Primary asset deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deletePrimaryAssets.mutate([id]);
    }
  };

  const columns: Array<ColumnDefWithOptionsHeader<PrimaryAsset, unknown>> = [
    {
      id: 'reference',
      accessorFn: (row) => row.reference ?? undefined,
      sortUndefined: 'last',
      header: t`Reference`,
      size: 120,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.reference ?? <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 200,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'businessFunction',
      accessorFn: (row) => row.businessFunction ?? undefined,
      sortUndefined: 'last',
      header: t`Business function`,
      size: 160,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.businessFunction ?? <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'overallLevel',
      accessorFn: (row) => securityNeedRank(overallSecurityNeed(row)),
      header: t`Overall level`,
      size: 130,
      cell: ({ row }): ReactElement => {
        const level = overallSecurityNeed(row.original);
        return level === null ? <EmptyValue /> : <SecurityNeedChip level={level} />;
      },
    },
    {
      id: 'businessValueCategories',
      header: t`Business resources`,
      size: 240,
      cell: ({ row }): ReactElement => (
        <BusinessResourceChips categories={row.original.businessValueCategories} />
      ),
    },
    {
      id: 'rto',
      accessorFn: (row) => row.rtoMinutes ?? undefined,
      sortUndefined: 'last',
      header: t`RTO`,
      size: 90,
      cell: ({ row }): ReactElement => (
        <span>
          {row.original.rtoMinutes === null ? <EmptyValue /> : formatDuration(row.original.rtoMinutes)}
        </span>
      ),
    },
    {
      id: 'owner',
      header: t`Owner`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.owner?.name ?? <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'description',
      header: t`Description`,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">
          {row.original.description ?? <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'actions',
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => (
        <div className="flex items-center justify-end">
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem
              onClick={(e) => {
                e.stopPropagation();
                requestConfirmation(row.original.id);
              }}
            >
              {t`Delete`}
            </IconActionsItem>
          </IconActions>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataPageLayout
        data={rows}
        columns={columns}
        isLoading={isLoading}
        storageKey="primaryAssets"
        initialColumnVisibility={{ description: false }}
        leftHeaderContent={(
          <>
            <DebouncedSearchField
              placeholder={t`Search primary assets...`}
              value={filters.search}
              onCommit={(search) => setFilters({ search })}
              clearLabel={t`Clear search`}
              className="w-80"
            />
            <Select
              value={businessFunction === '' ? ALL_BUSINESS_FUNCTIONS : businessFunction}
              onValueChange={(value) => setFilters({ businessFunction: value === ALL_BUSINESS_FUNCTIONS ? '' : value })}
            >
              <SelectTrigger className="w-56" aria-label={t`Filter by business function`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BUSINESS_FUNCTIONS}><Trans>All business functions</Trans></SelectItem>
                {(functionOptions ?? []).map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.level}
              onValueChange={(value) => setFilters({ level: OVERALL_LEVEL_FILTERS.find((level) => level === value) ?? 'all' })}
            >
              <SelectTrigger className="w-48" aria-label={t`Filter by overall level`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><Trans>All levels</Trans></SelectItem>
                {[...SECURITY_NEED_LEVELS].reverse().map((level) => (
                  <SelectItem key={level} value={level}>{securityNeedLabel(level)}</SelectItem>
                ))}
                <SelectItem value="not_set"><Trans>Not set</Trans></SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        onCreate={() => setCreateSheetOpen(true)}
        onClickRow={(row) => {
          void navigate({
            from: '/$tenantId/{-$organizationId}/primary-assets',
            to: '$primaryAssetId',
            params: { primaryAssetId: row.original.id },
          })
        }}
        onDeleteItems={(ids) => deletePrimaryAssets.mutate(ids)}
      />

      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete primary asset</Trans>}
        description={<Trans>This will permanently delete this primary asset and everything attached to it. This action cannot be undone.</Trans>}
      />

      <PrimaryAssetCreateSheet
        organizationId={organizationId}
        open={createSheetOpen}
        onOpenChange={setCreateSheetOpen}
      />
    </>
  );
};
