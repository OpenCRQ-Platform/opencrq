import { Button, Chip, Paper } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { DEPENDENCY_GRAPH_DEFAULT_DEPTH, resolveSeverityBand, SCENARIO_SUPPORTING_ASSET_SORT_KEYS, wholePercent } from '@app/module/client';
import type { ScenarioSupportingAssetSortKey } from '@app/module/client';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { List, Network, ServerOff } from 'lucide-react';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import type { DependencyGraphEdge, PrimaryAssetHeader } from '../../asset-dependencies/dependency-graph-utils';
import type { ImpactScenarioContext } from './impact/impact-explanation';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { usePersistedPageSize, usePersistedSorting, usePersistedView } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { useTenant } from '../../../providers/tenant-provider';
import { AssetName } from '../../../components/shared/asset-name';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { assetNameText } from '../../../utils/asset-name-utils';
import { formatNumber } from '../../../utils/format-number';
import { buildDependencyGraph } from '../../asset-dependencies/dependency-graph-utils';
import { DependencyGraphCard, DependencyGraphDepthSelect, LinkRoleChips } from '../../asset-dependencies';
import { ScoreGaugeMark, severityBandLabel } from '../../finding-score';
import { ImpactExplanationButton, LinkShareExplanationButton } from './impact/impact-explanation';
import { useOpenRiskScenarioEdit } from './risk-scenario-edit-context';

type TargetsPage = NonNullable<inferRouterOutputs<TRPCRouter>['riskScenarios']['listDerivedSupportingAssets']>;
type TargetRow = TargetsPage['items'][number] & { id: string };

const TABLE_ID = 'riskScenario.targets';
const PAGE_LIMIT = 50;
const DEFAULT_SORTING = [{ id: 'impact', desc: true }];

const toSortKey = (columnId: string | undefined): ScenarioSupportingAssetSortKey | undefined =>
  SCENARIO_SUPPORTING_ASSET_SORT_KEYS.find((key) => key === columnId);

interface RiskScenarioTargetsProps {
  riskScenarioId: string,
}

const ImpactCell: FunctionComponent<{ row: TargetRow, context: ImpactScenarioContext }> = ({ row, context }) => {
  const pct = wholePercent(row.impact);
  const band = resolveSeverityBand(pct);
  const bandWord = severityBandLabel(band);
  const assetName = assetNameText({ name: row.supportingAssetName, derivedName: row.supportingAssetDerivedName }, t`Unnamed asset`);
  return (
    <span className="inline-flex items-center gap-2">
      <ScoreGaugeMark score={pct} band={band} label={t`Impact if compromised: ${pct}% of the scenario's loss, ${bandWord}`} />
      <span className="txt-sub-content text-default-secondary">%</span>
      <ImpactExplanationButton assetName={assetName} impact={row.impact} contributions={row.contributions} context={context} />
    </span>
  );
};

