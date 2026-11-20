import { Button, Paper, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { DEPENDENCY_GRAPH_DEFAULT_DEPTH } from '@app/module/client';
import { useMutationState, useQueries } from '@tanstack/react-query';
import { ServerOff } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useMemo, useState } from 'react';
import type { DependencyGraphPayload } from '../../asset-dependencies/dependency-graph-utils';
import type { LinkTarget } from './protect-templates';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useTRPC } from '../../../lib';
import { DependencyGraphCard, DependencyGraphDepthSelect } from '../../asset-dependencies';
import { buildDependencyGraph } from '../../asset-dependencies/dependency-graph-utils';
import { mergeDependencyGraphs, resolveSelectedAsset, toggleHiddenId, visiblePrimaryAssets } from '../protect-utils';

interface ProtectAssetsGraphProps {
  assets: ReadonlyArray<LinkTarget>,
  onLink: (asset: LinkTarget) => void,
}

/**
 * The scope's primary assets as filters, and one dependency graph drawing the shown ones. Every
 * primary asset's graph is read once, hidden or not, so a filter never waits on a read.
 */
export const ProtectAssetsGraph: FunctionComponent<ProtectAssetsGraphProps> = ({ assets: listedAssets, onLink }) => {
  const trpc = useTRPC();
  // A deleted asset stays listed until the doorbell refreshes the list, and reading its graph meanwhile fails.
  const removedIds = new Set(useMutationState({
    filters: { mutationKey: trpc.primaryAssets.deletePrimaryAssets.mutationKey() },
    select: ({ state }) => (state.status !== 'error' && Array.isArray(state.variables)
      ? state.variables.filter((id): id is string => typeof id === 'string')
      : []),
  }).flat());
  const assets = listedAssets.filter((asset) => !removedIds.has(asset.id));
  const [depth, setDepth] = useState(DEPENDENCY_GRAPH_DEFAULT_DEPTH);
  const [hiddenIds, setHiddenIds] = useState<Array<string>>([]);
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);

  const { graphs, isError } = useQueries({
    queries: assets.map((asset) => trpc.assetDependencies.getPrimaryAssetDependencyGraph.queryOptions({ primaryAssetId: asset.id, depth })),
    // Its result keeps the identity of what did not change, which the model below depends on.
    combine: (results) => ({
      graphs: results.map((result): DependencyGraphPayload | undefined => result.data),
      isError: results.some((result) => result.isError),
    }),
  });

  const unnamedAsset = t`Unnamed asset`;
  const internet = t`Internet`;
  /** Kept stable because the graph hands it to a simulation that owns the node objects it holds. */
  // eslint-disable-next-line no-restricted-syntax -- see above: the model's identity is the simulation's state.
  const model = useMemo(() => {
    const shownGraphs: Array<DependencyGraphPayload> = [];
    for (const [index, asset] of assets.entries()) {
      const graph = graphs[index];
      if (graph === undefined && !hiddenIds.includes(asset.id)) {
        return null;
      }
      if (graph !== undefined && !hiddenIds.includes(asset.id)) {
        shownGraphs.push(graph);
      }
    }
    const shownAssets = visiblePrimaryAssets(assets, hiddenIds).map((asset) => ({ id: asset.id, name: asset.name }));
    return buildDependencyGraph(shownAssets, mergeDependencyGraphs(shownGraphs), { unnamedAsset, internet });
  }, [assets, graphs, hiddenIds, unnamedAsset, internet]);

  if (assets.length === 0) {
    return null;
  }

  if (isError) {
    return (
      <Paper elevation={2} padding={16} className="flex items-center gap-3">
        <ServerOff className="size-5 shrink-0" aria-hidden />
        <Text as="p" variant="content-compact">{t`The dependency graph could not be loaded.`}</Text>
      </Paper>
    );
  }

  const linkTarget = resolveSelectedAsset(assets, linkTargetId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t`Primary assets shown on the graph`}>
        {assets.map((asset) => {
          const isShown = !hiddenIds.includes(asset.id);
          return (
            <Button
              key={asset.id}
              type="button"
              size="sm"
              aria-pressed={isShown}
              priority={isShown ? 'primary' : 'secondary'}
              className={isShown ? 'border border-transparent' : undefined}
              onClick={() => setHiddenIds(toggleHiddenId(hiddenIds, asset.id))}
            >
              {asset.name}
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <DependencyGraphDepthSelect depth={depth} onDepthChange={setDepth} />
        <span className="flex-1" />
        {linkTarget !== null && assets.length > 1 && (
          <Select value={linkTarget.id} onValueChange={setLinkTargetId}>
            <SelectTrigger className="w-[220px]" aria-label={t`Primary asset to link assets to`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assets.map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {linkTarget !== null && <Button type="button" priority="secondary" onClick={() => onLink(linkTarget)}>{t`Link assets`}</Button>}
      </div>
      <DependencyGraphCard
        model={model}
        depth={depth}
        onDepthChange={setDepth}
        drawsUnlinkedNodes
        emptyState={<Text as="p" variant="content-compact" className="text-default-secondary">{t`Every primary asset is hidden: show one above.`}</Text>}
      />
    </div>
  );
};
