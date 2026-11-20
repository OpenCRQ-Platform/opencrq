import { Button, Text } from '@filigran/design-system';
import { msg, t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { Suspense } from 'react';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { ConnectorSource, IntegrationSource } from '@app/module/client';
import type { ConnectorDetail, ConnectorSchedule } from '../../integrations/connector-detail-types';
import { DisplayDrawer } from '../../../components/shared';
import { Loader } from '../../../components/ui/loader';
import { useHasManageSecurity } from '../../../hooks/utils/use-has-manage-security';
import { useTRPC } from '../../../lib';
import { ConfigureIntegrationFields, getConnectors, useConfigureIntegration } from '../../integrations';
import { canSyncConnector, getConnectorCardMode } from '../onboarding-utils';
import { ConnectorUnavailableBody } from './connector-unavailable-body';

const ConfigureForm: FunctionComponent<{ source: IntegrationSource, schedule: ConnectorSchedule | null, onSaved: () => void }> = ({ source, schedule, onSaved }) => {
  const configure = useConfigureIntegration({ sourceId: source, schedule, onSaved });

  return (
    <form noValidate onSubmit={configure.form.handleSubmit(configure.submit)} className="flex flex-col gap-4">
      <ConfigureIntegrationFields configure={configure} />
      <div className="flex justify-end">
        <Button type="submit" priority="secondary" disabled={configure.isPending}>{t`Save`}</Button>
      </div>
    </form>
  );
};

const ScheduledConfigureForm: FunctionComponent<{ source: IntegrationSource, onSaved: () => void }> = ({ source, onSaved }) => {
  const trpc = useTRPC();
  const { data: schedule } = useSuspenseQuery(trpc.connectors.getSchedule.queryOptions({ source }));
  return <ConfigureForm source={source} schedule={schedule} onSaved={onSaved} />;
};

const ConfiguredControls: FunctionComponent<{ source: IntegrationSource, connector: ConnectorDetail }> = ({ source, connector }) => {
  const trpc = useTRPC();
  const { linkOption } = getConnectors()[source];
  const syncNow = useMutation(trpc.connectors.syncNow.mutationOptions({
    meta: { successMessage: msg`Sync job enqueued successfully.` },
  }));
  const canSync = canSyncConnector({
    platformConfigured: connector.platformConfigured,
    tenantConfigured: connector.tenantConfigured,
    hasActiveRun: connector.activeRunId !== null,
  });

  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-[var(--fds-border-elevation-subtle)] pt-4">
      <Button
        type="button"
        startIcon={<RefreshCw className="size-4" aria-hidden />}
        loading={syncNow.isPending}
        disabled={!canSync}
        onClick={() => syncNow.mutate({ source })}
      >
        {t`Sync now`}
      </Button>
      <Link {...linkOption} className="ml-auto text-primary underline-offset-4 hover:underline">
        <Text as="span" variant="content-compact">{t`Follow in Integrations`}</Text>
      </Link>
    </div>
  );
};

const ReadonlyBody: FunctionComponent = () => (
  <Text as="p" variant="content-compact" className="text-default-secondary">
    {t`An administrator configures this connector.`}
  </Text>
);

const ScheduledSourceBody: FunctionComponent<Omit<ScheduledSourceDrawerProps, 'open' | 'onClose' | 'name'> & { onSaved: () => void }> = ({
  source,
  unavailableMessage,
  envBlock,
  documentationUrl,
  onSaved,
}) => {
  const trpc = useTRPC();
  const { data: connector } = useQuery(trpc.connectors.getConnector.queryOptions({ source }));
  const hasManageSecurity = useHasManageSecurity();

  if (connector === undefined) {
    return <Loader />;
  }

  const mode = getConnectorCardMode({ platformConfigured: connector.platformConfigured, hasManageSecurity });

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {mode === 'unavailable' && (
        <ConnectorUnavailableBody
          message={unavailableMessage}
          envBlock={envBlock}
          documentationUrl={documentationUrl}
        />
      )}
      {mode === 'configure' && (
        <>
          <Suspense fallback={<Loader />}>
            <ScheduledConfigureForm source={source} onSaved={onSaved} />
          </Suspense>
          <ConfiguredControls source={source} connector={connector} />
        </>
      )}
      {mode === 'readonly' && <ReadonlyBody />}
    </div>
  );
};

interface ScheduledSourceDrawerProps {
  /** A job-backed connector bound to a service account and run on a schedule. */
  source: IntegrationSource & ConnectorSource,
  unavailableMessage: string,
  /** The variables a platform administrator sets, one per line. */
  envBlock: string,
  documentationUrl: string,
  open: boolean,
  onClose: () => void,
}

/** The Configure drawer of a source that is bound to a service account and synced on a schedule. */
export const ScheduledSourceDrawer: FunctionComponent<ScheduledSourceDrawerProps> = ({ open, onClose, ...body }) => (
  <DisplayDrawer open={open} onClose={onClose} title={getConnectors()[body.source].name}>
    <ScheduledSourceBody {...body} onSaved={onClose} />
  </DisplayDrawer>
);
