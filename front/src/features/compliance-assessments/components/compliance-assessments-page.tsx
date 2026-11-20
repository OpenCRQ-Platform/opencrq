import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button, Chip } from '@filigran/design-system';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, useNavigate } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { AssessmentListRow, AssessmentSource } from '../compliance-assessments-utils';
import { DebouncedSearchField } from '../../../components/shared';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useConfirmationDialog, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatDate } from '../../../utils';
import { ReadinessBar } from '../../drata';
import { readinessFromCounts } from '../../drata/drata-utils';
import { complianceAssessmentsListSearchSchema } from '../compliance-assessments-list-search';
import { ASSESSMENT_SOURCES, completedCount, filterAssessments, filterBySource, toAssessmentListRows } from '../compliance-assessments-utils';
import { AssessmentProgress } from '../ui/assessment-progress';
import { AssessmentStatusChip, MeanMaturityChip } from '../ui/maturity-chips';
import { listRowStatusLabel } from '../ui/maturity-labels';
import { ComplianceAssessmentCreateDrawer } from './compliance-assessment-create-drawer';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type AssessmentRow = AssessmentListRow<
  RouterOutputs['complianceAssessments']['getAssessments'][number],
  RouterOutputs['drata']['getFrameworks'][number]
>;

const sourceLabel = (source: AssessmentSource): string => (source === 'opencrq' ? t`OpenCRQ` : t`Drata`);

const drataReadiness =(framework: RouterOutputs['drata']['getFrameworks'][number]) => readinessFromCounts({
  total: framework.derivedTotalRequirements,
  inScope: framework.derivedInScopeRequirements,
  readyInScope: framework.derivedReadyInScopeRequirements,
});

const progressSortValue = (row: AssessmentRow): number | undefined => {
  if (row.source === 'opencrq') {
    return completedCount(row.assessment.maturity) / Math.max(row.assessment.maturity.requirementCount, 1);
  }
  const { percent } = drataReadiness(row.framework);
  return percent === null ? undefined : percent / 100;
};

const DrataReadinessCell: FunctionComponent<{ framework: RouterOutputs['drata']['getFrameworks'][number] }> = ({ framework }) => {
  const readiness = drataReadiness(framework);
  const { percent } = readiness;
  return (
    <span className="flex items-center gap-2.5">
      <span className="w-36">
        <ReadinessBar variant="mini" ready={readiness.readyInScope} notReady={readiness.notReadyInScope} outOfScope={readiness.outOfScope} />
      </span>
      <span className="txt-sub-content tabular-nums whitespace-nowrap text-default-secondary">
        {percent === null ? <Trans>Nothing in scope</Trans> : <Trans>{percent}% ready</Trans>}
      </span>
    </span>
  );
};

const AssessmentRowActions: FunctionComponent<{ published: boolean, onDelete: () => void }> = ({ published, onDelete }) => (
  <div className="flex items-center justify-end">
    <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
      <IconActionsItem
        disabled={published}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        {published
          ? (
            <span className="flex flex-col">
              <span>{t`Delete`}</span>
              <span className="txt-sub-content">{t`Reopen the assessment first`}</span>
            </span>
          )
          : t`Delete`}
      </IconActionsItem>
    </IconActions>
  </div>
);

