import { Chip, Icon } from '@filigran/design-system';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { DependencyRule } from '../dependency-rules-utils';
import { DetailPageLayout, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { useConfirmationDialog } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { getAssetCategoryLabel, getAssetSubcategoryLabel } from '../../../utils';
import { getConnectorNameBySource } from '../../integrations';
import { conditionsDraftOf, conditionSummaries, toConditionsInput } from '../dependency-rules-utils';
import { getLinkRoleLabel } from '../link-role-labels';
import { DependencyRuleDrawer } from './dependency-rule-drawer';
import { RULE_COLUMN_SIZES } from './dependency-rules-table-columns';
import { OneLineChips } from './one-line-chips';

/** A value cut with an ellipsis when wider than its column, shown whole in the shared tooltip. */
const CutText = ({ value, className }: { value: string, className?: string }): ReactElement => (
  <TooltipHint hint={value}>
    <span className={`block min-w-0 truncate ${className ?? ''}`}>{value}</span>
  </TooltipHint>
);

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
      size: RULE_COLUMN_SIZES.name,
      cell: ({ row }): ReactElement => <CutText value={row.original.name} className="font-medium" />,
    },
    {
      id: 'conditions',
      accessorFn: (row) => conditionSummaries(row, labels).join(', '),
      enableSorting: false,
      header: t`Conditions`,
      size: RULE_COLUMN_SIZES.conditions,
      cell: ({ row }): ReactElement => (
        <OneLineChips items={conditionSummaries(row.original, labels).map((summary) => ({ key: summary, label: summary }))} />
      ),
    },
    {
      id: 'primaryAssetName',
      accessorKey: 'primaryAssetName',
      header: t`Primary asset`,
      size: RULE_COLUMN_SIZES.primaryAssetName,
      cell: ({ row }): ReactElement => <CutText value={row.original.primaryAssetName} />,
    },
    {
      id: 'roles',
      enableSorting: false,
      header: t`Role`,
      size: RULE_COLUMN_SIZES.roles,
      cell: ({ row }): ReactElement => (
        <OneLineChips items={row.original.roles.map((role) => ({ key: role, label: getLinkRoleLabel(role) }))} />
      ),
    },
    {
      id: 'linkCount',
      accessorKey: 'linkCount',
      header: t`Links`,
      size: RULE_COLUMN_SIZES.linkCount,
    },
    {
      id: 'enabled',
      accessorFn: (row) => (row.enabled ? 1 : 0),
      header: t`Status`,
      size: RULE_COLUMN_SIZES.enabled,
      cell: ({ row }): ReactElement => (row.original.enabled
        ? <Chip label={t`Enabled`} severity="low" />
        : <Chip label={t`Disabled`} />),
    },
    {
      id: 'actions',
      header: '',
      size: RULE_COLUMN_SIZES.actions,
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => (
        <div className="flex items-center justify-end">
          <IconActions icon={<Icon name="ellipsis-vertical" size={16} className="text-primary" />}>
            <IconActionsItem startIcon={<Icon name="pencil" size={16} />} onClick={() => setEditor({ rule: row.original })}>
              {t`Edit`}
            </IconActionsItem>
            <IconActionsItem
              startIcon={<Icon name={row.original.enabled ? 'circle-stop' : 'play'} size={16} />}
              onClick={() => toggle(row.original)}
            >
              {row.original.enabled ? t`Disable` : t`Enable`}
            </IconActionsItem>
            <IconActionsItem
              className="text-feedback-error-primary"
              startIcon={<Icon name="trash-2" size={16} className="text-feedback-error-primary" />}
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
    <DetailPageLayout title={t`Dependency Rules`}>
      <p className="txt-sub-content text-muted-foreground">
        <Trans>A rule links the supporting assets that match its conditions to a primary asset, now and at every sync. A link made or removed by hand always wins.</Trans>
      </p>
      <TooltipHintProvider>
        <DataPageLayout
          data={rules ?? []}
          columns={columns}
          isLoading={isLoading}
          storageKey="dependency-rules"
          search={{ placeholder: t`Search rules...`, texts: (rule) => [rule.name, rule.primaryAssetName] }}
          filters={[{
            id: 'status',
            label: t`Status`,
            allLabel: t`All statuses`,
            options: [{ value: 'enabled', label: t`Enabled` }, { value: 'disabled', label: t`Disabled` }],
            valueOf: (rule) => (rule.enabled ? 'enabled' : 'disabled'),
          }]}
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
      </TooltipHintProvider>
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
    </DetailPageLayout>
  );
};
