import { Button, Chip } from '@filigran/design-system';
import { EllipsisVertical } from 'lucide-react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { EstateMode, RevenueBand } from '@app/module/client';
import { useNavigate, useParams } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { CurrentMark } from '../../../components';
import { DataPageWithCards } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { useConfirmationDialog } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatCompactCount, formatRevenueBand, isCurrentEntry } from '../../../utils';
import { estateLabel } from '../estate-label';
import { useOpenScopeWizard } from '../use-open-scope-wizard';
import { useScopePins } from '../use-scope-pins';
import { OrganizationCard } from './organization-card';
import { PerimeterEmptyActionLabel, PerimeterEmptyBody, PerimeterEmptyTitle } from './perimeter-empty-copy';
import { ScopePinButton } from './scope-pin-button';

interface Organization {
  id: string,
  name: string,
  description: string | null,
  employeeCount: number | null,
  revenueBand: RevenueBand | null,
  estateMode: EstateMode,
  mappedAssetCount: number,
  sector: { id: string, name: string } | null,
  country: { id: string, name: string } | null,
}

export const OrganizationsDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { organizationId } = useParams({ strict: false });
  const confirmDialog = useConfirmationDialog();
  const { isPinned, setPinned } = useScopePins();
  const { confirm, requestConfirmation } = confirmDialog;

  const { data, isLoading } = useQuery(trpc.organizations.getOrganizations.queryOptions());

  const deleteOrganizations = useMutation(trpc.organizations.deleteOrganizations.mutationOptions({
    meta: { successMessage: msg`Risk scope deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deleteOrganizations.mutate([id]);
    }
  };

  const openScopeWizard = useOpenScopeWizard();

  const columns: Array<ColumnDefWithOptionsHeader<Organization, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 200,
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-2 font-medium">
          {row.original.name}
          {isCurrentEntry(row.original.id, organizationId) && <CurrentMark label={t`Current scope`} />}
        </span>
      ),
    },
    {
      id: 'estate',
      header: t`Estate`,
      enableSorting: false,
      size: 160,
      cell: ({ row }): ReactElement => <Chip label={estateLabel(row.original)} />,
    },
    {
      id: 'sector',
      header: t`Sector`,
      size: 160,
      cell: ({ row }): ReactElement => (
        <span>{row.original.sector?.name ?? <EmptyValue />}</span>
      ),
    },
    {
      id: 'country',
      header: t`Country`,
      size: 140,
      cell: ({ row }): ReactElement => (
        <span>{row.original.country?.name ?? <EmptyValue />}</span>
      ),
    },
    {
      id: 'employeeCount',
      header: t`Employees`,
      size: 100,
      cell: ({ row }): ReactElement => (
        <span>{formatCompactCount(row.original.employeeCount)}</span>
      ),
    },
    {
      id: 'revenueBand',
      header: t`Revenue`,
      size: 120,
      cell: ({ row }): ReactElement => (
        <span>{formatRevenueBand(row.original.revenueBand)}</span>
      ),
    },
    {
      id: 'actions',
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => (
        <div className="flex items-center justify-end gap-2">
          <ScopePinButton
            pinned={isPinned(row.original.id)}
            onToggle={(pinned) => setPinned(row.original.id, pinned)}
          />
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

  const handleNavigate = (id: string) => {
    void navigate({
      to: '/$tenantId/{-$organizationId}',
      params: (prev) => ({ ...prev, tenantId: prev.tenantId!, organizationId: id }),
    });
  };

  return (
    <>
      <DataPageWithCards
        data={data ?? []}
        columns={columns}
        isLoading={isLoading}
        storageKey="organizations"
        defaultView="grid"
        onCreate={openScopeWizard}
        onClickRow={(row) => handleNavigate(row.original.id)}
        onDeleteItems={(ids) => deleteOrganizations.mutate(ids)}
        emptyState={(
          <ListEmptyCard
            title={<PerimeterEmptyTitle />}
            body={<PerimeterEmptyBody />}
            actions={(
              <Button onClick={openScopeWizard}>
                <PerimeterEmptyActionLabel />
              </Button>
            )}
          />
        )}
        renderCard={(org) => (
          <OrganizationCard
            key={org.id}
            id={org.id}
            name={org.name}
            description={org.description ?? null}
            sector={org.sector ?? null}
            country={org.country ?? null}
            employeeCount={org.employeeCount ?? null}
            revenueBand={org.revenueBand ?? null}
            estate={estateLabel(org)}
            onDelete={(id) => requestConfirmation(id)}
            onNavigate={handleNavigate}
            pinned={isPinned(org.id)}
            onPinnedChange={(pinned) => setPinned(org.id, pinned)}
            isCurrent={isCurrentEntry(org.id, organizationId)}
          />
        )}
      />
      <DeleteConfirmDialog
        open={confirmDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete risk scope</Trans>}
        description={<Trans>This will permanently delete this risk scope and all associated data. This action cannot be undone.</Trans>}
      />
    </>
  );
};
