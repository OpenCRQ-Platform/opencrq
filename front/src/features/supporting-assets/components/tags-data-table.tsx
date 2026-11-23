import { Chip } from '@filigran/design-system';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { EllipsisVertical, GitMerge, Pencil, Trash2, Undo2 } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { TagRow } from './tag-management-utils';
import { DebouncedSearchField } from '../../../components/shared/debounced-search-field';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useConfirmationDialog, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatList, resolveOptionFilter } from '../../../utils';
import { tagsListSearchSchema } from '../tags-list-search';
import { AssetTagChip } from './asset-chips';
import { TagMergeDialog } from './tag-merge-dialog';
import { buildTagRows, tagFamily, tagSourceOptions } from './tag-management-utils';
import { TagRenameDrawer } from './tag-rename-drawer';
import { connectorNamesHeader, sourceLabel, sourceLabelsOf } from './tag-source-labels';
import { TagUnmergeDialog } from './tag-unmerge-dialog';

type TagAction = { kind: 'rename' | 'merge' | 'unmerge', tagId: string };

export const TagsDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const { filters, setFilters } = useUrlListFilters(tagsListSearchSchema);
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;

  const { data: tags, isLoading } = useQuery(trpc.supportingAssets.listManagedTags.queryOptions());
  const sourceOptions = tags === undefined ? undefined : tagSourceOptions(tags);
  const resolvedSource = resolveOptionFilter(filters.source, sourceOptions, 'all');
  const rows = buildTagRows(tags ?? [], { search: filters.search, source: resolvedSource });

  const [action, setAction] = useState<TagAction | null>(null);
  const actionRow = action === null
    ? undefined
    : buildTagRows(tags ?? [], { search: '', source: 'all' }).find((row) => row.id === action.tagId);
  const closeAction = () => setAction(null);

  const deleteTag = useMutation(trpc.supportingAssets.deleteTag.mutationOptions({
    meta: { successMessage: msg`Tag deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const tagId = confirm();
    if (tagId) {
      deleteTag.mutate({ tagId });
    }
  };

  const pendingDelete = tags?.find((tag) => tag.id === confirmationDialog.pendingId);
  const name = pendingDelete?.name ?? '';
  const assetCount = pendingDelete?.assetCount ?? 0;
  const pendingFamily = tagFamily(tags ?? [], confirmationDialog.pendingId ?? '');
  const connector = [
    ...new Set(
      pendingFamily
        .flatMap((member) => member.sources)
        .flatMap((entry) => (entry.kind === 'connector' ? [sourceLabel(entry.source)] : [])),
    ),
  ].join(', ');
  const mergedNames = formatList(pendingFamily.slice(1).map((member) => member.name));
  const mergedCount = pendingFamily.length - 1;

  const columns: Array<ColumnDefWithOptionsHeader<TagRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      // The six columns add up to 648 px, the settings pane at a 1080 screen, so the table never scrolls
      // sideways there; a tag longer than the cell truncates inside its chip, whose DS tooltip shows it whole.
      size: 164,
      cell: ({ row }): ReactElement => (
        <AssetTagChip name={row.original.name} color={row.original.color} className="max-w-32" />
      ),
    },
    {
      id: 'connectorNames',
      accessorFn: (row) => row.connectorNames.map((entry) => entry.reportedName).join(', '),
      enableSorting: false,
      header: connectorNamesHeader(sourceOptions ?? []),
      size: 132,
      cell: ({ row }): ReactElement => {
        const names = row.original.connectorNames.map((entry) => entry.reportedName).join(', ');
        return names === '' ? <EmptyValue /> : <span title={names} className="text-muted-foreground">{names}</span>;
      },
    },
    {
      id: 'sources',
      accessorFn: (row) => sourceLabelsOf(row).join(','),
      enableSorting: false,
      header: t`Source`,
      size: 112,
      cell: ({ row }): ReactElement => (
        <div className="flex flex-wrap gap-1">
          {sourceLabelsOf(row.original).map((label) => <Chip key={label} label={label} />)}
        </div>
      ),
    },
    {
      id: 'mergedTags',
      accessorFn: (row) => row.mergedTags.map((merged) => merged.name).join(', '),
      enableSorting: false,
      header: t`Merged tags`,
      size: 112,
      cell: ({ row }): ReactElement => {
        const names = row.original.mergedTags.map((merged) => merged.name).join(', ');
        return names === '' ? <EmptyValue /> : <span title={names} className="text-muted-foreground">{names}</span>;
      },
    },
    {
      id: 'assetCount',
      accessorKey: 'assetCount',
      header: t`Assets`,
      size: 72,
      cell: ({ row }): ReactElement => <span>{row.original.assetCount}</span>,
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
            <IconActionsItem startIcon={<Pencil className="h-4 w-4" />} onClick={() => setAction({ kind: 'rename', tagId: row.original.id })}>
              {t`Rename`}
            </IconActionsItem>
            <IconActionsItem startIcon={<GitMerge className="h-4 w-4" />} onClick={() => setAction({ kind: 'merge', tagId: row.original.id })}>
              {t`Merge into…`}
            </IconActionsItem>
            {row.original.mergedTags.length > 0 && (
              <IconActionsItem startIcon={<Undo2 className="h-4 w-4" />} onClick={() => setAction({ kind: 'unmerge', tagId: row.original.id })}>
                {t`Undo a merge…`}
              </IconActionsItem>
            )}
            <IconActionsItem
              className="text-feedback-error-primary"
              startIcon={<Trash2 className="h-4 w-4 text-feedback-error-primary" />}
              onClick={() => requestConfirmation(row.original.id)}
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
        storageKey="tags"
        emptyState={tags?.length === 0
          ? (
            <ListEmptyCard
              title={<Trans>No tags yet</Trans>}
              body={<Trans>A tag shows up here as soon as an asset is tagged by hand or a connector reports one.</Trans>}
              actions={null}
            />
          )
          : undefined}
        leftHeaderContent={(
          <div className="flex flex-wrap items-center gap-3">
            <DebouncedSearchField
              placeholder={t`Search tags...`}
              value={filters.search}
              onCommit={(search) => setFilters({ search })}
              clearLabel={t`Clear search`}
              className="w-80"
            />
            <Select value={resolvedSource} onValueChange={(source) => setFilters({ source: tagsListSearchSchema.shape.source.parse(source) })}>
              <SelectTrigger className="w-56" aria-label={t`Filter by source`}>
                <SelectValue placeholder={t`Source: All sources`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><Trans>All sources</Trans></SelectItem>
                {(sourceOptions ?? []).map((source) => (
                  <SelectItem key={source} value={source}>{sourceLabel(source)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      />

      {actionRow !== undefined && action?.kind === 'rename' && (
        <TagRenameDrawer open onOpenChange={closeAction} tag={actionRow} tags={tags ?? []} />
      )}
      {actionRow !== undefined && action?.kind === 'merge' && (
        <TagMergeDialog open onOpenChange={closeAction} tag={actionRow} tags={tags ?? []} />
      )}
      {actionRow !== undefined && action?.kind === 'unmerge' && (
        <TagUnmergeDialog open onOpenChange={closeAction} tag={actionRow} />
      )}

      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete the tag “{name}”</Trans>}
        description={(
          <>
            {plural(assetCount, { one: 'This tag will be removed from # asset.', other: 'This tag will be removed from # assets.' })}
            {mergedCount > 0 && <>{' '}{plural(mergedCount, { one: `${mergedNames}, merged into it, is deleted too.`, other: `${mergedNames}, merged into it, are deleted too.` })}</>}
            {connector !== '' && <>{' '}<Trans>{connector} will recreate it at its next sync if it still reports it.</Trans></>}
          </>
        )}
      />
    </>
  );
};
