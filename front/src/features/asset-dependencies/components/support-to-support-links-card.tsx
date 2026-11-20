import { DataTable, DataTableHeadBarOptions } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { EllipsisVertical } from 'lucide-react';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { getSortedRowModel } from '@tanstack/react-table';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { useConfirmationDialog } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { useTenant } from '../../../providers/tenant-provider';
import { SectionCard } from '../../../components';
import { AssetName } from '../../../components/shared/asset-name';
import { getDataTableI18nKey } from '../../../components/ui/data-table-i18n';
import { assetNameText } from '../../../utils/asset-name-utils';
import { withTextAwareSorting } from '../../../utils/table-sorting-utils';

interface UnifiedLink {
  id: string,
  direction: 'provides' | 'depends',
  relatedAssetId: string,
  relatedAssetName: string | null,
  relatedAssetDerivedName: string | null,
}

interface SupportToSupportLinksCardProps {
  assetId: string,
}

export const SupportToSupportLinksCard: FunctionComponent<SupportToSupportLinksCardProps> = ({ assetId }) => {
  const trpc = useTRPC();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const confirmationDialog = useConfirmationDialog();

  const { data: links } = useQuery(trpc.assetDependencies.getSupportToSupportLinks.queryOptions({ assetId }));

  const deleteLinks = useMutation(trpc.assetDependencies.deleteSupportToSupportLinks.mutationOptions({
    meta: { successMessage: msg`Dependency deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirmationDialog.confirm();
    if (id) {
      deleteLinks.mutate([id]);
    }
  };

  const unnamedAsset = t`Unnamed asset`;
  const columns: Array<ColumnDefWithOptionsHeader<UnifiedLink, unknown>> = [
    {
      id: 'relationship',
      header: t`Relationship`,
      cell: ({ row }): ReactElement => {
        const arrow = row.original.direction === 'provides' ? '→' : '←';
        const label = row.original.direction === 'provides' ? t`Provides` : t`Depends on`;
        return (
          <span className="flex items-center gap-1.5">
            <span className="txt-default text-muted-foreground">{arrow}</span>
            <span>{label}</span>
          </span>
        );
      },
    },
    {
      id: 'relatedAsset',
      header: t`Related Asset`,
      accessorFn: (link) => assetNameText({ name: link.relatedAssetName, derivedName: link.relatedAssetDerivedName }, unnamedAsset),
      cell: ({ row }): ReactElement => (
        <AssetName name={row.original.relatedAssetName} derivedName={row.original.relatedAssetDerivedName} />
      ),
    },
    {
      id: 'actions',
      header: '',
      size: 50,
      cell: ({ row }): ReactElement => (
        <div
          className="flex items-center justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem onClick={() => confirmationDialog.requestConfirmation(row.original.id)}>
              {t`Delete`}
            </IconActionsItem>
          </IconActions>
        </div>
      ),
    },
  ];

  const handleClickRow = (row: { original: UnifiedLink }) => {
    void navigate({
      to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId',
      params: { tenantId, supportingAssetId: row.original.relatedAssetId },
    });
  };

  return (
    <>
      <SectionCard title={t`Support-to-Support Dependencies`}>
        <DataTable
          i18nKey={getDataTableI18nKey()}
          data={links ?? []}
          columns={withTextAwareSorting(columns)}
          toolbar={(
            <div className="flex items-center justify-end gap-2">
              <DataTableHeadBarOptions />
            </div>
          )}
          tableOptions={{
            getSortedRowModel: getSortedRowModel(),
          }}
          onClickRow={handleClickRow}
        />
      </SectionCard>

      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete dependency</Trans>}
        description={<Trans>Are you sure you want to delete this dependency? This action cannot be undone.</Trans>}
      />
    </>
  );
};
