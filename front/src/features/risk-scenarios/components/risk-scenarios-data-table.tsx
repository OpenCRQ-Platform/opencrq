import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { SCENARIO_READINESS_STATUSES } from '@app/module/client';
import { EllipsisVertical } from 'lucide-react';
import { Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { inferRouterOutputs } from '@trpc/server';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DataPageWithCards } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { sortSummariesByAle } from '../../dashboard/dashboard-utils';
import { RiskScopeFilter } from '../../organizations/components/risk-scope-filter';
import { filterByRiskScope } from '../../organizations/risk-scope-filter-utils';
import { useRiskScopeFilter } from '../../organizations/use-risk-scope-filter';
import { tabForAction } from '../../organizations/scope-drawer-tabs';
import { useConfirmationDialog } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatFixed, formatRelativeTime } from '../../../utils';
import {
  ScenarioAleCell,
  ScenarioAleChangeCell,
  ScenarioLifeline,
  ScenarioReadinessBadge,
  ScenarioTechniqueCoverage,
} from './list';
import { RiskScenarioCard } from './risk-scenario-card';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type RiskScenarioRow = RouterOutputs['riskScenarios']['getRiskScenariosOverview'][number];

interface RiskScenariosDataTableProps {
  organizationId?: string,
}

const formatLef = (value: number) => {
  const formatted = formatFixed(value, 2);
  return t`${formatted} / y`;
};

/** Columns the table keeps one panel-click away, so the default row stays readable. */
const HIDDEN_BY_DEFAULT = {
  lifeline: false,
  lef: false,
  coverage: false,
};

