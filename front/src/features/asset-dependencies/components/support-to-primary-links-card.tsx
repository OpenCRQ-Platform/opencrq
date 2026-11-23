import type { AssetCategory, SupportToPrimaryLinkRole, SupportToPrimaryLinkSource } from '@app/module/client';
import { inheritedCriteriaOfRoles } from '@app/module/client';
import { Chip } from '@filigran/design-system';
import { DataTable, DataTableHeadBarOptions } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { EllipsisVertical } from 'lucide-react';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { getSortedRowModel } from '@tanstack/react-table';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { EditedSupportToPrimaryLink } from './support-to-primary-link-edit-sheet';
import type { AssetNameParts } from '../../../utils/asset-name-utils';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { AssetName } from '../../../components/shared/asset-name';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { useConfirmationDialog } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { SectionCard } from '../../../components';
import { EmptyValue } from '../../../components/ui/empty-value';
import { getAssetCategoryLabel } from '../../../utils';
import { assetNameText } from '../../../utils/asset-name-utils';
import { withTextAwareSorting } from '../../../utils/table-sorting-utils';
import { useTenant } from '../../../providers/tenant-provider';
import { getDataTableI18nKey } from '../../../components/ui/data-table-i18n';
import { InheritedCriteriaLegend, InheritedCriteriaTiles, LinkRoleChips } from './link-role-display';
import { SupportToPrimaryLinkEditSheet } from './support-to-primary-link-edit-sheet';

interface LinkRow {
  id: string,
  roles: Array<SupportToPrimaryLinkRole>,
  source: SupportToPrimaryLinkSource,
  ruleName: string | null,
  supportingAssetId?: string,
  supportingAssetName?: string | null,
  supportingAssetDerivedName?: string | null,
  supportingAssetCategoryId?: AssetCategory | null,
  primaryAssetId?: string,
  primaryAssetName?: string | null,
  organizationName?: string | null,
}

interface SupportToPrimaryLinksCardProps {
  primaryAssetId?: string,
  supportingAssetId?: string,
  assetName: string,
}

