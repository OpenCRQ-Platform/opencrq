import { Button } from '@filigran/design-system';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ConnectorSource } from '@app/module/client';
import { MoreVertical, RefreshCw } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { ConnectorDetail } from '../connector-detail-types';
import { ConfirmDialog, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { useConfirmationDialog } from '../../../hooks/utils/use-confirmation-dialog';
import { useHasManageSecurity } from '../../../hooks/utils/use-has-manage-security';
import { useHasPlatformAccess } from '../../../hooks/utils/use-has-platform-access';
import { useTRPC } from '../../../lib';
import { useLoggedUser } from '../../../providers/logged-user-provider';
import { connectorControls } from '../connector-route-utils';
import { ConfigureIntegrationDrawer } from './configure-integration-drawer';
import { getConnectors } from './connectors-list';
import { ConnectorStateChip } from './connector-state-chip';
import { DefaultThreatsConfigureDrawer } from './default-threats-configure-drawer';
import { OpenctiConfigureDrawer } from './opencti-configure-drawer';

const ConfigureControl: FunctionComponent<{ source: ConnectorSource }> = ({ source }) => {
  const trigger = <Button priority="secondary"><Trans>Configure</Trans></Button>;
  if (source === 'opencti') {
    return <OpenctiConfigureDrawer trigger={trigger} />;
  }
  if (source === 'default_threats') {
    return <DefaultThreatsConfigureDrawer trigger={trigger} />;
  }
  return <ConfigureIntegrationDrawer sourceId={source} trigger={trigger} />;
};

export const ConnectorHeader: FunctionComponent<{ connector: ConnectorDetail }> = ({ connector }) => {
  const trpc = useTRPC();
  const { name, icon } = getConnectors()[connector.source];
  const resetConfirmation = useConfirmationDialog();
  const reconnectConfirmation = useConfirmationDialog();

  const hasManageSecurity = useHasManageSecurity();
  const hasPlatformAccess = useHasPlatformAccess();
  const { userId } = useLoggedUser();
  const { activeRunId, lastRunId } = connector;
  const isStream = connector.mechanism === 'live_stream';
  const controls = connectorControls({
    // A connector switched off runs nothing until it is switched back on.
    hasJob: connector.jobKind !== null && connector.enabled,
    isStream,
    streamEnabled: connector.streamEnabled === true,
    platformConfigured: connector.platformConfigured,
    tenantConfigured: connector.tenantConfigured,
    hasActiveRun: activeRunId !== null,
    lastRunFailed: connector.lastRun?.status === 'dlq',
    hasManageSecurity,
    hasPlatformAccess,
    userId,
    activeRun: connector.activeRun,
    lastRun: connector.lastRun,
  });
  const reconnectDiscardsBackfill = connector.streamReachedLiveTail === false;

  const syncNow = useMutation(trpc.connectors.syncNow.mutationOptions({
    meta: { successMessage: msg`Sync job enqueued successfully.` },
  }));
  const cancelJob = useMutation(trpc.jobs.cancelJob.mutationOptions({
    meta: { successMessage: msg`Run cancellation requested.` },
  }));
  const retryFromDlq = useMutation(trpc.jobs.retryFromDlq.mutationOptions({
    meta: { successMessage: msg`Run queued for another attempt.` },
  }));
  const reconnectStream = useMutation(trpc.connectors.reconnectStream.mutationOptions({
    meta: { successMessage: msg`Stream reconnection requested.` },
  }));
  const resetState = useMutation(trpc.connectors.resetState.mutationOptions({
    meta: { successMessage: msg`Connector state reset.` },
  }));

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <img src={icon} alt="" aria-hidden="true" className="size-[60px] shrink-0 rounded object-contain" />
          <h1 className="min-w-0 truncate">{name}</h1>
          <ConnectorStateChip state={connector.state} enabled={connector.enabled} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {connector.jobKind !== null && (
            <Button
              startIcon={<RefreshCw className="size-4" />}
              loading={syncNow.isPending}
              disabled={!controls.canSync}
              onClick={() => syncNow.mutate({ source: connector.source })}
            >
              <Trans>Sync now</Trans>
            </Button>
          )}
          {controls.showConfigure && <ConfigureControl source={connector.source} />}
          {controls.showCancel && activeRunId !== null && (
            <Button
              priority="secondary"
              loading={cancelJob.isPending}
              onClick={() => cancelJob.mutate({ id: activeRunId })}
            >
              <Trans>Cancel</Trans>
            </Button>
          )}
          {controls.cancelHeldByOthers && (
            // A disabled button fires no pointer event, so the hint hangs on a wrapper.
            <TooltipHintProvider>
              <TooltipHint hint={<Trans>Other requests are waiting on this run, so you can no longer cancel it.</Trans>}>
                <span tabIndex={0} className="inline-flex focus-visible:outline-none focus-visible:ring-2 ring-focus">
                  <Button priority="secondary" disabled>
                    <Trans>Cancel</Trans>
                  </Button>
                </span>
              </TooltipHint>
            </TooltipHintProvider>
          )}
          {controls.showReconnect && (
            <Button
              priority="secondary"
              loading={reconnectStream.isPending}
              onClick={() => (reconnectDiscardsBackfill
                ? reconnectConfirmation.requestConfirmation(connector.source)
                : reconnectStream.mutate({ source: connector.source }))}
            >
              <Trans>Reconnect</Trans>
            </Button>
          )}
          {controls.showRetry && lastRunId !== null && (
            <Button
              priority="secondary"
              loading={retryFromDlq.isPending}
              onClick={() => retryFromDlq.mutate({ id: lastRunId })}
            >
              <Trans>Retry</Trans>
            </Button>
          )}
          {controls.showReset && (
            <IconActions size="md" icon={<MoreVertical className="size-4" />}>
              <IconActionsItem onSelect={() => resetConfirmation.requestConfirmation(connector.source)}>
                <Trans>Reset state</Trans>
              </IconActionsItem>
            </IconActions>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={resetConfirmation.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetConfirmation.cancel();
          }
        }}
        onConfirm={() => {
          resetConfirmation.confirm();
          resetState.mutate({ source: connector.source });
        }}
        title={<Trans>Reset connector state</Trans>}
        description={isStream ? (
          <Trans>
            The stream will be read again from its beginning, replaying everything it still
            retains. Nothing already imported is removed.
          </Trans>
        ) : (
          <Trans>
            The next sync will re-read everything this connector can see, instead of only what
            changed since the last run. Nothing already imported is removed.
          </Trans>
        )}
        submitButtonText={t`Reset state`}
      />
      <ConfirmDialog
        open={reconnectConfirmation.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            reconnectConfirmation.cancel();
          }
        }}
        onConfirm={() => {
          reconnectConfirmation.confirm();
          reconnectStream.mutate({ source: connector.source });
        }}
        title={<Trans>Reconnect the stream</Trans>}
        description={(
          <Trans>
            The stream will start again at its live edge. The events between where it had got to
            and now will not be imported.
          </Trans>
        )}
        submitButtonText={t`Reconnect`}
      />
    </>
  );
};
