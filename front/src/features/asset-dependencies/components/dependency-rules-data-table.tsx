import { Chip } from '@filigran/design-system';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EllipsisVertical, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { DependencyRule } from '../dependency-rules-utils';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { useConfirmationDialog } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { getAssetCategoryLabel, getAssetSubcategoryLabel } from '../../../utils';
import { getConnectorNameBySource } from '../../integrations';
import { conditionsDraftOf, conditionSummaries, toConditionsInput } from '../dependency-rules-utils';
import { DependencyRuleDrawer } from './dependency-rule-drawer';
import { LinkRoleChips } from './link-role-display';

type Editor = { rule: DependencyRule | null } | null;

export const DependencyRulesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data: rules, isLoading } = useQuery(trpc.assetDependencies.listDependencyRules.queryOptions());
  const [editor, setEditor] = useState<Editor>(null);
  const confirmationDialog = useConfirmationDialog();

  const deleteRules = useMutation(trpc.assetDependencies.deleteDependencyRules.mutationOptions({
    meta: { successMessage: msg`Rule deleted. Its links are removed; links made by hand stay.` },
  }));
  const updateRule = useMutation(trpc.assetDependencies.updateDependencyRule.mutationOptions({
    meta: { successMessage: msg`Rule updated. Its links are rewritten in the background.` },
  }));

  const toggle = (rule: DependencyRule) => {
    updateRule.mutate({
      id: rule.id,
      name: rule.name,
      primaryAssetId: rule.primaryAssetId,
      roles: rule.roles,
      enabled: !rule.enabled,
      ...toConditionsInput(conditionsDraftOf(rule)),
    });
  };

  const handleDeleteConfirm = () => {
    const id = confirmationDialog.confirm();
    if (id) {
      deleteRules.mutate([id]);
    }
  };

  const labels = {
    category: getAssetCategoryLabel,
    subcategory: getAssetSubcategoryLabel,
    source: (source: string) => {
      const connector = getConnectorNameBySource(source) ?? source;
      return t`Reported by ${connector}`;
    },
    glob: (pattern: string) => t`Name ${pattern}`,
    regex: (pattern: string) => t`Name matches /${pattern}/`,
    tag: (name: string) => t`Tag ${name}`,
  };

  const columns: Array<ColumnDefWithOptionsHeader<DependencyRule, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 220,
      cell: ({ row }): ReactElement => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'conditions',
      accessorFn: (row) => conditionSummaries(row, labels).join(', '),
      enableSorting: false,
      header: t`Conditions`,
      size: 300,
      cell: ({ row }): ReactElement => (
        <div className="flex flex-wrap gap-1">
          {conditionSummaries(row.original, labels).map((summary) => <Chip key={summary} label={summary} />)}
        </div>
      ),
    },
    {
      id: 'primaryAssetName',
      accessorKey: 'primaryAssetName',
      header: t`Primary asset`,
      size: 220,
    },
    {
      id: 'roles',
      enableSorting: false,
      header: t`Role`,
      size: 200,
      cell: ({ row }): ReactElement => <LinkRoleChips roles={row.original.roles} />,
    },
    {
      id: 'linkCount',
      accessorKey: 'linkCount',
      header: t`Links`,
      size: 90,
    },
    {
      id: 'enabled',
      accessorFn: (row) => (row.enabled ? 1 : 0),
      header: t`Status`,
      size: 110,
      cell: ({ row }): ReactElement => (row.original.enabled
        ? <Chip label={t`Enabled`} severity="low" />
        : <Chip label={t`Disabled`} />),
    },
    {
      id: 'actions',
      header: '',
      size: 56,
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => (
        <div className="flex items-center justify-end">
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem startIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditor({ rule: row.original })}>
              {t`Edit`}
            </IconActionsItem>
            <IconActionsItem
              startIcon={row.original.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              onClick={() => toggle(row.original)}
            >
              {row.original.enabled ? t`Disable` : t`Enable`}
            </IconActionsItem>
            <IconActionsItem
              className="text-feedback-error-primary"
              startIcon={<Trash2 className="h-4 w-4 text-feedback-error-primary" />}
              onClick={() => confirmationDialog.requestConfirmation(row.original.id)}
            >
              {t`Delete`}
            </IconActionsItem>
          </IconActions>
        </div>
      ),
    },
  ];

  const pendingDelete = rules?.find((rule) => rule.id === confirmationDialog.pendingId);
  const pendingName = pendingDelete?.name ?? '';

  return (
    <>
      <DataPageLayout
        data={rules ?? []}
        columns={columns}
        isLoading={isLoading}
        storageKey="dependency-rules"
        fixedColumnWidths
        initialSorting={[{ id: 'name', desc: false }]}
        onCreate={() => setEditor({ rule: null })}
        onClickRow={({ original }) => setEditor({ rule: original })}
        emptyState={(
          <ListEmptyCard
            title={<Trans>No dependency rules yet</Trans>}
            body={<Trans>A rule links the supporting assets that match its conditions to a primary asset, now and at every sync. A link made or removed by hand always wins.</Trans>}
            actions={null}
          />
        )}
      />
      <DependencyRuleDrawer open={editor !== null} rule={editor?.rule ?? null} onClose={() => setEditor(null)} />
      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete the rule “{pendingName}”</Trans>}
        description={<Trans>The links this rule wrote are removed. Links a person made stay.</Trans>}
      />
    </>
  );
};
