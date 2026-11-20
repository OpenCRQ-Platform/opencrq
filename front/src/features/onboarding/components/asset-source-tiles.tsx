import { DECLARED_ESTATE_KIND_VALUES } from '@app/module/client';
import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { PenLine, Ruler } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { getConnectors } from '../../integrations';
import { SupportingAssetCreateSheet } from '../../supporting-assets/components/supporting-asset-create-sheet';
import { useAssetCount, useConnectorCard, useDeclaredEstateKindCount } from '../hooks/use-source-reads';
import { runProgressPercent } from '../onboarding-utils';
import { assetsCountLabel, declaredKindsOfLabel } from '../source-labels';
import { DeclaredEstateSourceDrawer } from './declared-estate-source-drawer';
import { DefenderSourceDrawer } from './defender-source-drawer';
import { ActiveChip, ConnectorSourceIcon, ConnectorTileChip, SourceGlyph, SourceTile } from './source-tile';

export const DefenderTile: FunctionComponent<{ tenantId: string }> = ({ tenantId }) => {
  const [configuring, setConfiguring] = useState(false);
  const connector = useConnectorCard('microsoft_graph');
  const count = useAssetCount('microsoft_graph');

  return (
    <SourceTile
      icon={<ConnectorSourceIcon source="microsoft_graph" />}
      chip={<ConnectorTileChip state={connector?.state} enabled={connector?.enabled ?? true} />}
      name={getConnectors().microsoft_graph.name}
      count={count === undefined ? undefined : assetsCountLabel(count)}
      percent={runProgressPercent(connector?.activeRun ?? null)}
      action={(
        <>
          <Button type="button" priority="secondary" onClick={() => setConfiguring(true)}>{t`Configure`}</Button>
          <DefenderSourceDrawer tenantId={tenantId} open={configuring} onClose={() => setConfiguring(false)} />
        </>
      )}
    />
  );
};

export const ManualAssetsTile: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const [creating, setCreating] = useState(false);
  const count = useAssetCount('user');

  return (
    <SourceTile
      icon={<SourceGlyph icon={PenLine} />}
      chip={<ActiveChip count={count} />}
      name={t`Manual creation`}
      count={count === undefined ? undefined : assetsCountLabel(count)}
      percent={null}
      action={(
        <>
          <Button type="button" priority="secondary" onClick={() => setCreating(true)}>{t`Create`}</Button>
          <SupportingAssetCreateSheet open={creating} onOpenChange={setCreating} organizationId={organizationId} />
        </>
      )}
    />
  );
};

export const DeclaredEstateTile: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const [editing, setEditing] = useState(false);
  const count = useDeclaredEstateKindCount(organizationId);

  return (
    <SourceTile
      icon={<SourceGlyph icon={Ruler} />}
      chip={<ActiveChip count={count} />}
      name={t`Declared estate`}
      description={t`Gives every scenario the size of your estate, even before your assets are imported.`}
      count={count === undefined ? undefined : declaredKindsOfLabel(count, DECLARED_ESTATE_KIND_VALUES.length)}
      percent={null}
      action={(
        <>
          <Button type="button" priority="secondary" onClick={() => setEditing(true)}>{count === undefined || count === 0 ? t`Declare` : t`Edit`}</Button>
          <DeclaredEstateSourceDrawer organizationId={organizationId} open={editing} onClose={() => setEditing(false)} />
        </>
      )}
    />
  );
};

/** The Declared estate comes first: it is the one source that needs no connector and no asset. */
export const AssetSourceTiles: FunctionComponent<{ tenantId: string, organizationId: string }> = ({ tenantId, organizationId }) => (
  <>
    <DeclaredEstateTile organizationId={organizationId} />
    <DefenderTile tenantId={tenantId} />
    <ManualAssetsTile organizationId={organizationId} />
  </>
);
