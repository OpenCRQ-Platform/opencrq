import { Button, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import { FileJson } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useHasManageSecurity } from '../../../hooks/utils/use-has-manage-security';
import { useTRPC } from '../../../lib';
import { DisableDefaultThreatsDialog, getConnectors } from '../../integrations';
import { ThreatUploadButton } from '../../threats/components/threat-upload-button';
import { useConnectorCard, useThreatCount } from '../hooks/use-source-reads';
import { getDefaultThreatsCardMode, getDefaultThreatsTileAction, openctiImportPercent } from '../onboarding-utils';
import { threatsCountLabel } from '../source-labels';
import { ActiveChip, ConnectorSourceIcon, ConnectorTileChip, SourceGlyph, SourceTile } from './source-tile';
import { OpenctiSourceDrawer } from './opencti-source-drawer';

const DefaultThreatsAction: FunctionComponent = () => {
  const trpc = useTRPC();
  const [confirming, setConfirming] = useState(false);
  const { data: overview } = useQuery(trpc.defaultThreats.getOverview.queryOptions());
  const connector = useConnectorCard('default_threats');
  const hasManageSecurity = useHasManageSecurity();
  // The tile's chip and count moving on is the feedback.
  const setEnabled = useMutation(trpc.defaultThreats.setEnabled.mutationOptions({ meta: { skipSuccessToast: true } }));

  if (overview === undefined || connector === undefined) {
    return null;
  }

  const mode = getDefaultThreatsCardMode({
    datasetFileUrl: overview.datasetFileUrl,
    enabled: overview.enabled,
    loadedAt: overview.loadedAt,
    connectorState: connector.state,
    hasManageSecurity,
  });
  const action = getDefaultThreatsTileAction(mode, hasManageSecurity);

  switch (action) {
    case 'enable':
      return (
        <Button type="button" priority="secondary" loading={setEnabled.isPending} onClick={() => setEnabled.mutate({ enabled: true })}>
          {t`Enable`}
        </Button>
      );
    case 'disable':
      return (
        <>
          <Button type="button" priority="secondary" loading={setEnabled.isPending} onClick={() => setConfirming(true)}>{t`Disable`}</Button>
          <DisableDefaultThreatsDialog
            open={confirming}
            onOpenChange={setConfirming}
            onConfirm={() => setEnabled.mutate({ enabled: false })}
            ownThreats={overview.groups + overview.campaigns}
            otherThreats={overview.otherThreats}
          />
        </>
      );
    case 'ask-administrator':
      return <Text as="p" variant="content-compact" className="text-default-secondary">{t`An administrator enables it.`}</Text>;
    case 'open-integrations':
      return (
        <Link {...getConnectors().default_threats.linkOption} className="text-primary underline-offset-4 hover:underline">
          <Text as="span" variant="content-compact">{t`Follow in Integrations`}</Text>
        </Link>
      );
    case 'none':
      return null;
  }
};

export const DefaultThreatsTile: FunctionComponent = () => {
  const connector = useConnectorCard('default_threats');
  const count = useThreatCount('default-threats');

  return (
    <SourceTile
      icon={<ConnectorSourceIcon source="default_threats" />}
      chip={(
        <ConnectorTileChip
          state={connector?.state}
          enabled={connector?.enabled ?? true}
          // The tile's own action says what to do with a switched-off set: Enable, or ask an administrator.
          hint={connector?.enabled === false ? t`Switched off.` : undefined}
        />
      )}
      name={getConnectors().default_threats.name}
      count={count === undefined ? undefined : threatsCountLabel(count)}
      percent={null}
      action={<DefaultThreatsAction />}
    />
  );
};

export const OpenctiTile: FunctionComponent<{ tenantId: string }> = ({ tenantId }) => {
  const trpc = useTRPC();
  const [configuring, setConfiguring] = useState(false);
  const connector = useConnectorCard('opencti');
  const count = useThreatCount('connector');
  const { data: backfill } = useQuery(trpc.opencti.getBackfillProgress.queryOptions());

  return (
    <SourceTile
      icon={<ConnectorSourceIcon source="opencti" />}
      chip={<ConnectorTileChip state={connector?.state} enabled={connector?.enabled ?? true} />}
      name={getConnectors().opencti.name}
      count={count === undefined ? undefined : threatsCountLabel(count)}
      percent={openctiImportPercent(connector?.state, backfill)}
      action={(
        <>
          <Button type="button" priority="secondary" onClick={() => setConfiguring(true)}>{t`Configure`}</Button>
          <OpenctiSourceDrawer tenantId={tenantId} open={configuring} onClose={() => setConfiguring(false)} />
        </>
      )}
    />
  );
};

export const StixTile: FunctionComponent = () => {
  const trpc = useTRPC();
  const count = useThreatCount('stix-import');
  const { data: fileStorage } = useQuery(trpc.fileStorage.getSettings.queryOptions());

  return (
    <SourceTile
      icon={<SourceGlyph icon={FileJson} />}
      chip={<ActiveChip count={count} />}
      name={t`STIX bundle`}
      count={count === undefined ? undefined : threatsCountLabel(count)}
      percent={null}
      action={(
        <>
          <ThreatUploadButton />
          {fileStorage?.enabled === false && (
            <Text as="p" variant="content-compact" className="w-full text-default-secondary">
              {t`File storage must be configured on the platform to import a bundle.`}
            </Text>
          )}
        </>
      )}
    />
  );
};