export const RiskScenariosDataTable: FunctionComponent<RiskScenariosDataTableProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const confirmationDialog = useConfirmationDialog();
  const { confirm, requestConfirmation } = confirmationDialog;

  const { data, isLoading } = useQuery(trpc.riskScenarios.getRiskScenariosOverview.queryOptions({ organizationId }));
  const scopeFilterShown = organizationId === undefined;
  const { riskScope, scopes, setRiskScope } = useRiskScopeFilter(scopeFilterShown);

  const deleteRiskScenarios = useMutation(trpc.riskScenarios.deleteRiskScenarios.mutationOptions({
    meta: { successMessage: msg`Risk scenario deleted successfully.` },
  }));

  const handleDeleteConfirm = () => {
    const id = confirm();
    if (id) {
      deleteRiskScenarios.mutate([id]);
    }
  };

  const columns: Array<ColumnDefWithOptionsHeader<RiskScenarioRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 250,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">
          {row.original.name}
        </span>
      ),
    },
    ...(organizationId === undefined
      ? [{
        id: 'organization',
        header: t`Risk scope`,
        size: 180,
        cell: ({ row }): ReactElement => (
          <span>{row.original.organization?.name ?? <EmptyValue />}</span>
        ),
      } satisfies ColumnDefWithOptionsHeader<RiskScenarioRow, unknown>]
      : []),
    {
      id: 'attackOutcome',
      header: t`Outcome`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <Chip className="whitespace-nowrap" label={row.original.attackOutcome.name} />
      ),
    },
    {
      id: 'asset',
      header: t`Assets`,
      size: 180,
      cell: ({ row }): ReactElement => (
        <span>
          {row.original.primaryAssets.length > 0
            ? row.original.primaryAssets.map((a) => a.name).join(', ')
            : <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'owner',
      header: t`Owner`,
      size: 150,
      accessorFn: (row) => row.owner?.name ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <span>{row.original.owner?.name ?? <EmptyValue />}</span>
      ),
    },
    {
      id: 'ale',
      header: t`Annual Loss Exposure`,
      size: 170,
      // Undefined rather than 0: `sortUndefined` parks an unmeasured scenario at the bottom rather
      // than ranking it as the cheapest one in the list.
      // A retired figure sorts as no figure, so a row reading Not priced never takes the rank of
      // the amount it stopped showing.
      accessorFn: (row) => (row.noMappedAsset ? undefined : row.latestRun?.aleMean ?? undefined),
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <ScenarioAleCell latestRun={row.original.latestRun} noMappedAsset={row.original.noMappedAsset} />
      ),
    },
    {
      id: 'change',
      header: t`Change over history`,
      size: 230,
      accessorFn: (row) => row.changeOverLifeline?.delta ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <ScenarioAleChangeCell
          hasRun={row.original.latestRun !== null}
          change={row.original.changeOverLifeline}
        />
      ),
    },
    {
      id: 'lifeline',
      header: t`Exposure history`,
      size: 180,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <ScenarioLifeline points={row.original.lifeline} />
      ),
    },
    {
      id: 'readiness',
      header: t`Status`,
      size: 130,
      accessorFn: (row) => SCENARIO_READINESS_STATUSES.indexOf(row.readiness.status),
      cell: ({ row }): ReactElement => (
        <ScenarioReadinessBadge readiness={row.original.readiness} />
      ),
    },
    {
      id: 'lastRun',
      header: t`Last simulation`,
      size: 140,
      accessorFn: (row) => row.latestRun ? new Date(row.latestRun.createdAt).getTime() : undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <span className="whitespace-nowrap">
          {row.original.latestRun ? formatRelativeTime(row.original.latestRun.createdAt) : <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'lef',
      header: t`Loss Event Frequency`,
      size: 150,
      accessorFn: (row) => row.latestRun?.lefMean ?? undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        <span className="whitespace-nowrap">
          {row.original.latestRun?.lefMean != null ? formatLef(row.original.latestRun.lefMean) : <EmptyValue />}
        </span>
      ),
    },
    {
      id: 'coverage',
      header: t`Technique coverage`,
      size: 170,
      accessorFn: (row) => row.latestRun && row.latestRun.techniqueCount > 0
        ? row.latestRun.coveredTechniqueCount / row.latestRun.techniqueCount
        : undefined,
      sortUndefined: 'last',
      cell: ({ row }): ReactElement => (
        row.original.latestRun
          ? (
            <ScenarioTechniqueCoverage
              techniqueCount={row.original.latestRun.techniqueCount}
              coveredTechniqueCount={row.original.latestRun.coveredTechniqueCount}
            />
          )
          : <EmptyValue />
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

  const handleNavigate = (id: string) => {
    void navigate({
      from: '/$tenantId/{-$organizationId}',
      to: 'risk-scenarios/$riskScenarioId',
      params: { riskScenarioId: id },
    });
  };

  const handleAdd = () => {
    void navigate({ from: '/$tenantId/{-$organizationId}', to: 'risk-scenarios/create' });
  };

  const handleManageAssets = (scopeId: string) => {
    void navigate({
      to: '/$tenantId/{-$organizationId}/details/overview',
      params: (prev) => ({ ...prev, tenantId: prev.tenantId!, organizationId: scopeId }),
      search: { scopeDrawerTab: tabForAction('manage-assets') },
    });
  };

  // Pre-sorted because the card grid has no column headers to sort by, so it would otherwise open in
  // insertion order while the table opens heaviest-first.
  const scenarios = sortSummariesByAle(filterByRiskScope(data ?? [], riskScope));

  return (
    <>
      <DataPageWithCards
        data={scenarios}
        columns={columns}
        isLoading={isLoading}
        storageKey={organizationId === undefined ? 'riskScenariosGlobal' : 'riskScenarios'}
        defaultView="grid"
        initialSorting={[{ id: 'ale', desc: true }]}
        initialColumnVisibility={HIDDEN_BY_DEFAULT}
        leftHeaderContent={scopeFilterShown ? <RiskScopeFilter value={riskScope} scopes={scopes} onChange={setRiskScope} /> : undefined}
        onCreate={handleAdd}
        onClickRow={(row) => handleNavigate(row.original.id)}
        onDeleteItems={(ids) => deleteRiskScenarios.mutate(ids)}
        renderCard={(scenario) => (
          <RiskScenarioCard
            key={scenario.id}
            id={scenario.id}
            name={scenario.name}
            organization={organizationId === undefined ? scenario.organization : null}
            attackOutcome={scenario.attackOutcome}
            primaryAssets={scenario.primaryAssets}
            owner={scenario.owner}
            latestRun={scenario.latestRun}
            lifeline={scenario.lifeline}
            changeOverLifeline={scenario.changeOverLifeline}
            readiness={scenario.readiness}
            onDelete={(id) => requestConfirmation(id)}
            onNavigate={handleNavigate}
            onManageAssets={() => handleManageAssets(scenario.organizationId)}
          />
        )}
      />
      <DeleteConfirmDialog
        open={confirmationDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmationDialog.cancel();
          }
        }}
        onConfirm={handleDeleteConfirm}
        title={<Trans>Delete risk scenario</Trans>}
        description={<Trans>This will permanently delete this risk scenario and all associated data. This action cannot be undone.</Trans>}
      />
    </>
  );
};
