import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { DebouncedSearchField } from '../../../components/shared';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { BadgeGroup } from '../../../components/ui/badge-group';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useConfirmationDialog, useEditSelection, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { businessResourceName } from '../../business-value-categories';
import { securityCriterionLabel } from '../../primary-assets/primary-asset-fields-labels';
import { requirementsListSearchSchema } from '../requirements-list-search';
import { filterRequirements, protectedCriteria } from '../requirements-utils';
import { RequirementDrawer } from './requirement-drawer';

type RequirementRow = inferRouterOutputs<TRPCRouter>['requirements']['getRequirements'][number];

const Chips: FunctionComponent<{ titles: Array<string> }> = ({ titles }) => (titles.length === 0
  ? <EmptyValue />
  : <BadgeGroup chipClassName="max-w-[200px]" items={titles.map((title) => ({ title }))} />);

export const RequirementsDataTable: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const [createOpen, setCreateOpen] = useState(false);
  const { editId, openEdit, closeEdit } = useEditSelection();
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;
  const { filters, setFilters } = useUrlListFilters(requirementsListSearchSchema);

  const { data, isLoading } = useQuery(trpc.requirements.getRequirements.queryOptions({ organizationId }));
  const rows = filterRequirements(data ?? [], filters.search);
  const editing = editId === undefined ? undefined : data?.find((row) => row.id === editId);

  const deleteRequirements = useMutation(trpc.requirements.deleteRequirements.mutationOptions({
    meta: { successMessage: msg`Requirement deleted successfully.` },
  }));

  const columns: Array<ColumnDefWithOptionsHeader<RequirementRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 240,
      cell: ({ row }): ReactElement => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'interestedParty',
      accessorKey: 'interestedParty',
      header: t`Interested party`,
      size: 180,
    },
    {
      id: 'protects',
      header: t`Protects`,
      size: 220,
      cell: ({ row }): ReactElement => <Chips titles={protectedCriteria(row.original).map(securityCriterionLabel)} />,
    },
    {
      id: 'targets',
      header: t`Targets`,
      size: 280,
      cell: ({ row }): ReactElement => (
        <Chips
          titles={[
            ...row.original.primaryAssets.map((asset) => asset.name),
            ...row.original.businessValueCategories.map((category) => businessResourceName(category)),
          ]}
        />
      ),
    },
    {
      id: 'lossDrivers',
      header: t`Loss drivers`,
      size: 280,
      cell: ({ row }): ReactElement => <Chips titles={row.original.lossDrivers.map((driver) => driver.name)} />,
    },
    {
      id: 'description',
      header: t`Description`,
      cell: ({ row }): ReactElement => (
        <span className="text-default-secondary">{row.original.description ?? <EmptyValue />}</span>
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
        storageKey="requirements"
        initialColumnVisibility={{ description: false }}
        leftHeaderContent={(
          <DebouncedSearchField
            placeholder={t`Search requirements...`}
            value={filters.search}
            onCommit={(search) => setFilters({ search })}
            clearLabel={t`Clear search`}
            className="w-80"
          />
        )}
        onCreate={() => setCreateOpen(true)}
        onClickRow={(row) => openEdit(row.original.id)}
        onDeleteItems={(ids) => deleteRequirements.mutate(ids)}
      />

      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={() => {
          const id = confirm();
          if (id) {
            deleteRequirements.mutate([id]);
          }
        }}
        title={<Trans>Delete requirement</Trans>}
        description={<Trans>This will permanently delete this requirement. The scenarios that break it stop proposing its loss drivers. This action cannot be undone.</Trans>}
      />

      <RequirementDrawer organizationId={organizationId} open={createOpen} onClose={() => setCreateOpen(false)} />
      {editing !== undefined && (
        <RequirementDrawer organizationId={organizationId} requirement={editing} open onClose={closeEdit} />
      )}
    </>
  );
};
