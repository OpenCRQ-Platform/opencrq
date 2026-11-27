import { Button, Paper } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { DEPENDENCY_GRAPH_DEFAULT_DEPTH } from '@app/module/client';
import { List, Network, ServerOff } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { usePersistedView } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { buildDependencyGraph } from '../dependency-graph-utils';
import { DependencyGraphCard, DependencyGraphDepthSelect } from './dependency-graph-card';
import { ManagePrimaryAssetDependenciesDrawer } from './manage-dependencies-drawer';
import { PrimaryToPrimaryLinksCard } from './primary-to-primary-links-card';
import { SupportToPrimaryLinksCard } from './support-to-primary-links-card';

interface PrimaryAssetDependenciesTabProps {
  primaryAssetId: string,
  primaryAssetName: string,
}

export const PrimaryAssetDependenciesTab: FunctionComponent<PrimaryAssetDependenciesTabProps> = ({
  primaryAssetId,
  primaryAssetName,
}) => {
  const trpc = useTRPC();
  const { view, setView } = usePersistedView<'graph' | 'list'>('primary-asset-dependencies', 'graph', ['graph', 'list']);
  const [depth, setDepth] = useState(DEPENDENCY_GRAPH_DEFAULT_DEPTH);
  const [manageOpen, setManageOpen] = useState(false);

  const { data, isError } = useQuery(trpc.assetDependencies.getPrimaryAssetDependencyGraph.queryOptions(
    { primaryAssetId, depth },
    // The list below runs its own query, and this one costs a walk per level.
    { enabled: view === 'graph' },
  ));

  const unnamedAsset = t`Unnamed asset`;
  const internet = t`Internet`;
  /** Kept stable because the graph hands it to a simulation that owns the node objects it holds. */
  // eslint-disable-next-line no-restricted-syntax -- see above: the model's identity is the simulation's state.
  const model = useMemo(
    () => (data
      ? buildDependencyGraph([{ id: primaryAssetId, name: primaryAssetName }], data, { unnamedAsset, internet })
      : null),
    [data, primaryAssetId, primaryAssetName, unnamedAsset, internet],
  );

  const viewItems: Array<IconButtonGroupItem<'graph' | 'list'>> = [
    { value: 'graph', icon: <Network className="h-4 w-4" />, tooltip: t`Graph view` },
    { value: 'list', icon: <List className="h-4 w-4" />, tooltip: t`List view` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <IconButtonGroup items={viewItems} value={view} onChange={setView} />
        {view === 'graph' && <DependencyGraphDepthSelect depth={depth} onDepthChange={setDepth} />}
        <span className="flex-1" />
        <Button priority="secondary" onClick={() => setManageOpen(true)}>
          <Trans>Manage</Trans>
        </Button>
      </div>

      {view === 'list' && (
        <>
          <SupportToPrimaryLinksCard primaryAssetId={primaryAssetId} assetName={primaryAssetName} />
          <PrimaryToPrimaryLinksCard primaryAssetId={primaryAssetId} />
        </>
      )}
      {view === 'graph' && isError && (
        <Paper className="flex flex-col items-center gap-4 p-[48px_24px]">
          <ServerOff className="h-12 w-12 text-muted-foreground" />
          <div className="text-center">
            <p className="txt-subtitle font-medium">
              <Trans>Failed to load the dependency graph</Trans>
            </p>
            <p className="txt-sub-content text-muted-foreground">
              <Trans>An error occurred while computing the dependency chain. Please try again.</Trans>
            </p>
          </div>
        </Paper>
      )}
      {view === 'graph' && !isError && (
        <DependencyGraphCard
          model={model}
          depth={depth}
          onDepthChange={setDepth}
          currentAssetId={primaryAssetId}
          emptyState={(
            <>
              <p className="text-default-secondary">
                <Trans>No dependency is declared for {primaryAssetName}.</Trans>
              </p>
              <Button priority="secondary" onClick={() => setManageOpen(true)}>
                <Trans>Manage dependencies</Trans>
              </Button>
            </>
          )}
        />
      )}

      <ManagePrimaryAssetDependenciesDrawer
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        primaryAssetId={primaryAssetId}
        primaryAssetName={primaryAssetName}
      />
    </div>
  );
};