/** A primary asset can reach tens of thousands of supporting assets, so the server ranks them and sends one page. */
const TargetsList: FunctionComponent<RiskScenarioTargetsProps> = ({ riskScenarioId }) => {
  const trpc = useTRPC();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const [activeSort] = sorting;

  const { data: targets, isError, isPlaceholderData, isFetching } = useQuery(trpc.riskScenarios.listDerivedSupportingAssets.queryOptions(
    { riskScenarioId, page, limit: pageSize, sortBy: toSortKey(activeSort?.id), sortDesc: activeSort?.desc ?? true },
    { placeholderData: keepPreviousData },
  ));

  const unnamedAsset = t`Unnamed asset`;
  const context: ImpactScenarioContext | null = targets
    ? {
      outcomeName: targets.attackOutcome.name,
      criteriaReached: targets.attackOutcome.criteriaReached,
      primaryAssetCount: targets.primaryAssets.length,
    }
    : null;

  const columns: Array<ColumnDefWithOptionsHeader<TargetRow, unknown>> = [
    {
      id: 'supportingAsset',
      accessorFn: (row) => assetNameText({ name: row.supportingAssetName, derivedName: row.supportingAssetDerivedName }, unnamedAsset),
      header: t`Supporting Asset`,
      size: 250,
      cell: ({ row }): ReactElement => (
        <span className="inline-flex items-center gap-2 font-medium">
          <AssetName name={row.original.supportingAssetName} derivedName={row.original.supportingAssetDerivedName} />
          {row.original.outOfScope && <Chip label={t`Out of scope`} />}
        </span>
      ),
    },
    {
      id: 'roles',
      accessorFn: (row) => row.roles.length,
      header: t`Roles`,
      size: 250,
      enableSorting: false,
      cell: ({ row }): ReactElement => <LinkRoleChips roles={row.original.roles} />,
    },
    {
      id: 'depth',
      accessorKey: 'depth',
      header: t`Depth`,
      size: 120,
      cell: ({ row }): ReactElement => {
        const depth = row.original.depth;
        return (
          <Chip label={depth === 0 ? t`Direct` : t`Transitive (${depth})`} />
        );
      },
    },
    {
      id: 'via',
      accessorFn: (row) => row.via.map((asset) => assetNameText(asset, unnamedAsset)).join(', '),
      header: t`Via`,
      size: 200,
      cell: ({ getValue }): ReactElement => (
        <span className="text-muted-foreground">{String(getValue())}</span>
      ),
    },
    {
      id: 'impact',
      accessorKey: 'impact',
      header: t`Impact if compromised`,
      size: 180,
      sortDescFirst: true,
      cell: ({ row }): ReactElement => (context ? <ImpactCell row={row.original} context={context} /> : <EmptyValue />),
    },
  ];

  if (isError) {
    return <TargetsErrorCard />;
  }
  // No data and no error is still waiting, a retry paused in a background tab included: never an empty scenario.
  const isWaiting = targets === undefined;
  if (targets === null || targets?.primaryAssets.length === 0) {
    return <NoPrimaryAssetCard />;
  }
  if (targets?.total === 0) {
    return (
      <Paper className="flex flex-col items-center gap-4 p-[48px_24px]">
        <NoDependencyDeclared primaryAssets={targets.primaryAssets} />
      </Paper>
    );
  }

  const rows: Array<TargetRow> = (targets?.items ?? []).map((target) => ({ ...target, id: target.supportingAssetId }));
  const directCount = formatNumber(targets?.directCount ?? 0);
  const transitiveCount = formatNumber(targets?.transitiveCount ?? 0);

  return (
    <>
      {!isWaiting && (
        <p className="txt-sub-content text-muted-foreground">
          <Trans>
            {directCount} direct and {transitiveCount} transitive supporting assets derived from dependency chains.
          </Trans>
        </p>
      )}
      <DataPageLayout
        data={rows}
        total={targets?.total ?? 0}
        columns={columns}
        isLoading={isWaiting}
        isPlaceholderData={isPlaceholderData}
        isFetching={isFetching}
        storageKey={TABLE_ID}
        initialPageSize={PAGE_LIMIT}
        initialSorting={DEFAULT_SORTING}
        pageIndex={page - 1}
        serverSorted
        onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
        onClickRow={(row) => {
          void navigate({
            to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId/overview',
            params: { tenantId, supportingAssetId: row.original.supportingAssetId },
          });
        }}
      />
    </>
  );
};

