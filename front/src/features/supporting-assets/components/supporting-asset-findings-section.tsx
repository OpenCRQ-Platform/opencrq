import { Chip } from '@filigran/design-system';
import { FINDINGS_SEARCH_MAX_LENGTH } from '@app/module/client';
import type { ExpectationType } from '@app/module/client';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { EllipsisVertical, Trash2 } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FindingTableRow } from '../../findings-home';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { useConfirmationDialog } from '../../../hooks/utils/use-confirmation-dialog';
import { usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../hooks';
import { DebouncedSearchField, SectionCard } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { dismissedStateFilterLabel } from '../../finding-detail/dismissal-vocabulary';
import { findingsTableColumns, toFindingSort, toFindingTableRow } from '../../findings-home';
import { useTRPC } from '../../../lib';
import { isEvidenceStateFilter } from '../../../utils';
import { supportingAssetFindingsListSearchSchema } from '../supporting-asset-findings-list-search';
import { ApplicableFindingsLifelineCard } from './applicable-findings-lifeline-card';
import { AttachCveDrawer } from './attach-cve-drawer';
import { EvidenceStateDialog } from './evidence-state-dialog';
import { FindingsActivityChart } from './findings-activity-chart';

const TABLE_ID = 'supportingAsset.findingsTable';
const PAGE_LIMIT = 50;
const DEFAULT_SORTING = [{ id: 'score', desc: true }];

interface AssetFindingRow extends FindingTableRow {
  sourceCount: number,
}

const resultsFilterLabel = (technique: string | undefined, expectation: ExpectationType | undefined): string => {
  if (technique === undefined) {
    return expectation === 'detection' ? t`Detection results` : t`Prevention results`;
  }
  switch (expectation) {
    case 'prevention': return t`Prevention results on ${technique}`;
    case 'detection': return t`Detection results on ${technique}`;
    case undefined: return t`Results on ${technique}`;
  }
};

interface SupportingAssetFindingsSectionProps {
  supportingAssetId: string,
}

export const SupportingAssetFindingsSection: FunctionComponent<SupportingAssetFindingsSectionProps> = ({
  supportingAssetId,
}) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { filters, setFilters } = useUrlListFilters(supportingAssetFindingsListSearchSchema);
  const [attachCveOpen, setAttachCveOpen] = useState(false);
  const [stateDialog, setStateDialog] = useState<{
    evidenceId: string,
    targetState: 'applicable' | 'dismissed',
  } | null>(null);
  const deleteConfirmation = useConfirmationDialog();

  const deleteEvidence = useMutation(trpc.supportingAssets.deleteAssetEvidence.mutationOptions({
    meta: { successMessage: msg`Finding deleted successfully.` },
  }));

  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;
  const search = filters.search.trim();

  const { data: findingPage, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.findingScore.listAssetFindings.queryOptions(
    {
      supportingAssetId,
      page,
      limit: pageSize,
      state: filters.state === 'all' ? null : filters.state,
      mitreTechniqueExternalId: filters.technique ?? null,
      expectationType: filters.expectation ?? null,
      search: search === '' ? null : search,
      ...toFindingSort(activeSort),
    },
    { placeholderData: keepPreviousData },
  ));
  const rows: Array<AssetFindingRow> = (findingPage?.items ?? []).map((finding) => ({
    ...toFindingTableRow(finding),
    sourceCount: finding.sourceCount,
  }));

  const columns: Array<ColumnDefWithOptionsHeader<AssetFindingRow, unknown>> = [
    ...findingsTableColumns<AssetFindingRow>({ showState: filters.state !== 'applicable', showAsset: false }),
    {
      id: 'actions',
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => {
        const current = row.original.currentState;
        const toggleTarget = current === 'applicable' ? 'dismissed' : 'applicable';
        const toggleLabel = current === 'applicable' ? t({ message: 'Set aside', context: 'action' }) : t`Mark applicable`;
        return (
          <div className="flex items-center justify-end">
            <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
              <IconActionsItem
                onClick={(e) => {
                  e.stopPropagation();
                  setStateDialog({ evidenceId: row.original.id, targetState: toggleTarget });
                }}
              >
                {toggleLabel}
              </IconActionsItem>
              {row.original.sourceCount === 0 && (
                <IconActionsItem
                  className="text-feedback-error-primary"
                  startIcon={<Trash2 className="h-4 w-4 text-feedback-error-primary" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConfirmation.requestConfirmation(row.original.id);
                  }}
                >
                  {t`Delete`}
                </IconActionsItem>
              )}
            </IconActions>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-stretch gap-4">
        <div className="flex min-w-0 flex-[0_1_auto] flex-col gap-2">
          <p className="txt-sub-content">{t`Applicable findings over time (last year)`}</p>
          <div className="flex-1 overflow-x-auto px-4 py-3 rounded-md border bg-card">
            <FindingsActivityChart assetId={supportingAssetId} />
          </div>
        </div>
        <ApplicableFindingsLifelineCard assetId={supportingAssetId} className="min-w-0 flex-[1_1_22rem]" />
      </div>
      <SectionCard title={t`Findings`}>
        <DataPageLayout
          data={rows}
          total={findingPage?.total ?? 0}
          columns={columns}
          isLoading={isLoading}
          isPlaceholderData={isPlaceholderData}
          isFetching={isFetching}
          storageKey={TABLE_ID}
          initialPageSize={PAGE_LIMIT}
          initialSorting={DEFAULT_SORTING}
          pageIndex={page - 1}
          serverSorted
          onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
          onCreate={() => setAttachCveOpen(true)}
          leftHeaderContent={(
            <div className="flex flex-wrap items-center gap-3">
              <DebouncedSearchField
                placeholder={t`Search findings...`}
                value={filters.search}
                onCommit={(committed) => {
                  setFilters({ search: committed });
                  setPage(1);
                }}
                clearLabel={t`Clear search`}
                maxLength={FINDINGS_SEARCH_MAX_LENGTH}
                className="w-80"
              />
              <Select
                value={filters.state}
                onValueChange={(value) => {
                  if (isEvidenceStateFilter(value)) {
                    setFilters({ state: value });
                    // Page 3 of the old filter is a slice of a list that no longer exists.
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-80" aria-label={t`Filter by state`}>
                  <SelectValue placeholder={t`Filter by state`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="applicable"><Trans>Applicable</Trans></SelectItem>
                  <SelectItem value="dismissed">{dismissedStateFilterLabel('both')}</SelectItem>
                  <SelectItem value="all"><Trans>All states</Trans></SelectItem>
                </SelectContent>
              </Select>
              {(filters.technique !== undefined || filters.expectation !== undefined) && (
                <Chip
                  label={resultsFilterLabel(filters.technique, filters.expectation)}
                  onDelete={() => {
                    setFilters({ technique: undefined, expectation: undefined });
                    setPage(1);
                  }}
                  deleteLabel={t`Clear the technique filter`}
                />
              )}
            </div>
          )}
          onClickRow={(row) => {
            void navigate({
              from: '/$tenantId/{-$organizationId}/assets/$supportingAssetId/findings',
              to: '/$tenantId/{-$organizationId}/findings/$evidenceId',
              params: { evidenceId: row.original.id },
            });
          }}
        />
      </SectionCard>

      <AttachCveDrawer
        open={attachCveOpen}
        onClose={() => setAttachCveOpen(false)}
        supportingAssetId={supportingAssetId}
      />

      {stateDialog && (
        <EvidenceStateDialog
          open={stateDialog !== null}
          onOpenChange={(open) => {
            if (!open) {
              setStateDialog(null);
            }
          }}
          evidenceId={stateDialog.evidenceId}
          targetState={stateDialog.targetState}
        />
      )}

      <DeleteConfirmDialog
        open={deleteConfirmation.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            deleteConfirmation.cancel();
          }
        }}
        onConfirm={() => {
          const evidenceId = deleteConfirmation.confirm();
          if (evidenceId) {
            deleteEvidence.mutate({ evidenceId });
          }
        }}
        title={<Trans>Delete finding</Trans>}
        description={(
          <Trans>
            No connector reports this finding, so deleting it drops it for good, along with its
            history and its score.
          </Trans>
        )}
      />
    </>
  );
};