export const SupportToPrimaryLinksCard: FunctionComponent<SupportToPrimaryLinksCardProps> = ({
  primaryAssetId,
  supportingAssetId,
  assetName,
}) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { tenantId } = useTenant();
  const [editedLink, setEditedLink] = useState<EditedSupportToPrimaryLink | null>(null);
  const navigate = useNavigate();
  const confirmationDialog = useConfirmationDialog();

  const { data: linksByPrimary } = useQuery(trpc.assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId.queryOptions(
    { primaryAssetId: primaryAssetId! },
    { enabled: !!primaryAssetId },
  ));
  const { data: linksBySupporting } = useQuery(trpc.assetDependencies.getSupportToPrimaryLinksBySupportingAssetId.queryOptions(
    { supportingAssetId: supportingAssetId! },
    { enabled: !!supportingAssetId },
  ));

  const deleteLinks = useMutation(trpc.assetDependencies.deleteSupportToPrimaryLinks.mutationOptions({
    meta: { successMessage: msg`Dependency deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirmationDialog.confirm();
    if (id) {
      deleteLinks.mutate([id]);
    }
  };

  const links = (primaryAssetId ? linksByPrimary : linksBySupporting) as Array<LinkRow> | undefined;
  const pendingLink = links?.find((link) => link.id === confirmationDialog.pendingId);
  const pendingRuleName = pendingLink?.source === 'rule' ? pendingLink.ruleName : null;

  const unnamedAsset = t`Unnamed asset`;
  const relatedAssetParts = (row: LinkRow): AssetNameParts => (primaryAssetId
    ? { name: row.supportingAssetName ?? null, derivedName: row.supportingAssetDerivedName ?? null }
    : { name: row.primaryAssetName ?? null, derivedName: null });
  const relatedAssetName = (row: LinkRow): string => assetNameText(relatedAssetParts(row), unnamedAsset);

  const openEdit = (row: LinkRow) => {
    const related = relatedAssetName(row);
    setEditedLink({
      id: row.id,
      roles: row.roles,
      supportingAssetName: primaryAssetId ? related : assetName,
      primaryAssetName: primaryAssetId ? assetName : related,
    });
  };

  const columns: Array<ColumnDefWithOptionsHeader<LinkRow, unknown>> = [
    {
      id: 'relatedAsset',
      header: t`Related Asset`,
      accessorFn: relatedAssetName,
      cell: ({ row }): ReactElement => {
        const { supportingAssetCategoryId } = row.original;
        const { name, derivedName } = relatedAssetParts(row.original);
        return (
          <span className="flex flex-col">
            <AssetName name={name} derivedName={derivedName} />
            {supportingAssetCategoryId != null && (
              <span className="text-muted-foreground txt-sub-content">
                {getAssetCategoryLabel(supportingAssetCategoryId)}
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: 'roles',
      header: t`Role`,
      cell: ({ row }): ReactElement => <LinkRoleChips roles={row.original.roles} />,
    },
    {
      id: 'source',
      header: t`Linked by`,
      accessorFn: (row) => (row.source === 'rule' ? row.ruleName ?? '' : ''),
      size: 170,
      cell: ({ row }): ReactElement => (row.original.source === 'rule'
        ? <Chip label={t`Rule: ${row.original.ruleName ?? t`deleted rule`}`} severity="info" />
        : <span className="text-muted-foreground">{t`Hand`}</span>),
    },
    {
      id: 'inheritedCriteria',
      header: (): ReactElement => (
        <span className="flex items-center gap-1.5">
          {t`Inherited criteria`}
          <InheritedCriteriaLegend />
        </span>
      ),
      size: 170,
      cell: ({ row }): ReactElement => <InheritedCriteriaTiles criteria={inheritedCriteriaOfRoles(row.original.roles)} />,
    },
    ...(supportingAssetId
      ? [{
        id: 'organization',
        header: t`Risk scope`,
        cell: ({ row }: { row: { original: LinkRow } }): ReactElement => (
          <span className="text-muted-foreground">{row.original.organizationName ?? <EmptyValue />}</span>
        ),
      }]
      : []),
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
            <IconActionsItem onClick={() => openEdit(row.original)}>
              {t`Edit`}
            </IconActionsItem>
            <IconActionsItem onClick={() => confirmationDialog.requestConfirmation(row.original.id)}>
              {t`Delete`}
            </IconActionsItem>
          </IconActions>
        </div>
      ),
    },
  ];

  const handleClickRow = async (row: { original: LinkRow }) => {
    if (primaryAssetId && row.original.supportingAssetId) {
      void navigate({
        to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId',
        params: { tenantId, supportingAssetId: row.original.supportingAssetId },
      });
    } else if (supportingAssetId && row.original.primaryAssetId) {
      try {
        const primaryAsset = await queryClient.query(trpc.primaryAssets.getPrimaryAsset.queryOptions({ id: row.original.primaryAssetId }));
        if (primaryAsset) {
          void navigate({
            to: '/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId',
            params: { tenantId, organizationId: primaryAsset.organizationId, primaryAssetId: row.original.primaryAssetId },
          });
        }
      } catch {
        // Navigation failure is non-critical
      }
    }
  };

  return (
    <>
      <SectionCard title={t`Support-to-Primary Dependencies`}>
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
      <SupportToPrimaryLinkEditSheet link={editedLink} onClose={() => setEditedLink(null)} />

      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete dependency</Trans>}
        description={pendingRuleName === null
          ? <Trans>Are you sure you want to delete this dependency? This action cannot be undone.</Trans>
          : <Trans>The rule “{pendingRuleName}” wrote this dependency. Once you delete it, the rule never links these two assets again.</Trans>}
      />
    </>
  );
};
