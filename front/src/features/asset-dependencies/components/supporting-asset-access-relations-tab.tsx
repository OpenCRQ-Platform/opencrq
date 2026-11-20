import { Paper } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { List, Network, ServerOff } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import type { AssetRelationEntry } from '../../supporting-assets/components/asset-relations-card';
import { SectionCard } from '../../../components/shared';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { usePersistedView } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { AssetRelationsCard } from '../../supporting-assets/components/asset-relations-card';
import { buildDependencyGraph } from '../dependency-graph-utils';
import { DependencyGraphCard, DependencyGraphDepthSelect } from './dependency-graph-card';

interface SupportingAssetAccessRelationsTabProps {
  supportingAssetId: string,
  supportingAssetName: string,
  relations: ReadonlyArray<AssetRelationEntry>,
}

/** One level shows a device's users or an identity's devices, the reading the tab opens on. */
const DEFAULT_DEPTH = 1;

export const SupportingAssetAccessRelationsTab: FunctionComponent<SupportingAssetAccessRelationsTabProps> = ({
  supportingAssetId,
  supportingAssetName,
  relations,
}) => {
  const trpc = useTRPC();
  const { view, setView } = usePersistedView<'graph' | 'list'>('supporting-asset-access-relations', 'graph', ['graph', 'list']);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);

  const { data, isError } = useQuery(trpc.supportingAssets.getSupportingAssetRelationGraph.queryOptions(
    { supportingAssetId, depth },
    { enabled: view === 'graph' },
  ));

  const unnamedAsset = t`Unnamed asset`;
  const internet = t`Internet`;
  /** Kept stable because the graph hands it to a simulation that owns the node objects it holds. */
  // eslint-disable-next-line no-restricted-syntax -- see above: the model's identity is the simulation's state.
  const model = useMemo(
    () => (data ? buildDependencyGraph([], data, { unnamedAsset, internet }, 'access_relations') : null),
    [data, unnamedAsset, internet],
  );

  const viewItems: Array<IconButtonGroupItem<'graph' | 'list'>> = [
    { value: 'graph', icon: <Network className="h-4 w-4" />, tooltip: t`Graph view` },
    { value: 'list', icon: <List className="h-4 w-4" />, tooltip: t`List view` },
  ];

  const emptyState = (
    <p className="text-default-secondary">
      <Trans>No access relation is known for {supportingAssetName}.</Trans>
    </p>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <IconButtonGroup items={viewItems} value={view} onChange={setView} />
        {view === 'graph' && <DependencyGraphDepthSelect depth={depth} onDepthChange={setDepth} />}
      </div>

      {view === 'list' && (relations.length === 0
        ? <Paper className="flex min-h-[300px] items-center justify-center p-10">{emptyState}</Paper>
        : (
          <SectionCard title={t`Relations`}>
            <AssetRelationsCard relations={relations} />
          </SectionCard>
        ))}
      {view === 'graph' && isError && (
        <Paper className="flex flex-col items-center gap-4 p-[48px_24px]">
          <ServerOff className="h-12 w-12 text-muted-foreground" />
          <div className="text-center">
            <p className="txt-subtitle font-medium">
              <Trans>Failed to load the access relations</Trans>
            </p>
            <p className="txt-sub-content text-muted-foreground">
              <Trans>An error occurred while reading the access relations. Please try again.</Trans>
            </p>
          </div>
        </Paper>
      )}
      {view === 'graph' && !isError && (
        <DependencyGraphCard
          model={model}
          depth={depth}
          onDepthChange={setDepth}
          currentAssetId={supportingAssetId}
          marksCurrentAsset
          grammar="access_relations"
          emptyState={emptyState}
        />
      )}
    </div>
  );
};