export const RiskScenarioTargets: FunctionComponent<RiskScenarioTargetsProps> = ({ riskScenarioId }) => {
  const trpc = useTRPC();
  const { view, setView } = usePersistedView<'graph' | 'list'>('risk-scenario-targets', 'graph', ['graph', 'list']);
  const [graphDepth, setGraphDepth] = useState(DEPENDENCY_GRAPH_DEFAULT_DEPTH);

  const { data: graph, isError: isGraphError } = useQuery(trpc.riskScenarios.getDependencyGraph.queryOptions(
    { riskScenarioId, depth: graphDepth },
    { enabled: view === 'graph' },
  ));

  const unnamedAsset = t`Unnamed asset`;
  const internet = t`Internet`;
  // eslint-disable-next-line no-restricted-syntax -- the graph card needs the model's identity kept across renders.
  const model = useMemo(
    () => (graph ? buildDependencyGraph(graph.primaryAssets, graph, { unnamedAsset, internet }) : null),
    [graph, unnamedAsset, internet],
  );

  const viewItems: Array<IconButtonGroupItem<'graph' | 'list'>> = [
    { value: 'graph', icon: <Network className="h-4 w-4" />, tooltip: t`Graph view` },
    { value: 'list', icon: <List className="h-4 w-4" />, tooltip: t`List view` },
  ];

  const graphOutcome = graph?.attackOutcome ?? null;
  const graphContext: ImpactScenarioContext | null = graph && graphOutcome
    ? { outcomeName: graphOutcome.name, criteriaReached: graphOutcome.criteriaReached, primaryAssetCount: graph.primaryAssets.length }
    : null;
  const nodeById = new Map((graph?.assets ?? []).map((asset) => [asset.id, asset]));
  const impactExplanations = {
    asset: (assetId: string): ReactNode => {
      const node = nodeById.get(assetId);
      return node && graphContext
        ? <ImpactExplanationButton assetName={assetNameText(node, unnamedAsset)} impact={node.impact} contributions={node.contributions} context={graphContext} />
        : null;
    },
    link: (link: DependencyGraphEdge): ReactNode => (link.roles && link.attackShare && graphOutcome
      ? (
        <LinkShareExplanationButton
          context={{ outcomeName: graphOutcome.name, criteriaReached: graphOutcome.criteriaReached }}
          roles={link.roles}
          attackShare={link.attackShare}
        />
      )
      : null),
  };

  const graphView = isGraphError
    ? <TargetsErrorCard />
    : graph?.primaryAssets.length === 0
      ? <NoPrimaryAssetCard />
      : (
        <DependencyGraphCard
          model={model}
          depth={graphDepth}
          onDepthChange={setGraphDepth}
          emptyState={<NoDependencyDeclared primaryAssets={graph?.primaryAssets ?? []} />}
          hidesCounters
          impactExplanations={impactExplanations}
        />
      );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <IconButtonGroup items={viewItems} value={view} onChange={setView} />
        {view === 'graph' && <DependencyGraphDepthSelect depth={graphDepth} onDepthChange={setGraphDepth} />}
      </div>

      {view === 'list' ? <TargetsList riskScenarioId={riskScenarioId} /> : graphView}
    </div>
  );
};

const TargetsErrorCard: FunctionComponent = () => (
  <Paper className="flex flex-col items-center gap-4 p-[48px_24px]">
    <ServerOff className="h-12 w-12 text-muted-foreground" />
    <div className="text-center">
      <p className="txt-subtitle font-medium">
        <Trans>Failed to load targeted supporting assets</Trans>
      </p>
      <p className="txt-sub-content text-muted-foreground">
        <Trans>An error occurred while computing the dependency chain. Please try again.</Trans>
      </p>
    </div>
  </Paper>
);

/** A scenario aims at a primary asset only through its Edit drawer, so the way out of this state opens it. */
const NoPrimaryAssetCard: FunctionComponent = () => {
  const openEdit = useOpenRiskScenarioEdit();
  return (
    <Paper className="flex flex-col items-center gap-4 p-[48px_24px]">
      <ServerOff className="h-12 w-12 text-muted-foreground" />
      <p className="txt-subtitle text-center font-medium">
        <Trans>This scenario targets no primary asset</Trans>
      </p>
      {openEdit && (
        <Button priority="secondary" onClick={openEdit}>
          <Trans>Target a primary asset</Trans>
        </Button>
      )}
    </Paper>
  );
};

/** A dependency belongs to its primary asset, so the way to declare one is that asset's own tab. */
const NoDependencyDeclared: FunctionComponent<{ primaryAssets: Array<PrimaryAssetHeader> }> = ({ primaryAssets }) => {
  const { tenantId } = useTenant();
  const { organizationId } = useParams({ strict: false });
  const [soleAsset] = primaryAssets;

  if (primaryAssets.length !== 1 || soleAsset === undefined) {
    return (
      <p className="text-default-secondary">
        <Trans>No dependency is declared for the primary assets of this scenario.</Trans>
      </p>
    );
  }

  const { id: primaryAssetId, name: primaryAssetName } = soleAsset;
  return (
    <>
      <p className="text-default-secondary">
        <Trans>No dependency is declared for {primaryAssetName}.</Trans>
      </p>
      <Button asChild priority="secondary">
        <Link
          to="/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId/dependencies"
          params={{ tenantId, organizationId, primaryAssetId }}
        >
          <Trans>Open {primaryAssetName}</Trans>
        </Link>
      </Button>
    </>
  );
};