export const ComplianceAssessmentsPage: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [isCreateOpen, setCreateOpen] = useState(false);
  const { confirm, requestConfirmation, isOpen: isDeleteOpen, cancel: cancelDelete } = useConfirmationDialog();
  const deleteAssessment = useMutation(trpc.complianceAssessments.deleteAssessment.mutationOptions({
    meta: { successMessage: msg`Assessment deleted successfully.` },
  }));
  const { data: assessmentsData, isLoading: isLoadingAssessments } = useQuery(trpc.complianceAssessments.getAssessments.queryOptions());
  const { data: frameworksData, isLoading: isLoadingFrameworks } = useQuery(trpc.drata.getFrameworks.queryOptions());
  const { filters, setFilters } = useUrlListFilters(complianceAssessmentsListSearchSchema);
  const allRows = toAssessmentListRows(assessmentsData ?? [], frameworksData ?? []);
  const rows = filterBySource(filterAssessments(allRows, filters.search), filters.source);

  const openAssessment = (assessmentId: string) => {
    void navigate({
      from: '/$tenantId/{-$organizationId}',
      to: 'compliance/assessments/$assessmentId',
      params: { assessmentId },
    });
  };

  const openRow = (row: AssessmentRow) => {
    if (row.source === 'opencrq') {
      openAssessment(row.id);
      return;
    }
    void navigate({
      from: '/$tenantId/{-$organizationId}',
      to: 'compliance/$frameworkId',
      params: { frameworkId: row.id },
    });
  };

  const columns: Array<ColumnDefWithOptionsHeader<AssessmentRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Assessment`,
      size: 300,
      cell: ({ row }): ReactElement => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'framework',
      accessorKey: 'frameworkTitle',
      header: t`Framework`,
      size: 180,
      cell: ({ row }): ReactElement => <span>{row.original.frameworkTitle}</span>,
    },
    {
      id: 'source',
      accessorKey: 'source',
      header: t`Source`,
      size: 120,
      cell: ({ row }): ReactElement => <span>{sourceLabel(row.original.source)}</span>,
    },
    {
      id: 'progress',
      header: t`Progress`,
      size: 240,
      accessorFn: progressSortValue,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (row.original.source === 'opencrq'
        ? <AssessmentProgress maturity={row.original.assessment.maturity} />
        : <DrataReadinessCell framework={row.original.framework} />),
    },
    {
      id: 'maturity',
      header: t`Maturity`,
      size: 110,
      accessorFn: (row) => (row.source === 'opencrq' ? row.assessment.maturity.meanLevel ?? undefined : undefined),
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <MeanMaturityChip meanLevel={row.original.source === 'opencrq' ? row.original.assessment.maturity.meanLevel : null} />
      ),
    },
    {
      id: 'status',
      header: t`Status`,
      size: 130,
      accessorFn: listRowStatusLabel,
      cell: ({ row }): ReactElement => (row.original.source === 'opencrq'
        ? <AssessmentStatusChip status={row.original.assessment.status} />
        : <Chip severity="neutral" label={listRowStatusLabel(row.original)} />),
    },
    {
      id: 'updatedAt',
      accessorKey: 'updatedAt',
      header: t`Updated`,
      size: 140,
      cell: ({ row }): ReactElement => <span className="whitespace-nowrap">{formatDate(row.original.updatedAt)}</span>,
    },
    {
      id: 'actions',
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement | null => (row.original.source === 'opencrq'
        ? (
          <AssessmentRowActions
            published={row.original.assessment.status === 'published'}
            onDelete={() => requestConfirmation(row.original.id)}
          />
        )
        : null),
    },
  ];

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deleteAssessment.mutate({ id });
    }
  };

  return (
    <>
      <DataPageLayout
        data={rows}
        columns={columns}
        isLoading={isLoadingAssessments || isLoadingFrameworks}
        storageKey="complianceAssessments"
        initialSorting={[{ id: 'updatedAt', desc: true }]}
        leftHeaderContent={(
          <div className="flex flex-wrap items-center gap-2">
            <DebouncedSearchField
              placeholder={t`Search assessments...`}
              value={filters.search}
              onCommit={(next) => setFilters({ search: next })}
              clearLabel={t`Clear search`}
              className="w-80"
            />
            <Select value={filters.source} onValueChange={(value) => setFilters({ source: complianceAssessmentsListSearchSchema.shape.source.parse(value) })}>
              <SelectTrigger className="w-44" aria-label={t`Filter by source`}>
                <SelectValue placeholder={t`Filter by source`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><Trans>All sources</Trans></SelectItem>
                {ASSESSMENT_SOURCES.map((source) => (
                  <SelectItem key={source} value={source}>{sourceLabel(source)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        headerActions={(
          <Button onClick={() => setCreateOpen(true)}>
            <Trans>New assessment</Trans>
          </Button>
        )}
        onClickRow={(row) => openRow(row.original)}
        emptyState={allRows.length > 0 ? undefined : (
          <ListEmptyCard
            title={<Trans>Start with an assessment</Trans>}
            body={(
              <Trans>
                An assessment rates your organization against a framework, requirement by requirement, on a maturity
                level from 0 to 5. Publishing it locks it, so the next one can be compared with it. The
                frameworks assessed in Drata are listed here too, once its connector has synchronized them.
              </Trans>
            )}
            actions={(
              <>
                <Button onClick={() => setCreateOpen(true)}>
                  <Trans>New assessment</Trans>
                </Button>
                <Button priority="secondary" asChild>
                  <Link from="/$tenantId/{-$organizationId}" to="integrations/connectors/$connectorSlug" params={{ connectorSlug: 'drata' }}>
                    <Trans>Open the Drata connector</Trans>
                  </Link>
                </Button>
              </>
            )}
          />
        )}
      />
      <ComplianceAssessmentCreateDrawer open={isCreateOpen} onOpenChange={setCreateOpen} onCreated={openAssessment} />
      <DeleteConfirmDialog
        open={isDeleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            cancelDelete();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete the assessment?</Trans>}
        description={<Trans>This will permanently delete this assessment and all its answers, owners, due dates and comments. This action cannot be undone.</Trans>}
      />
    </>
  );
};
